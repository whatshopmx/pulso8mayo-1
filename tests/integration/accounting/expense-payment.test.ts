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
import { createAccount, linkSource, readAccountingPreparation } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { recognizeExpense, recordExpensePayment, listExpensePayments,
  confirmPaymentIn, failPaymentIn, postPaymentIn, previewExpenseRecognition } from "@/lib/services/accounting/expense-adapter";
import { approveOperatingExpense, markPaidOperatingExpense, registerExpensePayment } from "@/lib/services/expense-service";
import { TreasuryService } from "@/lib/services/treasury-service";
import { processAccountingEvent, listPendingAccountingEvents, retryAccountingEvent,
  recoverMissingAccountingEvents, dueAccountingEvents } from "@/lib/services/accounting/event-service";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";

const state = vi.hoisted(() => ({ db: null as unknown, allowTreasuryConfiguration: false }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
// External notifications/events are outside this circuit; all financial writes use Postgres.
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: {} }));
vi.mock("@/lib/services/domain-event-service", () => ({ emitDomainEvent: vi.fn() }));
vi.mock("@/lib/services/tenant-config-service", () => ({ getTenantOperatingConfig: vi.fn(() => {
  if (state.allowTreasuryConfiguration) return { doubleApprovalThresholdCents: 1000000 };
  throw new Error("The fixture must resolve its explicit authorization rule.");
}) }));
vi.mock("@/lib/services/pnl-snapshot-service", () => ({ freezePnLPeriod: vi.fn() }));
// Synthetic encryption key; never unwrap a real tenant key in this fixture.
vi.mock("@/lib/security/dek", () => ({ ENC_PREFIX: "enc::", DekService: {
  getDek: vi.fn(async () => Buffer.alloc(32, 9)),
} }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc09_${randomUUID().replaceAll("-", "")}`;
const runtimeRole = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true, connectionTimeoutMillis: 5000,
  options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), branchId = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
let created = false, roleCreated = false, treasuryBankId: string;

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
    "operating_expenses", "expense_authorization_rules", "payment_runs", "payment_run_items", "payees", "payee_bank_accounts", "daily_sales_cuts"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id)`);
  }
  await pool.query("INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena')", [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at)
    VALUES ($1,'expense@fixture.invalid','OWNER',$2,now(),now())`, [actorId, companyId]);
  await pool.query("INSERT INTO branches (id,company_id,name,code) VALUES ($1,$2,'Sucursal sintética','SYN')", [branchId, companyId]);
  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules", "0131_fc09_expense_payments",
    "0132_fc09_treasury_source", "0133_fc10_accounting_events", "0134_fc11_sales", "0135_fc_preparation_permissions"]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`)
      // Exercise only privileges provisioned by migrations, on the isolated role.
      .replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
      .replaceAll("TO pulso_app", `TO "${runtimeRole}"`);
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
  treasuryBankId = await ownBank();
  await linkSource(ctx, { bankAccountId: treasuryBankId, accountId: bank });
}, 60000);

afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${runtimeRole}"`);
  }
  finally { await pool.end(); }
});
afterEach(() => { vi.unstubAllEnvs(); state.allowTreasuryConfiguration = false; });

async function expense(amount = 10000, status = "APPROVED") {
  const id = randomUUID();
  await pool.query(`INSERT INTO operating_expenses
    (id,company_id,branch_id,category,amount,description,status,requested_by,approved_by,business_date,tax_amount)
    VALUES ($1,$2,$3,'OTROS',$4,'Gasto sintético',$5,$6,$6,'2026-10-01',0)`,
  [id, companyId, branchId, amount, status, actorId]);
  return id;
}

async function ownBank(company = companyId, currency = "MXN", active = true) {
  const id = randomUUID();
  await pool.query(`INSERT INTO company_bank_accounts
    (id,company_id,label,account_number,account_last_four,account_fingerprint,bank_code,bank_name,registered_by,currency,active)
    VALUES ($1,$2,'Banco sintético',$3,'1234',$4,'012','Banco sintético',$5,$6,$7)`,
  [id, company, encryptColumnWithDek("012345678901234", Buffer.alloc(32, 9)), randomUUID(), actorId, currency, active]);
  return id;
}

