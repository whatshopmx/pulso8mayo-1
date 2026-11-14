import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPayrollSnapshot } from "@/lib/treasury/payroll-snapshot";

const db = new PGlite();
const companyId = "10000000-0000-4000-8000-000000000001";
const runId = "10000000-0000-4000-8000-000000000002";
const paymentRunId = "10000000-0000-4000-8000-000000000003";
const receipt = { payslipId: "10000000-0000-4000-8000-000000000004", employeeId: "employee-a",
  branchId: null, cfdiUuid: "10000000-0000-4000-8000-000000000005", cfdiStatus: "TIMBRADO",
  baseSalaryCents: 80000, holidayPayCents: 0, overtimePayCents: 0, aguinaldoCents: 0,
  propinasCents: 10000, totalPercepcionesCents: 90000, totalDeduccionesCents: 10000 };
const snapshot = () => buildPayrollSnapshot(companyId, { id: runId, status: "COMPLETED",
  periodStart: "2026-11-01", periodEnd: "2026-11-15" }, [receipt]);
let legacy: unknown;

beforeAll(async () => {
  await db.exec(`CREATE TABLE users(id text PRIMARY KEY,company_id uuid NOT NULL,branch_id uuid);
    CREATE TABLE branches(id uuid PRIMARY KEY,company_id uuid NOT NULL);
    CREATE TABLE payroll_runs(id uuid PRIMARY KEY,company_id uuid NOT NULL,period_start date NOT NULL,period_end date NOT NULL,status text NOT NULL);
    CREATE TABLE payroll_payslips(id uuid PRIMARY KEY,run_id uuid REFERENCES payroll_runs(id),user_id text REFERENCES users(id),
      cfdi_uuid text,cfdi_status text,base_salary_cents integer NOT NULL,holiday_pay_cents integer NOT NULL,
      overtime_pay_cents integer NOT NULL,aguinaldo_cents integer NOT NULL,propinas_cents integer NOT NULL,
      total_percepciones_cents integer NOT NULL,total_deducciones_cents integer NOT NULL);
    CREATE TABLE payment_runs(id uuid PRIMARY KEY,company_id uuid NOT NULL,status text NOT NULL);
    CREATE TABLE payment_run_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_run_id uuid,
      item_type text NOT NULL,reference_id text NOT NULL,amount_cents integer NOT NULL,settlement_status text DEFAULT 'PENDING');
    INSERT INTO payment_run_items(item_type,reference_id,amount_cents) VALUES('PAYROLL','legacy',123);`);
  for (const statement of readFileSync("drizzle/0146_fc15_payroll_snapshot.sql", "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await db.exec(statement);
  }
  await db.exec("UPDATE payment_run_items SET settlement_status='CONFIRMED' WHERE reference_id='legacy'");
  legacy = (await db.query("SELECT amount_cents,payroll_snapshot,settlement_status FROM payment_run_items")).rows[0];
}, 30000);
beforeEach(async () => {
  await db.exec(`TRUNCATE payment_run_items,payment_runs,payroll_payslips,payroll_runs,users,branches CASCADE;
    INSERT INTO users(id,company_id) VALUES('employee-a','${companyId}');
    INSERT INTO payroll_runs VALUES('${runId}','${companyId}','2026-11-01','2026-11-15','COMPLETED');
    INSERT INTO payment_runs VALUES('${paymentRunId}','${companyId}','DRAFT');`);
  await db.query(`INSERT INTO payroll_payslips VALUES($1,$2,$3,$4,$5,80000,0,0,0,10000,90000,10000)`,
    [receipt.payslipId, runId, receipt.employeeId, receipt.cfdiUuid, receipt.cfdiStatus]);
  await db.query("SELECT set_config('app.current_company_id',$1,false)", [companyId]);
});
afterAll(() => db.close());
const insert = (value: unknown = snapshot(), amount = 80000, type = "PAYROLL") => db.query(
  "INSERT INTO payment_run_items(payment_run_id,item_type,reference_id,amount_cents,payroll_snapshot) VALUES($1,$2,$3,$4,$5::jsonb)",
  [paymentRunId, type, runId, amount, value === null ? null : JSON.stringify(value)]);

describe("FC-15 PostgreSQL snapshot guards (isolated PGlite)", () => {
  it("preserves historical amounts and null snapshots without fabricating allocations", () => {
    expect(legacy).toEqual({ amount_cents: 123, payroll_snapshot: null, settlement_status: "CONFIRMED" });
  });
  it("accepts the exact confirmed source allocation", async () => {
    await insert();
    expect((await db.query("SELECT payroll_snapshot FROM payment_run_items")).rows).toEqual([{ payroll_snapshot: snapshot() }]);
  });
  it("refuses new payroll without a snapshot and snapshots on other payment types", async () => {
    await expect(insert(null)).rejects.toThrow();
    await expect(insert(snapshot(), 80000, "TAXES")).rejects.toThrow();
    await expect(insert(null, 80000, "TAXES")).resolves.toBeDefined();
  });
  it("rejects changed employees or amounts with the same net", async () => {
    const changed = snapshot();
    changed.receipts[0].employeeId = "employee-b";
    await expect(insert(changed)).rejects.toThrow();
    const redistributed = snapshot();
    redistributed.receipts[0].baseSalaryCents += 1000;
    redistributed.receipts[0].totalPercepcionesCents += 1000;
    redistributed.receipts[0].totalDeduccionesCents += 1000;
    await expect(insert(redistributed)).rejects.toThrow();
    await expect(insert(snapshot(), 90000)).rejects.toThrow();
  });
  it("freezes allocation and payment identity while allowing settlement updates", async () => {
    await insert();
    await expect(db.exec("UPDATE payment_run_items SET payroll_snapshot=NULL")).rejects.toThrow();
    await expect(db.exec("UPDATE payment_run_items SET amount_cents=80001")).rejects.toThrow();
    await expect(db.exec("UPDATE payment_run_items SET reference_id='another-run'")).rejects.toThrow();
    await expect(db.query("UPDATE payment_runs SET company_id=$1", [runId])).rejects.toThrow();
    await expect(db.exec("UPDATE payment_run_items SET settlement_status='CONFIRMED'")).resolves.toBeDefined();
  });
  it("rejects non-confirmed runs, cancelled receipts and duplicate employees", async () => {
    await db.exec("UPDATE payroll_runs SET status='PROCESSING'");
    await expect(insert()).rejects.toThrow();
    await db.exec("UPDATE payroll_runs SET status='COMPLETED'; UPDATE payroll_payslips SET cfdi_status='CANCELADO'");
    await expect(insert()).rejects.toThrow();
    await db.exec(`UPDATE payroll_payslips SET cfdi_status='TIMBRADO';
      INSERT INTO payroll_payslips SELECT gen_random_uuid(),run_id,user_id,gen_random_uuid()::text,cfdi_status,
        base_salary_cents,holiday_pay_cents,overtime_pay_cents,aguinaldo_cents,propinas_cents,
        total_percepciones_cents,total_deducciones_cents FROM payroll_payslips;`);
    await expect(insert()).rejects.toThrow();
  });
  it("checks tenant context and employee ownership independently of caller JSON", async () => {
    await db.query("SELECT set_config('app.current_company_id',$1,false)", [paymentRunId]);
    await expect(insert()).rejects.toThrow();
    await db.query("SELECT set_config('app.current_company_id',$1,false)", [companyId]);
    await db.query("UPDATE users SET company_id=$1", [paymentRunId]);
    await expect(insert()).rejects.toThrow();
  });
});
