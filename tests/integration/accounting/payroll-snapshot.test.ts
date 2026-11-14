import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { loadPayrollPaymentSnapshot } from "@/lib/treasury/payroll-payment-source";
import { samePayrollSnapshot } from "@/lib/treasury/payroll-snapshot";

const namespace = `fc15_${randomUUID().replaceAll("-", "")}`, role = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4,
  connectionTimeoutMillis: 10000, options: `-c search_path=${namespace} -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), runId = randomUUID(), paymentId = randomUUID();
const payslipId = randomUUID(), cfdiUuid = randomUUID();
let schemaCreated = false, roleCreated = false;

beforeAll(async () => {
  const isolated = new URL(process.env.TEST_DATABASE_URL!);
  let checked = false;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const values = parse(readFileSync(file));
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      if (!values[key]) continue;
      checked = true;
      const operative = new URL(values[key]);
      if (isolated.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
        && isolated.pathname === operative.pathname) throw new Error("La base de pruebas coincide con la operativa.");
    }
  }
  if (!checked) throw new Error("No se pudo verificar el aislamiento de la base.");
  await pool.query(`CREATE SCHEMA "${namespace}"`); schemaCreated = true;
  await pool.query(`CREATE TABLE users(id text PRIMARY KEY,company_id uuid NOT NULL,branch_id uuid);
    CREATE TABLE branches(id uuid PRIMARY KEY,company_id uuid NOT NULL);
    CREATE TABLE payroll_runs(id uuid PRIMARY KEY,company_id uuid NOT NULL,period_start date NOT NULL,
      period_end date NOT NULL,status text NOT NULL,aguinaldo_fiscal_year integer,aguinaldo_snapshot jsonb,
      created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
    CREATE TABLE payroll_payslips(id uuid PRIMARY KEY,run_id uuid REFERENCES payroll_runs(id),user_id text REFERENCES users(id),
      cfdi_uuid text,cfdi_status text,base_salary_cents integer NOT NULL,holiday_pay_cents integer NOT NULL,
      overtime_pay_cents integer NOT NULL,aguinaldo_cents integer NOT NULL,propinas_cents integer NOT NULL,
      total_percepciones_cents integer NOT NULL,total_deducciones_cents integer NOT NULL);
    CREATE TABLE payment_runs(id uuid PRIMARY KEY,company_id uuid NOT NULL,status text NOT NULL);
    CREATE TABLE payment_run_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_run_id uuid,
      item_type text NOT NULL,reference_id text NOT NULL,amount_cents integer NOT NULL,settlement_status text DEFAULT 'PENDING');`);
  const migration = readFileSync("drizzle/0146_fc15_payroll_snapshot.sql", "utf8").replaceAll('"public".', `"${namespace}".`);
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  await pool.query(`CREATE ROLE "${role}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${role}" TO CURRENT_USER; GRANT USAGE ON SCHEMA "${namespace}" TO "${role}";
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${namespace}" TO "${role}";`);
  for (const table of ["users", "payroll_runs", "payment_runs"]) {
    await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON ${table} FOR ALL TO "${role}"
      USING(company_id=nullif(current_setting('app.current_company_id',true),'')::uuid)
      WITH CHECK(company_id=nullif(current_setting('app.current_company_id',true),'')::uuid);`);
  }
  await pool.query(`ALTER TABLE payroll_payslips ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant ON payroll_payslips FOR ALL TO "${role}"
    USING(EXISTS(SELECT 1 FROM payroll_runs r WHERE r.id=run_id))
    WITH CHECK(EXISTS(SELECT 1 FROM payroll_runs r WHERE r.id=run_id));
    ALTER TABLE payment_run_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant ON payment_run_items FOR ALL TO "${role}"
    USING(EXISTS(SELECT 1 FROM payment_runs r WHERE r.id=payment_run_id))
    WITH CHECK(EXISTS(SELECT 1 FROM payment_runs r WHERE r.id=payment_run_id));`);
}, 60000);
beforeEach(async () => {
  await pool.query("TRUNCATE payment_run_items,payment_runs,payroll_payslips,payroll_runs,users,branches CASCADE");
  await pool.query("INSERT INTO users(id,company_id) VALUES('employee-a',$1),('employee-b',$1)", [companyId]);
  await pool.query("INSERT INTO payroll_runs(id,company_id,period_start,period_end,status) VALUES($1,$2,'2026-11-01','2026-11-15','COMPLETED')", [runId, companyId]);
  await pool.query("INSERT INTO payment_runs VALUES($1,$2,'DRAFT')", [paymentId, companyId]);
  await pool.query("INSERT INTO payroll_payslips VALUES($1,$2,'employee-a',$3,'TIMBRADO',80000,0,0,0,10000,90000,10000)", [payslipId, runId, cfdiUuid]);
});
afterAll(async () => {
  try {
    if (schemaCreated) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${role}"`);
  } finally { await pool.end(); }
});