it("freezes the treasury bank identity and rejects a source from another company in SQL", async () => {
  const bank = await ownBank();
  const run = randomUUID();
  await pool.query(`INSERT INTO payment_runs
    (id,company_id,title,run_date,prepared_by,source_bank_account_id,source_account)
    VALUES ($1,$2,'Fuente congelada','2026-10-15',$3,$4,'012345678901234')`, [run, companyId, actorId, bank]);
  expect((await pool.query("SELECT source_bank_account_id FROM payment_runs WHERE id=$1", [run])).rows)
    .toEqual([{ source_bank_account_id: bank }]);
  await expect(pool.query("UPDATE payment_runs SET source_bank_account_id=NULL WHERE id=$1", [run]))
    .rejects.toMatchObject({ code: "23514" });
  await expect(pool.query("UPDATE payment_runs SET source_account='999999' WHERE id=$1", [run]))
    .rejects.toMatchObject({ code: "23514" });
  await expect(pool.query("UPDATE payment_runs SET currency='USD' WHERE id=$1", [run]))
    .rejects.toMatchObject({ code: "23514" });
  const foreign = await ownBank(foreignCompany);
  await expect(pool.query(`INSERT INTO payment_runs
    (company_id,title,run_date,prepared_by,source_bank_account_id,source_account)
    VALUES ($1,'Ajena','2026-10-15',$2,$3,'012345678901234')`, [companyId, actorId, foreign]))
    .rejects.toMatchObject({ code: "23503" });
});

const manual = (expenseId: string, amountCents: number) => recordExpensePayment(ctx, {
  paymentId: randomUUID(), expenseId, amountCents, paidAt: "2026-10-15", source: "MANUAL", reference: "SYN-PAY",
});

it("persists a tenant-scoped immutable accounting fact with a unique source version", async () => {
  const id = await expense();
  const values = [companyId, branchId, id, actorId];
  const insert = `INSERT INTO accounting_events
    (company_id,branch_id,source_type,source_id,event_type,actor_id,accounting_date)
    VALUES ($1,$2,'OPERATING_EXPENSE',$3,'EXPENSE_RECOGNIZED',$4,'2026-10-01') RETURNING id`;
  const event = (await pool.query(insert, values)).rows[0];
  await expect(pool.query(insert, values)).rejects.toMatchObject({ code: "23505" });
  await expect(pool.query("UPDATE accounting_events SET source_id=$1 WHERE id=$2", [randomUUID(), event.id]))
    .rejects.toMatchObject({ code: "23514" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [foreignCompany]);
    expect((await client.query("SELECT id FROM accounting_events WHERE id=$1", [event.id])).rows).toEqual([]);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
    expect((await client.query("SELECT id FROM accounting_events WHERE id=$1", [event.id])).rows).toHaveLength(1);
    await expect(client.query("DELETE FROM accounting_events WHERE id=$1", [event.id]))
      .rejects.toMatchObject({ code: "42501" });
  } finally { await client.query("ROLLBACK"); client.release(); }
});

async function runtimeService<T>(operation: () => Promise<T>) {
  const client = await pool.connect(), previous = state.db;
  try {
    await client.query(`SET ROLE "${runtimeRole}"`);
    state.db = drizzle(client, { schema });
    return await operation();
  } finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
}

it("posts recognition and partial/full manual payments using only runtime migration privileges", async () => {
  const id = await expense();
  await runtimeService(async () => {
    expect((await recognizeExpense(ctx, id)).status).toBe("POSTED");
    expect((await manual(id, 4000)).journal?.status).toBe("POSTED");
    expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
    expect((await manual(id, 6000)).journal?.status).toBe("POSTED");
    expect((await listExpensePayments(ctx, id)).remainingCents).toBe(0);
  });
  expect((await pool.query("SELECT status FROM operating_expenses WHERE id=$1", [id])).rows[0].status).toBe("PAID");
});

it("settles and rejects treasury applications using only runtime migration privileges", async () => {
  const id = await expense();
  const first = await runtimeService(() => pending(id, 4000));
  await pool.query("UPDATE payment_run_items SET settlement_status='CONFIRMED' WHERE id=$1", [first.payment.paymentRunItemId]);
  await runtimeService(async () => {
    const result = await withCompanyContext(ctx, tx => confirmPaymentIn(tx, companyId, actorId, {
      paymentId: first.payment.id, paidAt: "2026-10-20", reference: "RUNTIME-CONFIRMED",
    }));
    expect(result.journal?.status).toBe("POSTED");
  });
  const second = await runtimeService(() => pending(id, 3000));
  await runtimeService(async () => {
    expect((await withCompanyContext(ctx, tx => failPaymentIn(tx, companyId, actorId, {
      paymentId: second.payment.id, reason: "Rechazo sintético runtime",
    }))).status).toBe("FAILED");
    expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
  });
});

