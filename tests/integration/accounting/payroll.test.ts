import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { capturePayrollRunIn, capturePayrollPaymentIn } from "@/lib/services/accounting/payroll-adapter";
import { retryAccountingEvent } from "@/lib/services/accounting/event-service";
import { loadPayrollPaymentSnapshot } from "@/lib/treasury/payroll-payment-source";
import { createDraft, publishDraft, reverseJournal } from "@/lib/services/accounting/journal-service";
import { TreasuryService } from "@/lib/services/treasury-service";
import { eq, sql } from "drizzle-orm";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc15ledger_${randomUUID().replaceAll("-", "")}`, runtimeRole = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 10000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), employeeId = randomUUID(), branchId = randomUUID(), bankId = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const }, accounts: Record<string, string> = {};
let created = false, roleCreated = false;

beforeAll(async () => {
  const isolated = new URL(process.env.TEST_DATABASE_URL!); let checked = false;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const values = parse(readFileSync(file));
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      if (!values[key]) continue; checked = true; const operative = new URL(values[key]);
      if (isolated.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
        && isolated.pathname === operative.pathname) throw new Error("La base aislada coincide con la operativa.");
    }
  }
  if (!checked) throw new Error("No se pudo verificar el aislamiento.");
  await pool.query(`CREATE SCHEMA "${namespace}"`); created = true;
  await pool.query(`CREATE TYPE "${namespace}".expense_payment_method AS ENUM (${schema.expensePaymentMethodEnum.enumValues.map(v => `'${v}'`).join(",")})`);
  for (const table of ["companies", "users", "branches", "cost_centers", "company_bank_accounts", "financial_periods",
    "operating_expenses", "payment_runs", "payment_run_items", "payroll_runs", "payroll_payslips"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY(id)`);
  }
  await pool.query("ALTER TABLE payment_runs DROP COLUMN IF EXISTS source_bank_account_id");
  await pool.query("ALTER TABLE payment_run_items DROP COLUMN IF EXISTS payroll_snapshot CASCADE");
  await pool.query("INSERT INTO companies(id,name) VALUES($1,'Synthetic payroll'),($2,'Foreign')", [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users(id,email,role,company_id,branch_id,created_at,updated_at)
    VALUES($1,'payroll-owner@fixture.invalid','OWNER',$3,NULL,now(),now()),($2,'payroll-employee@fixture.invalid','EMPLEADO',$3,$4,now(),now())`,
    [actorId, employeeId, companyId, branchId]);
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Synthetic','PAY','OWNED')", [branchId, companyId]);
  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules", "0131_fc09_expense_payments", "0132_fc09_treasury_source",
    "0133_fc10_accounting_events", "0146_fc15_payroll_snapshot", "0147_fc15_payroll_facts"]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`).replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
      .replaceAll("rolname='pulso_app'", `rolname='${runtimeRole}'`).replaceAll("TO pulso_app", `TO "${runtimeRole}"`);
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  }
  state.db = drizzle(pool, { schema });
  for (const [role, kind] of Object.entries({ PAYROLL_EXPENSE: "EXPENSE", PAYROLL_PAYABLE: "LIABILITY",
    PAYROLL_DEDUCTIONS: "LIABILITY", TIPS_PAYABLE: "LIABILITY", PAYMENT_SOURCE: "ASSET" })) {
    accounts[role] = (await createAccount(ctx, { code: role, name: role, kind: kind as "EXPENSE" | "LIABILITY" | "ASSET",
      normalBalance: kind === "LIABILITY" ? "CREDIT" : "DEBIT", validFrom: "2026-01-01" })).id;
  }
  for (const eventType of ["PAYROLL_RECOGNIZED", "PAYROLL_PAID"]) {
    await createRule(ctx, { code: eventType, name: eventType, eventType, effectiveFrom: "2026-01-01",
      entries: Object.entries(accounts).map(([role, accountId]) => ({ role, accountId })) });
  }
  await pool.query(`INSERT INTO company_bank_accounts(id,company_id,label,account_number,account_last_four,
    account_fingerprint,bank_code,bank_name,registered_by) VALUES($1,$2,'Synthetic','fixture-encrypted','1234','fixture','012','Fixture',$3)`, [bankId, companyId, actorId]);
  await pool.query("INSERT INTO accounting_source_links(company_id,account_id,bank_account_id,created_by,updated_by) VALUES($1,$2,$3,$4,$4)",
    [companyId, accounts.PAYMENT_SOURCE, bankId, actorId]);
}, 120000);
beforeEach(() => vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${runtimeRole}"`); }
  finally { await pool.end(); }
});