async function runtime<T>(tenant: string, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query(`SET ROLE "${role}"`);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [tenant]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.query("RESET ROLE"); client.release(); }
}
const load = (client: PoolClient) => loadPayrollPaymentSnapshot(drizzle(client) as never, companyId, runId);
const insert = (client: PoolClient, snapshot: unknown) => client.query(
  "INSERT INTO payment_run_items(payment_run_id,item_type,reference_id,amount_cents,payroll_snapshot) VALUES($1,'PAYROLL',$2,80000,$3::jsonb) RETURNING payroll_snapshot",
  [paymentId, runId, JSON.stringify(snapshot)]);

it("loads and freezes the actual source through the restricted runtime role", async () => {
  await runtime(companyId, async client => {
    expect((await client.query("SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0].rolbypassrls).toBe(false);
    const snapshot = await load(client);
    expect(snapshot).toMatchObject({ companyId, netCents: 80000, receipts: [{ employeeId: "employee-a" }] });
    expect((await insert(client, snapshot)).rows[0].payroll_snapshot).toEqual(snapshot);
  });
  await expect(runtime(companyId, client => client.query("UPDATE payment_run_items SET payroll_snapshot=NULL"))).rejects.toThrow();
  await expect(pool.query("UPDATE payment_runs SET company_id=$1", [foreignCompany])).rejects.toThrow();
});

it("does not reveal or prepare payroll from another tenant", async () => {
  await expect(runtime(foreignCompany, load)).rejects.toThrow(/no encontrada/i);
  const snapshot = await runtime(companyId, load);
  await expect(runtime(foreignCompany, client => insert(client, snapshot))).rejects.toThrow();
});

it("detects source changes with identical net after authorization", async () => {
  const original = await runtime(companyId, async client => {
    const snapshot = await load(client); await insert(client, snapshot); return snapshot;
  });
  await pool.query("UPDATE payroll_payslips SET base_salary_cents=81000,total_percepciones_cents=91000,total_deducciones_cents=11000");
  const current = await runtime(companyId, load);
  expect(current.netCents).toBe(original.netCents);
  expect(samePayrollSnapshot(original, current)).toBe(false);
});

it("serializes a concurrent receipt insertion against the snapshot cut", async () => {
  const reader = await pool.connect(), writer = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    for (const client of [reader, writer]) {
      await client.query(`SET ROLE "${role}"`); await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
    }
    const original = await load(reader);
    const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = writer.query("INSERT INTO payroll_payslips VALUES($1,$2,'employee-b',$3,'TIMBRADO',10000,0,0,0,0,10000,0)", [randomUUID(), runId, randomUUID()]);
    const outcome = pending.then(() => null, error => error);
    let blocked = false;
    for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
      blocked = (await pool.query("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked", [pid])).rows[0].blocked;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(blocked).toBe(true);
    await insert(reader, original); await reader.query("COMMIT");
    expect(await outcome).toBeNull(); await writer.query("COMMIT");
    const current = await runtime(companyId, load);
    expect(original.receipts).toHaveLength(1);
    expect(current.receipts).toHaveLength(2);
    expect(samePayrollSnapshot(original, current)).toBe(false);
  } finally {
    await reader.query("ROLLBACK"); await writer.query("ROLLBACK");
    await pending?.catch(() => {});
    for (const client of [reader, writer]) { await client.query("RESET ROLE"); client.release(); }
  }
});