it("enforces runtime payment RLS without context and across companies, with no delete privilege", async () => {
  const id = await expense();
  const payment = await manual(id, 1000);
  const scoped = async (company: string | null, query: string, values: unknown[] = []) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
      await client.query("SELECT set_config('app.current_company_id',$1,true)", [company ?? ""]);
      const result = await client.query(query, values);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  };
  for (const company of [null, foreignCompany]) {
    expect((await scoped(company, "SELECT id FROM expense_payments WHERE id=$1", [payment.payment.id])).rows).toEqual([]);
    expect((await scoped(company, "UPDATE expense_payments SET pending_reason='Ajeno' WHERE id=$1 RETURNING id",
      [payment.payment.id])).rows).toEqual([]);
    await expect(scoped(company, `INSERT INTO expense_payments
      (company_id,branch_id,expense_id,amount_cents,paid_at,source,created_by)
      VALUES ($1,$2,$3,100,'2026-10-15','MANUAL',$4)`, [companyId, branchId, id, actorId]))
      .rejects.toMatchObject({ code: "42501" });
  }
  expect((await scoped(companyId, "SELECT id FROM expense_payments WHERE id=$1", [payment.payment.id])).rows)
    .toEqual([{ id: payment.payment.id }]);
  await expect(scoped(companyId, "DELETE FROM expense_payments WHERE id=$1", [payment.payment.id]))
    .rejects.toMatchObject({ code: "42501" });
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
    expect((await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows).toEqual([]);
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
  expect((await pool.query("SELECT status,last_error FROM accounting_events WHERE source_id=$1", [id])).rows)
    .toEqual([{ status: "PENDING", last_error: expect.any(String) }]);
});

it("recovers a committed fact after a worker failure and two concurrent restarts without duplicating the journal", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  await pool.query("UPDATE operating_expenses SET tax_amount=NULL WHERE id=$1", [id]);
  await approve(id);
  const event = (await pool.query("SELECT * FROM accounting_events WHERE source_id=$1", [id])).rows[0];
  expect(event).toMatchObject({ status: "PENDING", journal_id: null, attempts: 1 });
  expect((await listPendingAccountingEvents(ctx, { page: 1, pageSize: 100 })).items)
    .toContainEqual(expect.objectContaining({ id: event.id, lastError: expect.stringContaining("impuesto"), ageSeconds: expect.any(Number) }));
  await pool.query("UPDATE operating_expenses SET tax_amount=0 WHERE id=$1", [id]);
  await pool.query(`CREATE FUNCTION recovery_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected connection failure'; END $$`);
  await pool.query(`CREATE TRIGGER recovery_failure BEFORE INSERT ON accounting_journals
    FOR EACH ROW EXECUTE FUNCTION recovery_failure()`);
  try {
    await expect(processAccountingEvent(companyId, event.id)).rejects.toThrow();
    expect((await pool.query("SELECT status,last_error,attempts FROM accounting_events WHERE id=$1", [event.id])).rows[0])
      .toMatchObject({ status: "PENDING", last_error: expect.any(String), attempts: 2 });
    expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
  } finally {
    await pool.query("DROP TRIGGER recovery_failure ON accounting_journals");
    await pool.query("DROP FUNCTION recovery_failure()");
  }
  await Promise.all([processAccountingEvent(companyId, event.id), processAccountingEvent(companyId, event.id)]);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toHaveLength(1);
  expect((await pool.query("SELECT status,last_error,journal_id FROM accounting_events WHERE id=$1", [event.id])).rows[0])
    .toMatchObject({ status: "POSTED", last_error: null, journal_id: expect.any(String) });
});

