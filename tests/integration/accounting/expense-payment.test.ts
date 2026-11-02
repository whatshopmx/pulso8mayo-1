import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq } from "drizzle-orm";
import ws from "ws";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { recognizeExpense, recordExpensePayment, listExpensePayments,
  confirmPaymentIn, failPaymentIn, postPaymentIn } from "@/lib/services/accounting/expense-adapter";
import { approveOperatingExpense, markPaidOperatingExpense, registerExpensePayment } from "@/lib/services/expense-service";
import { TreasuryService } from "@/lib/services/treasury-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
// External notifications/events are outside this circuit; all financial writes use Postgres.
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: {} }));
vi.mock("@/lib/services/domain-event-service", () => ({ emitDomainEvent: vi.fn() }));
vi.mock("@/lib/services/tenant-config-service", () => ({ getTenantOperatingConfig: vi.fn(() => {
  throw new Error("The fixture must resolve its explicit authorization rule.");
}) }));
vi.mock("@/lib/services/pnl-snapshot-service", () => ({ freezePnLPeriod: vi.fn() }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc09_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true, connectionTimeoutMillis: 5000,
  options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), branchId = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
let created = false;

beforeAll(async () => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  let verified = false;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const value = parse(readFileSync(file)).DATABASE_URL;
    if (!value) continue;
    const operative = new URL(value);
    verified = true;
    if (target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
      && target.pathname === operative.pathname) throw new Error("La base de pruebas coincide con la operativa.");
  }
  if (!verified) throw new Error("No se pudo comprobar el aislamiento de la base de pruebas.");
  await pool.query(`CREATE SCHEMA "${namespace}"`); created = true;
  await pool.query(`CREATE TYPE "${namespace}".expense_payment_method AS ENUM (${schema.expensePaymentMethodEnum.enumValues.map(value => `'${value}'`).join(",")})`);
  for (const table of ["companies", "users", "cost_centers", "company_bank_accounts", "branches", "financial_periods",
    "operating_expenses", "expense_authorization_rules", "payment_runs", "payment_run_items"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id)`);
  }
  await pool.query("INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena')", [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at)
    VALUES ($1,'expense@fixture.invalid','OWNER',$2,now(),now())`, [actorId, companyId]);
  await pool.query("INSERT INTO branches (id,company_id,name,code) VALUES ($1,$2,'Sucursal sintética','SYN')", [branchId, companyId]);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules", "0131_fc09_expense_payments"]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`)
      // Do not grant fixture-table privileges to a real runtime role.
      .replaceAll("rolname = 'pulso_app'", "rolname = 'fc09_nonexistent_fixture_role'");
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  }
  state.db = drizzle(pool, { schema });
  await pool.query(`INSERT INTO expense_authorization_rules (company_id,min_amount,approver_role)
    VALUES ($1,0,'OWNER')`, [companyId]);
  const account = async (code: string, kind: "ASSET" | "EXPENSE" | "LIABILITY", normalBalance: "DEBIT" | "CREDIT") =>
    (await createAccount(ctx, { code, name: code, kind, normalBalance, validFrom: "2026-01-01" })).id;
  const expense = await account("EXP", "EXPENSE", "DEBIT");
  const payable = await account("PAY", "LIABILITY", "CREDIT");
  const bank = await account("BANK", "ASSET", "DEBIT");
  const tax = await account("TAX", "ASSET", "DEBIT");
  for (const [eventType, entries] of [
    ["EXPENSE_RECOGNIZED", [{ role: "EXPENSE", accountId: expense }, { role: "PAYABLE", accountId: payable },
      { role: "RECOVERABLE_TAX", accountId: tax }]],
    ["EXPENSE_PAYMENT", [{ role: "PAYABLE", accountId: payable }, { role: "PAYMENT_SOURCE", accountId: bank }]],
  ] as const) {
    await createRule(ctx, { code: eventType, name: eventType, eventType, effectiveFrom: "2026-01-01", entries: [...entries] });
  }
}, 60000);

afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`); }
  finally { await pool.end(); }
});
afterEach(() => vi.unstubAllEnvs());

async function expense(amount = 10000, status = "APPROVED") {
  const id = randomUUID();
  await pool.query(`INSERT INTO operating_expenses
    (id,company_id,branch_id,category,amount,description,status,requested_by,approved_by,business_date,tax_amount)
    VALUES ($1,$2,$3,'OTROS',$4,'Gasto sintético',$5,$6,$6,'2026-10-01',0)`,
  [id, companyId, branchId, amount, status, actorId]);
  return id;
}

const manual = (expenseId: string, amountCents: number) => recordExpensePayment(ctx, {
  paymentId: randomUUID(), expenseId, amountCents, paidAt: "2026-10-15", source: "MANUAL", reference: "SYN-PAY",
});

const allBranches = { kind: "ALL" } as const;
const approve = (id: string) => approveOperatingExpense(id, companyId, allBranches, actorId, "OWNER");
const payBalance = (id: string) => markPaidOperatingExpense(id, companyId, allBranches,
  actorId, "TRANSFERENCIA", new Date("2026-10-20T12:00:00Z"));

it("recognizes the obligation from the real approval entry without asserting a payment", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  const results = await Promise.allSettled([approve(id), approve(id)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const journals = await pool.query("SELECT status,event_type FROM accounting_journals WHERE source_id=$1", [id]);
  expect(journals.rows).toEqual([{ status: "POSTED", event_type: "EXPENSE_RECOGNIZED" }]);
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(10000);
});

it("rolls back approval when journal persistence fails", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  await pool.query(`CREATE FUNCTION reject_fixture_journal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected journal failure'; END $$`);
  await pool.query(`CREATE TRIGGER reject_fixture_journal BEFORE INSERT ON accounting_journals
    FOR EACH ROW WHEN (NEW.source_id = '${id}') EXECUTE FUNCTION reject_fixture_journal()`);
  try {
    await expect(approve(id)).rejects.toBeDefined();
    expect((await pool.query("SELECT status FROM operating_expenses WHERE id=$1", [id])).rows[0].status).toBe("PENDING_APPROVAL");
    expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
  } finally {
    await pool.query("DROP TRIGGER reject_fixture_journal ON accounting_journals");
    await pool.query("DROP FUNCTION reject_fixture_journal()");
  }
});

it("pays only the remainder through the real service after a retried partial payment", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  await approve(id);
  const input = { paymentId: randomUUID(), companyId, scope: allBranches, actorId,
    expenseId: id, amountCents: 4000, paidAt: "2026-10-15" };
  const partial = await registerExpensePayment(input);
  expect((await registerExpensePayment(input)).payment.id).toBe(partial.payment.id);
  await Promise.all([payBalance(id), payBalance(id)]);
  await payBalance(id);
  const payments = await listExpensePayments(ctx, id);
  expect(payments.remainingCents).toBe(0);
  expect(payments.items.map(item => item.amountCents).sort()).toEqual([4000, 6000]);
  expect(payments.items.every(item => item.accountingJournalId)).toBe(true);
  expect((await pool.query("SELECT status,paid_by FROM operating_expenses WHERE id=$1", [id])).rows[0])
    .toEqual({ status: "PAID", paid_by: actorId });
});

it("preserves operative approval when the accounting rule is absent", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  await pool.query("UPDATE operating_expenses SET business_date='2025-10-01' WHERE id=$1", [id]);
  expect((await approve(id)).status).toBe("APPROVED");
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
});

it("keeps the disabled approval/payment path free of accounting writes", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0");
  const id = await expense(10000, "PENDING_APPROVAL");
  expect((await approve(id)).status).toBe("APPROVED");
  expect((await payBalance(id)).status).toBe("PAID");
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
});