async function payroll(month: number, tips = 0, corporate = false) {
  const runId = randomUUID(), payslipId = randomUUID(), date = `2026-${String(month).padStart(2, "0")}`;
  await pool.query("UPDATE users SET branch_id=$1 WHERE id=$2", [corporate ? null : branchId, employeeId]);
  await pool.query("INSERT INTO payroll_runs(id,company_id,period_start,period_end,status) VALUES($1,$2,$3,$4,'COMPLETED')", [runId, companyId, `${date}-01`, `${date}-15`]);
  await pool.query(`INSERT INTO payroll_payslips(id,run_id,user_id,cfdi_uuid,cfdi_status,base_salary_cents,
    propinas_cents,total_percepciones_cents,total_deducciones_cents) VALUES($1,$2,$3,$4,'TIMBRADO',80000,$5,$6,10000)`,
    [payslipId, runId, employeeId, randomUUID(), tips, 80000 + tips]);
  return { runId, payslipId, date };
}
const recognize = (runId: string) => withCompanyContext({ companyId, actorId }, tx => capturePayrollRunIn(tx, companyId, actorId, runId));
async function payment(runId: string) {
  return withCompanyContext({ companyId, actorId }, async tx => {
    const snapshot = await loadPayrollPaymentSnapshot(tx, companyId, runId);
    const [run] = await tx.insert(schema.paymentRuns).values({ companyId, title: "Synthetic", runDate: new Date("2026-12-01T12:00:00Z"),
      sourceBankAccountId: bankId, sourceAccount: "fixture-number", preparedBy: actorId }).returning();
    const [item] = await tx.insert(schema.paymentRunItems).values({ paymentRunId: run.id, itemType: "PAYROLL", referenceId: runId,
      amountCents: snapshot.netCents, payrollSnapshot: snapshot }).returning();
    await tx.update(schema.paymentRunItems).set({ settlementStatus: "CONFIRMED", settledAt: new Date("2026-12-01T12:00:00Z"),
      settledBy: actorId, settlementReference: "SYNTHETIC-CONFIRMATION" }).where(eq(schema.paymentRunItems.id, item.id));
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return { itemId: item.id, results: await capturePayrollPaymentIn(tx, companyId, actorId, item.id) };
  });
}

it("recognizes the documented gross and settles only net without repeating cost", async () => {
  const source = await payroll(1);
  expect((await recognize(source.runId))[0].journal).not.toBeNull();
  const paid = await payment(source.runId);
  expect(paid.results[0].journal).not.toBeNull();
  expect((await pool.query(`SELECT memo,sum(debit_cents)::int AS debit,sum(credit_cents)::int AS credit
    FROM accounting_journal_lines GROUP BY memo ORDER BY memo`)).rows).toEqual([
    { memo: "PAYROLL:PAYMENT_SOURCE", debit: 0, credit: 70000 },
    { memo: "PAYROLL:PAYROLL_DEDUCTIONS", debit: 0, credit: 10000 },
    { memo: "PAYROLL:PAYROLL_EXPENSE", debit: 80000, credit: 0 },
    { memo: "PAYROLL:PAYROLL_PAYABLE", debit: 70000, credit: 70000 },
  ]);
  await recognize(source.runId);
  await withCompanyContext({ companyId, actorId }, tx => capturePayrollPaymentIn(tx, companyId, actorId, paid.itemId));
  expect((await pool.query("SELECT count(*)::int n FROM accounting_payroll_facts")).rows[0].n).toBe(2);
});

it("keeps corporate payroll explicit and prevents mutable source amounts", async () => {
  const source = await payroll(2, 0, true);
  const result = await recognize(source.runId);
  expect(result[0].journal).not.toBeNull();
  expect((await pool.query("SELECT branch_id FROM accounting_events WHERE source_id=$1", [source.payslipId])).rows[0].branch_id).toBeNull();
  await expect(pool.query("UPDATE payroll_payslips SET total_percepciones_cents=90000 WHERE id=$1", [source.payslipId])).rejects.toThrow();
});