it("keeps recovery pending in a closed period and rejects another tenant, branch and unauthorized actor", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  await pool.query("UPDATE operating_expenses SET business_date='2026-09-01',tax_amount=NULL WHERE id=$1", [id]);
  await approve(id);
  const event = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows[0];
  await pool.query("UPDATE operating_expenses SET tax_amount=0 WHERE id=$1", [id]);
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2026,9,'CLOSED')", [companyId]);
  try {
    expect((await retryAccountingEvent(ctx, event.id)).reason).toContain("cerrado");
    await expect(processAccountingEvent(foreignCompany, event.id)).rejects.toMatchObject({ statusCode: 404 });
    const managerId = randomUUID(), hiddenBranch = randomUUID();
    await pool.query("INSERT INTO branches (id,company_id,name) VALUES ($1,$2,'Oculta')", [hiddenBranch, companyId]);
    await pool.query(`INSERT INTO users (id,email,role,company_id,branch_id,created_at,updated_at)
      VALUES ($1,$2,'GERENTE',$3,$4,now(),now())`, [managerId, `${managerId}@fixture.invalid`, companyId, hiddenBranch]);
    const manager = { companyId, actorId: managerId, role: "GERENTE" as const };
    expect((await listPendingAccountingEvents(manager, { page: 1, pageSize: 100 })).items).toEqual([]);
    await expect(retryAccountingEvent(manager, event.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(listPendingAccountingEvents(manager, { page: 1, pageSize: 100, branchId })).rejects.toMatchObject({ statusCode: 403 });
    vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0");
    await expect(processAccountingEvent(companyId, event.id)).rejects.toMatchObject({ statusCode: 503 });
  } finally { await pool.query("DELETE FROM financial_periods WHERE company_id=$1 AND year=2026 AND month=9", [companyId]); }
});

it("repairs missing facts with tenant context and recovers confirmed payments with the runtime role", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  expect(await runtimeService(() => withCompanyContext(ctx,
    tx => tx.select({ id: schema.companies.id }).from(schema.companies))))
    .toContainEqual({ id: companyId });
  const id = await expense();
  await pool.query("UPDATE operating_expenses SET tax_amount=NULL WHERE id=$1", [id]);
  await runtimeService(() => recoverMissingAccountingEvents(companyId));
  const recognition = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows[0];
  expect(await runtimeService(() => dueAccountingEvents(companyId)))
    .toContainEqual({ id: recognition.id });
  const payment = await manual(id, 2000);
  const event = (await pool.query("SELECT * FROM accounting_events WHERE source_id=$1", [payment.payment.id])).rows[0];
  expect(event.status).toBe("PENDING");
  expect((await dueAccountingEvents(companyId)).map(row => row.id)).not.toContain(event.id);
  await pool.query("UPDATE operating_expenses SET tax_amount=0 WHERE id=$1", [id]);
  await runtimeService(() => processAccountingEvent(companyId, event.id));
  await processAccountingEvent(companyId, event.id);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [payment.payment.id])).rows).toHaveLength(1);
  expect((await listExpensePayments(ctx, id)).items[0]).toMatchObject({ pendingReason: null, accountingJournalId: expect.any(String) });
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(8000);
  expect((await pool.query("SELECT status FROM accounting_events WHERE source_id=$1", [id])).rows[0].status).toBe("POSTED");
});

it("survives a simulated transport outage after source commit and retries against Postgres", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await expense(10000, "PENDING_APPROVAL");
  await pool.query("UPDATE operating_expenses SET tax_amount=NULL WHERE id=$1", [id]);
  await approve(id);
  const event = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows[0];
  await pool.query("UPDATE operating_expenses SET tax_amount=0 WHERE id=$1", [id]);
  const connect = vi.spyOn(pool, "connect").mockRejectedValueOnce(new Error("ECONNRESET synthetic transport failure"));
  try { await expect(processAccountingEvent(companyId, event.id)).rejects.toThrow("ECONNRESET"); }
  finally { connect.mockRestore(); }
  expect((await pool.query("SELECT status,last_error FROM accounting_events WHERE id=$1", [event.id])).rows[0])
    .toMatchObject({ status: "PENDING", last_error: expect.any(String) });
  await processAccountingEvent(companyId, event.id);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toHaveLength(1);
});