it("keeps role, tenant and branch checks ahead of real approval and payment writes", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  const outside = { kind: "BRANCH", branchId: randomUUID() } as const;
  await expect(approveOperatingExpense(id, companyId, outside, actorId, "OWNER"))
    .rejects.toMatchObject({ statusCode: 403 });
  await expect(approveOperatingExpense(id, companyId, allBranches, actorId, "GERENTE"))
    .rejects.toMatchObject({ statusCode: 403 });
  await expect(approveOperatingExpense(id, foreignCompany, allBranches, actorId, "OWNER"))
    .rejects.toMatchObject({ statusCode: 404 });
  await expect(payBalance(id)).rejects.toMatchObject({ statusCode: 400 });
  await approve(id);
  await expect(registerExpensePayment({ paymentId: randomUUID(), expenseId: id, companyId,
    actorId, scope: outside, amountCents: 1000, paidAt: "2026-10-20" }))
    .rejects.toMatchObject({ statusCode: 403 });
  await expect(markPaidOperatingExpense(id, companyId, outside, actorId, "TRANSFERENCIA"))
    .rejects.toMatchObject({ statusCode: 403 });
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
});

it("rejects real approval in a closed period without an obligation", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  await pool.query("UPDATE operating_expenses SET business_date='2030-01-01' WHERE id=$1", [id]);
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2030,1,'CLOSED')", [companyId]);
  await expect(approve(id)).rejects.toMatchObject({ statusCode: 403 });
  expect((await pool.query("SELECT status FROM operating_expenses WHERE id=$1", [id])).rows[0].status).toBe("PENDING_APPROVAL");
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
});

async function pending(expenseId: string, amountCents: number) {
  const run = randomUUID(), item = randomUUID();
  await pool.query(`INSERT INTO payment_runs (id,company_id,title,run_date,prepared_by)
    VALUES ($1,$2,'Corrida sintética','2026-10-10',$3)`, [run, companyId, actorId]);
  await pool.query(`INSERT INTO payment_run_items (id,payment_run_id,item_type,reference_id,amount_cents)
    VALUES ($1,$2,'OPERATING_EXPENSE',$3,$4)`, [item, run, expenseId, amountCents]);
  return recordExpensePayment(ctx, { expenseId, amountCents, paidAt: "2026-10-10", source: "TREASURY", paymentRunItemId: item });
}

it("recognizes once under retries and concurrency, then posts two partial payments without repeating expense", async () => {
  const id = await expense();
  const journals = await Promise.all([recognizeExpense(ctx, id), recognizeExpense(ctx, id)]);
  expect(journals[0].id).toBe(journals[1].id);
  const first = await manual(id, 4000);
  expect(first.journal?.status).toBe("POSTED");
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
  expect((await pool.query("SELECT status FROM operating_expenses WHERE id=$1", [id])).rows[0].status).toBe("APPROVED");
  const second = await manual(id, 6000);
  expect(second.journal?.status).toBe("POSTED");
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(0);
  expect((await pool.query("SELECT status FROM operating_expenses WHERE id=$1", [id])).rows[0].status).toBe("PAID");
  const totals = await pool.query(`SELECT j.event_type,sum(l.debit_cents)::int AS debit,sum(l.credit_cents)::int AS credit
    FROM accounting_journals j JOIN accounting_journal_lines l ON l.journal_id=j.id
    WHERE j.source_id=ANY($1) GROUP BY j.event_type`, [[id, first.payment.id, second.payment.id]]);
  expect(totals.rows).toEqual(expect.arrayContaining([
    { event_type: "EXPENSE_RECOGNIZED", debit: 10000, credit: 10000 },
    { event_type: "EXPENSE_PAYMENT", debit: 10000, credit: 10000 },
  ]));
});

it("keeps pending and rejected treasury payments out of balances and journals", async () => {
  const id = await expense();
  const result = await pending(id, 3000);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(10000);
  await withCompanyContext(ctx, tx => failPaymentIn(tx, companyId, actorId, { paymentId: result.payment.id, reason: "Rechazo sintético" }));
  expect((await listExpensePayments(ctx, id)).items[0]).toMatchObject({ status: "FAILED", accountingJournalId: null });
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(10000);
});