it("does not expense tips a second time or publish before their liability exists", async () => {
  const source = await payroll(3, 10000);
  const [blocked] = await recognize(source.runId);
  expect(blocked).toMatchObject({ journal: null, reason: expect.stringMatching(/pasivo original de propinas/i) });
  const draft = await createDraft(ctx, { accountingDate: "2026-03-01", description: "Synthetic tips liability",
    lines: [{ accountId: accounts.PAYMENT_SOURCE, debitCents: 10000 }, { accountId: accounts.TIPS_PAYABLE, creditCents: 10000 }] });
  await publishDraft(ctx, draft.id, { expectedVersion: draft.version, reason: "Synthetic liability evidence" });
  const [posted] = await recognize(source.runId);
  expect(posted.journal).not.toBeNull();
  const expense = await pool.query("SELECT debit_cents::int FROM accounting_journal_lines WHERE journal_id=$1 AND memo='PAYROLL:PAYROLL_EXPENSE'", [posted.journal!.id]);
  expect(expense.rows[0].debit_cents).toBe(80000);
});

it("keeps an overlapping receipt pending and rejects another company", async () => {
  const source = await payroll(4); await recognize(source.runId);
  const duplicate = await payroll(4);
  expect((await recognize(duplicate.runId))[0]).toMatchObject({ journal: null, reason: expect.stringMatching(/solapamiento/i) });
  await expect(withCompanyContext({ companyId: foreignCompany, actorId }, tx => capturePayrollRunIn(tx, foreignCompany, actorId, source.runId))).rejects.toThrow();
});

it("connects treasury settlement, recovery retry, manual reversal guard and NOBYPASSRLS runtime role", async () => {
  const source = await payroll(5);
  await pool.query("INSERT INTO financial_periods(id,company_id,year,month,status) VALUES($1,$2,2026,5,'CLOSED')", [randomUUID(), companyId]);
  const [closedResult] = await withCompanyContext({ companyId, actorId }, async tx => {
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return capturePayrollRunIn(tx, companyId, actorId, source.runId);
  });
  expect(closedResult).toMatchObject({ journal: null, reason: expect.stringMatching(/cerrado/i) });
  const eventRow = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [source.payslipId])).rows[0];
  await pool.query("UPDATE financial_periods SET status='OPEN' WHERE company_id=$1 AND year=2026 AND month=5", [companyId]);
  const retried = await retryAccountingEvent(ctx, eventRow.id);
  expect(retried.journal).not.toBeNull();
  await expect(reverseJournal(ctx, retried.journal!.id, {
    expectedVersion: 2, accountingDate: "2026-05-16", reason: "Intento de reversa manual no permitido",
  })).rejects.toThrow(/revisar recibos y pagos vinculados/i);

  const runInfo = await withCompanyContext({ companyId, actorId }, async tx => {
    const snapshot = await loadPayrollPaymentSnapshot(tx, companyId, source.runId);
    const [run] = await tx.insert(schema.paymentRuns).values({ companyId, title: "Treasury Payroll",
      runDate: new Date("2026-05-20T12:00:00Z"), status: "DRAFT",
      sourceBankAccountId: bankId, sourceAccount: "fixture-number", preparedBy: actorId }).returning();
    const [item] = await tx.insert(schema.paymentRunItems).values({ paymentRunId: run.id, itemType: "PAYROLL",
      referenceId: source.runId, amountCents: snapshot.netCents, payrollSnapshot: snapshot }).returning();
    await tx.update(schema.paymentRuns).set({ status: "APPROVED" }).where(eq(schema.paymentRuns.id, run.id));
    return { runId: run.id, itemId: item.id };
  });

  await TreasuryService.settlePaymentRunItem({
    paymentRunId: runInfo.runId, itemId: runInfo.itemId, companyId,
    settlementStatus: "CONFIRMED", userId: actorId, actorRole: "OWNER", reference: "SPEI-PAYROLL-05",
  });
  const paidFact = (await pool.query(
    "SELECT f.id, e.status, e.journal_id FROM accounting_payroll_facts f JOIN accounting_events e ON e.id=f.event_id WHERE f.payment_run_item_id=$1",
    [runInfo.itemId],
  )).rows[0];
  expect(paidFact).toMatchObject({ status: "POSTED", journal_id: expect.any(String) });

  const foreignVisible = await withCompanyContext({ companyId: foreignCompany, actorId }, async tx => {
    await tx.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
    return (await tx.execute(sql`SELECT count(*)::int AS n FROM accounting_payroll_facts`)).rows[0];
  });
  expect(foreignVisible).toEqual({ n: 0 });
});