it("keeps the disabled approval/payment path free of accounting writes", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0");
  const id = await expense(10000, "PENDING_APPROVAL");
  expect((await approve(id)).status).toBe("APPROVED");
  expect((await payBalance(id)).status).toBe("PAID");
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
  expect((await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows).toEqual([]);
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

async function pending(expenseId: string, amountCents: number, sourceBankId: string | null = treasuryBankId) {
  const run = randomUUID(), item = randomUUID();
  await pool.query(`INSERT INTO payment_runs (id,company_id,title,run_date,prepared_by,source_bank_account_id,source_account)
    VALUES ($1,$2,'Corrida sintética','2026-10-10',$3,$4,$5)`,
  [run, companyId, actorId, sourceBankId, sourceBankId ? "012345678901234" : null]);
  await pool.query(`INSERT INTO payment_run_items (id,payment_run_id,item_type,reference_id,amount_cents)
    VALUES ($1,$2,'OPERATING_EXPENSE',$3,$4)`, [item, run, expenseId, amountCents]);
  return recordExpensePayment(ctx, { expenseId, amountCents, paidAt: "2026-10-10", source: "TREASURY", paymentRunItemId: item });
}

it("guided classification posts each existing cost center to its linked account and preserves retry identity", async () => {
  for (const [code, kind, amount] of [["GUIDED_MAINT", "EXPENSE", 5000], ["GUIDED_CAPEX", "ASSET", 7000]] as const) {
    const centerId = randomUUID();
    await pool.query(`INSERT INTO cost_centers (id,company_id,code,name,accounting_line)
      VALUES ($1,$2,$3,$3,$3)`, [centerId, companyId, code]);
    const account = await createAccount(ctx, { code, name: code, kind,
      normalBalance: "DEBIT", validFrom: "2026-01-01" });
    await linkSource(ctx, { costCenterId: centerId, accountId: account.id });
    const id = await expense(amount);
    await pool.query("UPDATE operating_expenses SET cost_center_id=$1 WHERE id=$2", [centerId, id]);

    const journal = await runtimeService(() => recognizeExpense(ctx, id));
    const revisedAccount = await createAccount(ctx, { code: `${code}_NEXT`, name: `${code} revisada`, kind,
      normalBalance: "DEBIT", validFrom: "2026-01-01" });
    await linkSource(ctx, { costCenterId: centerId, accountId: revisedAccount.id });
    expect((await runtimeService(() => recognizeExpense(ctx, id))).id).toBe(journal.id);
    const lines = await pool.query(`SELECT account_id,cost_center_id,debit_cents::int AS debit_cents,credit_cents::int AS credit_cents
      FROM accounting_journal_lines WHERE journal_id=$1 AND debit_cents>0`, [journal.id]);
    expect(lines.rows).toEqual([{ account_id: account.id, cost_center_id: centerId,
      debit_cents: amount, credit_cents: 0 }]);
    expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toHaveLength(1);
  }
});

it("guided classification keeps an expense with an unlinked existing cost center pending", async () => {
  const centerId = randomUUID();
  await pool.query(`INSERT INTO cost_centers (id,company_id,code,name)
    VALUES ($1,$2,'GUIDED_UNLINKED','Partida sin vínculo')`, [centerId, companyId]);
  const id = await expense(10000, "PENDING_APPROVAL");
  await pool.query("UPDATE operating_expenses SET cost_center_id=$1 WHERE id=$2", [centerId, id]);
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  await approve(id);
  expect((await pool.query("SELECT status FROM operating_expenses WHERE id=$1", [id])).rows[0].status).toBe("APPROVED");
  await expect(runtimeService(() => recognizeExpense(ctx, id))).rejects.toMatchObject({ statusCode: 409 });
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
  expect((await pool.query("SELECT status,last_error FROM accounting_events WHERE source_id=$1", [id])).rows)
    .toEqual([expect.objectContaining({ status: "PENDING", last_error: expect.any(String) })]);
});

it("guided treasury posts a second selected bank to its own linked account instead of the generic source", async () => {
  const bank = await ownBank();
  const account = await createAccount(ctx, { code: "GUIDED_SECOND_BANK", name: "Banco de otra corrida", kind: "ASSET",
    normalBalance: "DEBIT", validFrom: "2026-01-01" });
  await linkSource(ctx, { bankAccountId: bank, accountId: account.id });
  const id = await expense(), application = await pending(id, 4000, bank);
  await pool.query("UPDATE payment_run_items SET settlement_status='CONFIRMED' WHERE id=$1", [application.payment.paymentRunItemId]);
  const posted = await runtimeService(() => withCompanyContext(ctx, tx => confirmPaymentIn(tx, companyId, actorId, {
    paymentId: application.payment.id, paidAt: "2026-10-20",
  })));
  expect(posted.journal?.status).toBe("POSTED");
  const lines = await pool.query(`SELECT account_id,credit_cents::int AS credit_cents FROM accounting_journal_lines
    WHERE journal_id=$1 AND credit_cents>0`, [posted.journal!.id]);
  expect(lines.rows).toEqual([{ account_id: account.id, credit_cents: 4000 }]);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
});

it("guided preview explains an existing expense without creating accounting events or journals", async () => {
  const centerId = randomUUID();
  await pool.query(`INSERT INTO cost_centers (id,company_id,code,name)
    VALUES ($1,$2,'GUIDED_PREVIEW','Partida para vista previa')`, [centerId, companyId]);
  const account = await createAccount(ctx, { code: "GUIDED_PREVIEW", name: "Mantenimiento revisado", kind: "EXPENSE",
    normalBalance: "DEBIT", validFrom: "2026-01-01" });
  await linkSource(ctx, { costCenterId: centerId, accountId: account.id });
  const id = await expense(5000);
  await pool.query("UPDATE operating_expenses SET cost_center_id=$1 WHERE id=$2", [centerId, id]);
  const preview = await runtimeService(() => previewExpenseRecognition(ctx, id));
  expect(preview).toMatchObject({ published: false, reason: null, date: "2026-10-01" });
  expect(preview.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ accountId: account.id, accountName: "Mantenimiento revisado", debitCents: 5000, creditCents: 0 }),
  ]));
  expect((await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows).toEqual([]);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toEqual([]);
});