it("uses actual settlement date and links the posted journal, with an idempotent confirmation", async () => {
  const id = await expense();
  const result = await pending(id, 4000);
  await pool.query("UPDATE payment_run_items SET settlement_status='CONFIRMED' WHERE id=$1", [result.payment.paymentRunItemId]);
  const confirm = () => withCompanyContext(ctx, tx => confirmPaymentIn(tx, companyId, actorId, {
    paymentId: result.payment.id, paidAt: "2026-10-20", reference: "SYN-SETTLED",
  }));
  const posted = await confirm();
  expect(posted.journal?.accountingDate).toBe("2026-10-20");
  expect((await listExpensePayments(ctx, id)).items[0]).toMatchObject({
    paidAt: "2026-10-20", accountingJournalId: posted.journal!.id, status: "CONFIRMED",
  });
  expect((await confirm()).already).toBe(true);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
});

it("rejects overpayment, unapproved expenses and cross-company access", async () => {
  const id = await expense();
  await manual(id, 6000);
  await expect(manual(id, 5000)).rejects.toMatchObject({ statusCode: 409 });
  await expect(manual(await expense(10000, "REJECTED"), 1000)).rejects.toMatchObject({ statusCode: 409 });
  await expect(recognizeExpense({ companyId: foreignCompany, actorId }, id)).rejects.toMatchObject({ statusCode: 403 });
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(4000);
});

it("serializes concurrent payments against the same remaining balance", async () => {
  const id = await expense();
  const results = await Promise.allSettled([manual(id, 6000), manual(id, 6000)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(4000);
});

it("enables and forces tenant row security on applications", async () => {
  const result = await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='expense_payments'::regclass");
  expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});

it("preserves confirmed facts while allowing only their journal recovery metadata", async () => {
  const id = await expense();
  const payment = await manual(id, 1000);
  for (const update of ["amount_cents=2000", "paid_at='2026-10-21'", "reference='CHANGED'", "accounting_journal_id=NULL"]) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
      await expect(client.query(`UPDATE expense_payments SET ${update} WHERE id=$1`, [payment.payment.id]))
        .rejects.toMatchObject({ code: "23514" });
    } finally { await client.query("ROLLBACK"); client.release(); }
  }
});

it("records a confirmed payment as pending accounting when no rule is effective", async () => {
  const id = await expense();
  await pool.query("UPDATE operating_expenses SET business_date='2025-10-01' WHERE id=$1", [id]);
  const result = await recordExpensePayment(ctx, { paymentId: randomUUID(), expenseId: id, amountCents: 2000, paidAt: "2025-10-15", source: "MANUAL" });
  expect(result.journal).toBeNull();
  expect(result.pendingReason).toBeTruthy();
  expect((await listExpensePayments(ctx, id)).items[0]).toMatchObject({ status: "CONFIRMED", accountingJournalId: null,
    pendingReason: result.pendingReason });
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(8000);
});

it("rejects closed payment periods without preserving an application or a journal", async () => {
  const id = await expense();
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2026,12,'CLOSED')", [companyId]);
  await expect(recordExpensePayment(ctx, { paymentId: randomUUID(), expenseId: id, amountCents: 2000, paidAt: "2026-12-15", source: "MANUAL" }))
    .rejects.toMatchObject({ statusCode: 409 });
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
});