it("guided preparation reads only its existing operational catalogs with runtime grants and no sensitive bank data", async () => {
  const centerId = randomUUID(), foreignCenter = randomUUID(), bankId = await ownBank(), foreignBank = await ownBank(foreignCompany);
  await pool.query(`INSERT INTO cost_centers (id,company_id,code,name,accounting_line) VALUES
    ($1,$2,'GUIDED_CATALOG','Partida propia','OPEX-MANT'),($3,$4,'GUIDED_FOREIGN','Partida ajena','AJENA')`,
  [centerId, companyId, foreignCenter, foreignCompany]);
  const foreignExpense = randomUUID(), foreignBranch = randomUUID();
  await pool.query("INSERT INTO branches (id,company_id,name,code) VALUES ($1,$2,'Sucursal ajena','FOREIGN')", [foreignBranch, foreignCompany]);
  await pool.query(`INSERT INTO operating_expenses
    (id,company_id,branch_id,category,amount,description,status,requested_by,approved_by,business_date,tax_amount)
    VALUES ($1,$2,$3,'OTROS',3000,'Gasto ajeno','APPROVED',$4,$4,'2026-10-01',0)`, [foreignExpense, foreignCompany, foreignBranch, actorId]);
  const preparation = await runtimeService(() => readAccountingPreparation(ctx));
  await expect(runtimeService(() => previewExpenseRecognition(ctx, foreignExpense))).rejects.toMatchObject({ statusCode: 404 });
  expect(preparation.centers).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: centerId, name: "Partida propia", accountingLine: "OPEX-MANT" }),
  ]));
  expect(preparation.centers.some(center => center.id === foreignCenter)).toBe(false);
  expect(preparation.banks.some(bank => bank.id === foreignBank)).toBe(false);
  expect(preparation.expenses.some(expense => expense.id === foreignExpense)).toBe(false);
  expect(preparation.banks.find(bank => bank.id === bankId)).toEqual({ id: bankId, label: "Banco sintético",
    lastFour: "1234", purpose: expect.any(String), currency: "MXN" });
  for (const bank of preparation.banks) expect(Object.keys(bank).sort()).toEqual(["currency", "id", "label", "lastFour", "purpose"]);
});

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