it("resolves permissions and branch scope from the actor, never caller assertions", async () => {
  const manager = randomUUID(), hidden = randomUUID();
  await pool.query("INSERT INTO branches (id,company_id,name,code) VALUES ($1,$2,'Oculta','HIDDEN')", [hidden, companyId]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,branch_id,created_at,updated_at)
    VALUES ($1,'manager@fixture.invalid','GERENTE',$2,$3,now(),now())`, [manager, companyId, branchId]);
  const id = await expense();
  expect((await listExpensePayments({ companyId, actorId: manager }, id)).remainingCents).toBe(10000);
  await expect(recognizeExpense({ companyId, actorId: manager }, id)).rejects.toMatchObject({ statusCode: 403 });
  await expect(recordExpensePayment({ companyId, actorId: manager }, { paymentId: randomUUID(), expenseId: id, amountCents: 1000,
    paidAt: "2026-10-15", source: "MANUAL" })).rejects.toMatchObject({ statusCode: 403 });
  await pool.query("UPDATE operating_expenses SET branch_id=$1 WHERE id=$2", [hidden, id]);
  await expect(listExpensePayments({ companyId, actorId: manager }, id)).rejects.toMatchObject({ statusCode: 404 });
});

it("reuses the same manual payment under concurrent retries, including after full settlement", async () => {
  const id = await expense();
  const input = { paymentId: randomUUID(), expenseId: id, amountCents: 4000,
    paidAt: "2026-10-15", source: "MANUAL" as const, reference: "RETRY" };
  const results = await Promise.all([recordExpensePayment(ctx, input), recordExpensePayment(ctx, input)]);
  expect(results[0].payment.id).toBe(input.paymentId);
  expect(results[1].payment.id).toBe(input.paymentId);
  expect(results[0].journal?.id).toBe(results[1].journal?.id);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
  await manual(id, 6000);
  expect((await recordExpensePayment(ctx, input)).payment.id).toBe(input.paymentId);
  expect((await listExpensePayments(ctx, id)).items).toHaveLength(2);
});

it("rejects changed payment data under a reused identity without changing the balance", async () => {
  const id = await expense();
  const input = { paymentId: randomUUID(), expenseId: id, amountCents: 2000,
    paidAt: "2026-10-15", source: "MANUAL" as const };
  await recordExpensePayment(ctx, input);
  for (const change of [{ amountCents: 3000 }, { paidAt: "2026-10-16" },
    { reference: "CHANGED" }, { paymentMethod: "EFECTIVO" as const }, { expenseId: await expense() }]) {
    await expect(recordExpensePayment(ctx, { ...input, ...change })).rejects.toMatchObject({ statusCode: 409 });
  }
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(8000);
});

it("requires a stable identity for public manual partial payments", async () => {
  const id = await expense();
  await expect(recordExpensePayment(ctx, { expenseId: id, amountCents: 1000,
    paidAt: "2026-10-15", source: "MANUAL" })).rejects.toMatchObject({ statusCode: 400 });
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
});

it("blocks new payments and pending confirmations on legacy PAID expenses", async () => {
  const id = await expense(10000, "PAID");
  await expect(manual(id, 1000)).rejects.toMatchObject({ statusCode: 409 });
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
  const other = await expense();
  const scheduled = await pending(other, 1000);
  await pool.query("UPDATE operating_expenses SET status='PAID' WHERE id=$1", [other]);
  await pool.query("UPDATE payment_run_items SET settlement_status='CONFIRMED' WHERE id=$1", [scheduled.payment.paymentRunItemId]);
  await expect(withCompanyContext(ctx, tx => confirmPaymentIn(tx, companyId, actorId, {
    paymentId: scheduled.payment.id, paidAt: "2026-10-20",
  }))).rejects.toMatchObject({ statusCode: 409 });
  expect((await listExpensePayments(ctx, other)).items[0].status).toBe("PENDING");
});

it("separates documented recoverable tax from expense and blocks undocumented tax", async () => {
  const id = await expense(34800);
  await pool.query("UPDATE operating_expenses SET tax_amount=4800 WHERE id=$1", [id]);
  const journal = await recognizeExpense(ctx, id);
  const lines = await pool.query(`SELECT a.code,l.debit_cents::int,l.credit_cents::int FROM accounting_journal_lines l
    JOIN accounting_accounts a ON a.id=l.account_id WHERE l.journal_id=$1`, [journal.id]);
  expect(lines.rows).toEqual(expect.arrayContaining([
    { code: "EXP", debit_cents: 30000, credit_cents: 0 },
    { code: "TAX", debit_cents: 4800, credit_cents: 0 },
    { code: "PAY", debit_cents: 0, credit_cents: 34800 },
  ]));
  const unknown = await expense();
  await pool.query("UPDATE operating_expenses SET tax_amount=NULL WHERE id=$1", [unknown]);
  await expect(recognizeExpense(ctx, unknown)).rejects.toMatchObject({ statusCode: 409,
    message: expect.stringContaining("impuesto") });
});

async function treasuryItem() {
  const id = await expense();
  const result = await pending(id, 4000);
  const itemId = result.payment.paymentRunItemId!;
  const { rows } = await pool.query("SELECT payment_run_id FROM payment_run_items WHERE id=$1", [itemId]);
  const paymentRunId = rows[0].payment_run_id as string;
  await pool.query("UPDATE payment_runs SET status='APPROVED' WHERE id=$1", [paymentRunId]);
  return { id, payment: result.payment, params: { itemId, paymentRunId, companyId, userId: actorId, actorRole: "OWNER" as const } };
}

it("treasury real confirmation posts a partial payment once with its settlement date", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const { id, params } = await treasuryItem();
  const input = { ...params, settlementStatus: "CONFIRMED" as const, reference: "SYN-BANK-OK" };
  await TreasuryService.settlePaymentRunItem(input);
  expect((await TreasuryService.settlePaymentRunItem(input)).accion).toBe("SIN_CAMBIO");
  const result = await listExpensePayments(ctx, id);
  expect(result.remainingCents).toBe(6000);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ status: "CONFIRMED", paidAt: new Date().toISOString().slice(0, 10) });
  expect(result.items[0].accountingJournalId).toBeTruthy();
});

it("treasury real rejection keeps debt and blocks a confirmation that would leave a failed accounting application", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const { id, params } = await treasuryItem();
  await TreasuryService.settlePaymentRunItem({ ...params, settlementStatus: "FAILED", failureReason: "Rechazo sintético" });
  await expect(TreasuryService.settlePaymentRunItem({ ...params, settlementStatus: "CONFIRMED", reference: "CORRECTION" }))
    .rejects.toMatchObject({ statusCode: 409 });
  const result = await listExpensePayments(ctx, id);
  expect(result.remainingCents).toBe(10000);
  expect(result.items[0]).toMatchObject({ status: "FAILED", accountingJournalId: null });
  expect((await pool.query("SELECT settlement_status FROM payment_run_items WHERE id=$1", [params.itemId])).rows[0].settlement_status)
    .toBe("FAILED");
});

it("treasury real settlement rejects missing evidence, unauthorized role and another tenant", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const { id, params } = await treasuryItem();
  await expect(TreasuryService.settlePaymentRunItem({ ...params, settlementStatus: "CONFIRMED" }))
    .rejects.toMatchObject({ statusCode: 400 });
  await expect(TreasuryService.settlePaymentRunItem({ ...params, settlementStatus: "CONFIRMED", reference: "SYN",
    actorRole: "GERENTE" })).rejects.toMatchObject({ statusCode: 403 });
  await expect(TreasuryService.settlePaymentRunItem({ ...params, settlementStatus: "CONFIRMED", reference: "SYN",
    companyId: foreignCompany })).rejects.toMatchObject({ statusCode: 404 });
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(10000);
  expect((await listExpensePayments(ctx, id)).items[0].status).toBe("PENDING");
});

it("treasury real concurrent rejection and confirmation preserve the same outcome in both ledgers", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const { id, params } = await treasuryItem();
  const attempts = await Promise.allSettled([
    TreasuryService.settlePaymentRunItem({ ...params, settlementStatus: "FAILED", failureReason: "Rechazo concurrente" }),
    TreasuryService.settlePaymentRunItem({ ...params, settlementStatus: "CONFIRMED", reference: "SYN-RACE" }),
  ]);
  expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
  const result = await listExpensePayments(ctx, id);
  const { rows } = await pool.query("SELECT settlement_status FROM payment_run_items WHERE id=$1", [params.itemId]);
  expect(result.items[0].status).toBe(rows[0].settlement_status);
  expect(result.remainingCents).toBe(result.items[0].status === "CONFIRMED" ? 6000 : 10000);
  expect(Boolean(result.items[0].accountingJournalId)).toBe(result.items[0].status === "CONFIRMED");
});

it("keeps payments pending when a revised rule no longer settles the original obligation, then recovers once aligned", async () => {
  const id = await expense();
  const original = await recognizeExpense(ctx, id);
  const { rows: accounts } = await pool.query("SELECT id,code FROM accounting_accounts WHERE company_id=$1", [companyId]);
  const accountId = (code: string) => accounts.find(account => account.code === code)!.id as string;
  const otherPayable = await createAccount(ctx, { code: "PAY_NEW", name: "Nueva obligación",
    kind: "LIABILITY", normalBalance: "CREDIT", validFrom: "2026-01-01" });
  const { rows: rules } = await pool.query("SELECT id,event_type FROM accounting_rules WHERE company_id=$1 AND version=1", [companyId]);
  await createRule(ctx, { code: "EXPENSE_RECOGNIZED", name: "Nueva obligación", eventType: "EXPENSE_RECOGNIZED",
    effectiveFrom: "2033-01-01", supersedesId: rules.find(rule => rule.event_type === "EXPENSE_RECOGNIZED")!.id,
    entries: [{ role: "EXPENSE", accountId: accountId("EXP") }, { role: "PAYABLE", accountId: otherPayable.id }] });
  const revised = await createRule(ctx, { code: "EXPENSE_PAYMENT", name: "Pago nueva obligación", eventType: "EXPENSE_PAYMENT",
    effectiveFrom: "2033-01-01", supersedesId: rules.find(rule => rule.event_type === "EXPENSE_PAYMENT")!.id,
    entries: [{ role: "PAYABLE", accountId: otherPayable.id }, { role: "PAYMENT_SOURCE", accountId: accountId("BANK") }] });
  const payment = await recordExpensePayment(ctx, { paymentId: randomUUID(), expenseId: id, amountCents: 4000,
    paidAt: "2033-02-01", source: "MANUAL" });
  expect(payment.journal).toBeNull();
  expect(payment.pendingReason).toContain("obligación original");
  expect((await listExpensePayments(ctx, id))).toMatchObject({ remainingCents: 6000,
    items: [expect.objectContaining({ status: "CONFIRMED", accountingJournalId: null, pendingReason: payment.pendingReason })] });
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [payment.payment.id])).rows).toEqual([]);
  expect((await recognizeExpense(ctx, id)).id).toBe(original.id);

  // A later expense and its payment may legitimately use the revised account.
  const newId = await expense();
  await pool.query("UPDATE operating_expenses SET business_date='2033-01-01' WHERE id=$1", [newId]);
  const compatible = await recordExpensePayment(ctx, { paymentId: randomUUID(), expenseId: newId, amountCents: 1000,
    paidAt: "2033-02-01", source: "MANUAL" });
  expect(compatible.journal?.status).toBe("POSTED");

  // Recovery uses the original journal, even though recognition rules have changed.
  await createRule(ctx, { code: "EXPENSE_PAYMENT", name: "Pago obligación original", eventType: "EXPENSE_PAYMENT",
    effectiveFrom: "2033-02-01", supersedesId: revised.rule.id,
    entries: [{ role: "PAYABLE", accountId: accountId("PAY") }, { role: "PAYMENT_SOURCE", accountId: accountId("BANK") }] });
  const recover = () => withCompanyContext(ctx, async tx => {
    const [saved] = await tx.select().from(schema.expensePayments).where(and(
      eq(schema.expensePayments.companyId, companyId), eq(schema.expensePayments.id, payment.payment.id)));
    return postPaymentIn(tx, companyId, actorId, saved);
  });
  const recovered = await recover();
  expect(recovered.journal?.status).toBe("POSTED");
  expect((await recover()).journal?.id).toBe(recovered.journal?.id);
  expect((await listExpensePayments(ctx, id))).toMatchObject({ remainingCents: 6000,
    items: [expect.objectContaining({ accountingJournalId: recovered.journal!.id, pendingReason: null })] });
  const balance = await pool.query(`SELECT sum(credit_cents-debit_cents)::int AS balance
    FROM accounting_journal_lines WHERE journal_id=ANY($1) AND account_id=$2`,
  [[original.id, recovered.journal!.id], accountId("PAY")]);
  expect(balance.rows[0].balance).toBe(6000);
});