it("connects real treasury creation, approval, layout and settlement to its selected bank", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  state.allowTreasuryConfiguration = true;
  const id = await expense(10000, "PENDING_APPROVAL");
  await approve(id);
  const payee = randomUUID(), destination = randomUUID(), reviewer = randomUUID();
  await pool.query("INSERT INTO payees (id,company_id,name) VALUES ($1,$2,'Contraparte sintética')", [payee, companyId]);
  await pool.query(`INSERT INTO payee_bank_accounts
    (id,company_id,payee_id,clabe,clabe_last4,clabe_fingerprint,bank_code,bank_name,account_holder_name,status,registered_by)
    VALUES ($1,$2,$3,$4,'1234',$5,'012','Banco destino','Contraparte sintética','VERIFIED',$6)`,
  [destination, companyId, payee, encryptColumnWithDek("012345678901231234", Buffer.alloc(32, 9)), randomUUID(), actorId]);
  await pool.query("UPDATE operating_expenses SET payee_id=$1 WHERE id=$2", [payee, id]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at)
    VALUES ($1,'reviewer@fixture.invalid','ADMIN',$2,now(),now())`, [reviewer, companyId]);
  const run = await TreasuryService.createPaymentRun(companyId, "Recorrido bancario", new Date("2026-10-15T12:00:00Z"),
    actorId, branchId, treasuryBankId);
  expect(run).toMatchObject({ sourceBankAccountId: treasuryBankId, sourceAccount: "012345678901234" });
  await pool.query("UPDATE payee_bank_accounts SET status='PENDING_VERIFICATION' WHERE id=$1", [destination]);
  await expect(TreasuryService.addItemToRun({ paymentRunId: run.id, companyId,
    itemType: "OPERATING_EXPENSE", referenceId: id, amountCents: 4000 })).rejects.toMatchObject({ statusCode: 400 });
  expect((await pool.query("SELECT id FROM payment_run_items WHERE payment_run_id=$1", [run.id])).rows).toEqual([]);
  expect((await listExpensePayments(ctx, id)).items).toEqual([]);
  await pool.query("UPDATE payee_bank_accounts SET status='VERIFIED' WHERE id=$1", [destination]);
  const item = await TreasuryService.addItemToRun({ paymentRunId: run.id, companyId,
    itemType: "OPERATING_EXPENSE", referenceId: id, amountCents: 4000 });
  expect(item.payeeBankAccountId).toBe(destination);
  expect((await listExpensePayments(ctx, id))).toMatchObject({ remainingCents: 10000,
    items: [expect.objectContaining({ status: "PENDING", amountCents: 4000, accountingJournalId: null })] });
  await expect(TreasuryService.generateBankDisbursementLayout(run.id, companyId, "OWNER"))
    .rejects.toMatchObject({ statusCode: 400 });
  await TreasuryService.updatePaymentRunStatus(run.id, companyId, "PENDING_APPROVAL", actorId, "OWNER");
  await expect(TreasuryService.updatePaymentRunStatus(run.id, companyId, "APPROVED", actorId, "OWNER"))
    .rejects.toMatchObject({ statusCode: 403 });
  await TreasuryService.updatePaymentRunStatus(run.id, companyId, "APPROVED", reviewer, "ADMIN");
  await expect(TreasuryService.generateBankDisbursementLayout(run.id, companyId, "GERENTE"))
    .rejects.toMatchObject({ statusCode: 403 });
  const layout = await TreasuryService.generateBankDisbursementLayout(run.id, companyId, "OWNER");
  expect(layout).toMatchObject({ recordCount: 1, totalPesos: "40.00", excludedCount: 0 });
  expect(layout.content.split("\n")[1]).toContain('"012345678901234","012345678901231234",');
  expect((await TreasuryService.generateBankDisbursementLayout(run.id, companyId, "OWNER")).content).toBe(layout.content);
  await TreasuryService.updatePaymentRunStatus(run.id, companyId, "PROCESSING", reviewer, "ADMIN");
  const settle = { paymentRunId: run.id, itemId: item.id, companyId, userId: reviewer, actorRole: "ADMIN" as const,
    settlementStatus: "CONFIRMED" as const, reference: "BANK-CIRCUIT-SYN" };
  await TreasuryService.settlePaymentRunItem(settle);
  expect((await TreasuryService.settlePaymentRunItem(settle)).accion).toBe("SIN_CAMBIO");
  const result = await listExpensePayments(ctx, id);
  expect(result.remainingCents).toBe(6000);
  expect(result.items[0]).toMatchObject({ status: "CONFIRMED", pendingReason: null });
  const credit = await pool.query(`SELECT l.account_id FROM accounting_journal_lines l
    JOIN accounting_source_links s ON s.account_id=l.account_id AND s.company_id=l.company_id
    WHERE l.journal_id=$1 AND l.credit_cents=4000 AND s.bank_account_id=$2`,
  [result.items[0].accountingJournalId, treasuryBankId]);
  expect(credit.rows).toHaveLength(1);
  await TreasuryService.updatePaymentRunStatus(run.id, companyId, "COMPLETED", reviewer, "ADMIN");
  expect((await listExpensePayments(ctx, id)).items).toHaveLength(1);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
}, 120000);

it("validates treasury bank eligibility and detects a changed account number before emitting a layout", async () => {
  const create = (bank: string) => TreasuryService.createPaymentRun(companyId, "Validación de origen", new Date("2026-10-15T12:00:00Z"),
    actorId, branchId, bank);
  for (const bank of [await ownBank(foreignCompany), await ownBank(companyId, "MXN", false), await ownBank(companyId, "USD")]) {
    await expect(create(bank)).rejects.toMatchObject({ statusCode: 400 });
    expect((await pool.query("SELECT id FROM payment_runs WHERE source_bank_account_id=$1", [bank])).rows).toEqual([]);
  }
  // Purpose is intentionally overridable in the existing product.
  const bank = await ownBank();
  await pool.query("UPDATE company_bank_accounts SET purpose='RECEPCION' WHERE id=$1", [bank]);
  const run = await create(bank);
  expect(run.sourceBankAccountId).toBe(bank);
  await pool.query("UPDATE payment_runs SET status='APPROVED' WHERE id=$1", [run.id]);
  await pool.query("UPDATE company_bank_accounts SET active=false WHERE id=$1", [bank]);
  await expect(TreasuryService.generateBankDisbursementLayout(run.id, companyId, "OWNER"))
    .rejects.toMatchObject({ statusCode: 400 });
  await pool.query("UPDATE company_bank_accounts SET active=true,account_number=$1 WHERE id=$2",
    [encryptColumnWithDek("999999999999999", Buffer.alloc(32, 9)), bank]);
  await expect(TreasuryService.generateBankDisbursementLayout(run.id, companyId, "OWNER"))
    .rejects.toMatchObject({ statusCode: 409 });
  await expect(TreasuryService.generateBankDisbursementLayout(run.id, foreignCompany, "OWNER"))
    .rejects.toMatchObject({ statusCode: 404 });
});

it("keeps an unlinked treasury bank pending and recovers to its explicit account even when different from the generic source", async () => {
  const bank = await ownBank(), id = await expense();
  const application = await pending(id, 4000, bank);
  await pool.query("UPDATE payment_run_items SET settlement_status='CONFIRMED' WHERE id=$1", [application.payment.paymentRunItemId]);
  const result = await withCompanyContext(ctx, tx => confirmPaymentIn(tx, companyId, actorId, {
    paymentId: application.payment.id, paidAt: "2026-10-20",
  }));
  expect(result.journal).toBeNull();
  expect(result.pendingReason).toContain("bancaria");
  const other = await createAccount(ctx, { code: "OTHER_BANK", name: "Otro banco", kind: "ASSET", normalBalance: "DEBIT", validFrom: "2026-01-01" });
  await linkSource(ctx, { bankAccountId: bank, accountId: other.id });
  const recover = () => runtimeService(() => withCompanyContext(ctx, async tx => {
    const [payment] = await tx.select().from(schema.expensePayments).where(eq(schema.expensePayments.id, application.payment.id));
    return postPaymentIn(tx, companyId, actorId, payment);
  }));
  const recovered = await recover();
  expect(recovered.journal?.status).toBe("POSTED");
  expect((await pool.query(`SELECT account_id FROM accounting_journal_lines
    WHERE journal_id=$1 AND credit_cents=4000`, [recovered.journal!.id])).rows).toEqual([{ account_id: other.id }]);
  expect((await recover()).journal?.id).toBe(recovered.journal?.id);
  expect((await listExpensePayments(ctx, id)).remainingCents).toBe(6000);
});

it("keeps legacy treasury sources and inactive banks pending instead of using a generic bank account", async () => {
  for (const source of [null, await ownBank()]) {
    const id = await expense(), application = await pending(id, 4000, source);
    if (source) await pool.query("UPDATE company_bank_accounts SET active=false WHERE id=$1", [source]);
    await pool.query("UPDATE payment_run_items SET settlement_status='CONFIRMED' WHERE id=$1", [application.payment.paymentRunItemId]);
    const result = await withCompanyContext(ctx, tx => confirmPaymentIn(tx, companyId, actorId, {
      paymentId: application.payment.id, paidAt: "2026-10-20",
    }));
    expect(result.journal).toBeNull();
    expect(result.pendingReason).toContain("bancaria");
    expect((await listExpensePayments(ctx, id))).toMatchObject({ remainingCents: 6000,
      items: [expect.objectContaining({ status: "CONFIRMED", accountingJournalId: null })] });
  }
});

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
