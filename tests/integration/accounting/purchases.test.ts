import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { declarePurchase } from "@/lib/services/accounting/purchase-adapter";
import { processAccountingEvent, retryAccountingEvent } from "@/lib/services/accounting/event-service";
import { createDraft, publishDraft, reverseJournal } from "@/lib/services/accounting/journal-service";
import { TreasuryService } from "@/lib/services/treasury-service";
import { InventoryService } from "@/lib/services/inventory-service";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { processReceiving } from "@/lib/services/receiving-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
// Derived price notifications are outside the transactional receiving/accounting circuit.
vi.mock("@/lib/services/stock-alert-service", () => ({ StockAlertService: { checkPriceIncrease: vi.fn() } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc13_${randomUUID().replaceAll("-", "")}`, runtimeRole = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), branchId = randomUUID(), supplierId = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
const accounts: Record<string, string> = {};
let created = false, roleCreated = false;

beforeAll(async () => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  let verified = false;
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const value = parse(readFileSync(file)).DATABASE_URL;
    if (!value) continue;
    const operative = new URL(value); verified = true;
    if (target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
      && target.pathname === operative.pathname) throw new Error("La base de pruebas coincide con la operativa.");
  }
  if (!verified) throw new Error("No se pudo comprobar el aislamiento.");
  await pool.query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const type of [schema.expensePaymentMethodEnum, schema.terminalAcquirerEnum]) {
    await pool.query(`CREATE TYPE "${namespace}".${type.enumName} AS ENUM (${type.enumValues.map(v => `'${v}'`).join(",")})`);
  }
  for (const table of ["companies", "users", "cost_centers", "company_bank_accounts", "branches", "financial_periods",
    "operating_expenses", "payment_runs", "payment_run_items", "daily_sales_cuts", "gateway_transactions", "bank_transactions",
    "suppliers", "inventory_items", "inventory_batches", "inventory_movements", "receiving_reports", "receiving_report_items",
    "invoices", "invoice_lines", "credit_notes", "inventory_periods", "inventory_price_history", "inventory_audit_log"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id)`);
  }
  // Reconstruct the pre-0132 shape only inside this random test namespace.
  await pool.query(`ALTER TABLE "${namespace}".payment_runs DROP COLUMN IF EXISTS source_bank_account_id`);
  await pool.query("INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena')", [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at)
    VALUES ($1,'purchase@fixture.invalid','OWNER',$2,now(),now())`, [actorId, companyId]);
  await pool.query("INSERT INTO branches (id,company_id,name,code,ownership_type) VALUES ($1,$2,'Sucursal sintética','SYN','OWNED')", [branchId, companyId]);
  await pool.query("INSERT INTO suppliers (id,company_id,name) VALUES ($1,$2,'Proveedor sintético')", [supplierId, companyId]);
  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules", "0131_fc09_expense_payments", "0132_fc09_treasury_source",
    "0133_fc10_accounting_events", "0134_fc11_sales", "0136_fc12_settlements", "0140_fc13_purchases"]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`).replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
      .replaceAll("rolname='pulso_app'", `rolname='${runtimeRole}'`).replaceAll("TO pulso_app", `TO "${runtimeRole}"`);
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  }
  state.db = drizzle(pool, { schema });
  for (const [role, kind] of Object.entries({ INVENTORY: "ASSET", RECEIVING_PENDING: "LIABILITY", PAYABLE: "LIABILITY",
    RECOVERABLE_TAX: "ASSET", PURCHASE_VARIANCE: "EXPENSE", PAYMENT_SOURCE: "ASSET" })) {
    accounts[role] = (await createAccount(ctx, { code: role, name: role, kind,
      normalBalance: kind === "LIABILITY" ? "CREDIT" : "DEBIT", validFrom: "2026-01-01" })).id;
  }
  for (const event of ["PURCHASE_RECEIVED", "PURCHASE_INVOICED", "PURCHASE_CREDITED", "INVOICE_PAID"]) {
    await createRule(ctx, { code: event, name: event, eventType: event, effectiveFrom: "2026-01-01",
      entries: Object.keys(accounts).map(role => ({ role, accountId: accounts[role] })) });
  }
}, 120000);
beforeEach(() => vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${runtimeRole}"`);
  } finally { await pool.end(); }
});

async function runtime<T>(operation: () => Promise<T>) {
  const client = await pool.connect(), previous = state.db;
  try { await client.query(`SET ROLE "${runtimeRole}"`); state.db = drizzle(client, { schema }); return await operation(); }
  finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
}

async function receipt(date = "2026-10-08") {
  const id = randomUUID(), itemId = randomUUID(), batchId = randomUUID();
  await pool.query("INSERT INTO inventory_items (id,company_id,name,unit,last_cost) VALUES ($1,$2,'Insumo sintético','KG',6000)", [itemId, companyId]);
  await pool.query("INSERT INTO receiving_reports (id,company_id,branch_id,supplier_id,received_by,received_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, companyId, branchId, supplierId, actorId, date]);
  await pool.query("INSERT INTO receiving_report_items (receiving_report_id,item_id,received_quantity,unit_cost,line_total) VALUES ($1,$2,10,6000,60000)", [id, itemId]);
  await pool.query(`INSERT INTO inventory_batches (id,item_id,branch_id,lot_number,initial_quantity,current_quantity,unit_cost,status,supplier_batch_info)
    VALUES ($1,$2,$3,'SYN-LOT',10,10,6000,'AVAILABLE',$4)`, [batchId, itemId, branchId, JSON.stringify({ receivingReportId: id })]);
  return { id, itemId, batchId, date };
}
const declareReceipt = (source: Awaited<ReturnType<typeof receipt>>) => declarePurchase(ctx, { sourceType: "RECEIVING_REPORT",
  sourceId: source.id, accountingDate: source.date, documentReference: "SYN-RECEIPT", reason: "Valoración sintética revisada", valuationConfirmed: true });
async function invoice(source: Awaited<ReturnType<typeof receipt>>, options: { net?: number; tax?: number; matched?: string; linked?: boolean } = {}) {
  const id = randomUUID(), net = options.net ?? 60000, tax = options.tax ?? 0;
  await pool.query(`INSERT INTO invoices (id,company_id,branch_id,supplier_id,receiving_report_id,uuid,fecha,subtotal,tax_amount,total,rfc_emisor,rfc_receptor,match_status,
    exception_approved_by,exception_approved_at,exception_reason)
    VALUES ($1,$2,$3,$4,$5,$6,'2026-10-09',$7,$8,$9,'SYN010101AAA','SYN010101BBB',$10,$11,$12,$13)`,
  [id, companyId, branchId, supplierId, options.linked === false ? null : source.id, randomUUID(), net, tax, net + tax,
    options.matched ?? "MATCHED", options.matched === "EXCEPTION_APPROVED" ? actorId : null,
    options.matched === "EXCEPTION_APPROVED" ? new Date() : null, options.matched === "EXCEPTION_APPROVED" ? "Diferencia documentada" : null]);
  return id;
}
const declareInvoice = (id: string) => declarePurchase(ctx, { sourceType: "PURCHASE_INVOICE", sourceId: id,
  accountingDate: "2026-10-09", documentReference: "SYN-INVOICE", reason: "Factura sintética revisada" });
async function lines(journalId: string) {
  return (await pool.query(`SELECT memo,debit_cents::int,credit_cents::int FROM accounting_journal_lines WHERE journal_id=$1 ORDER BY line_number`, [journalId])).rows;
}

async function payment(invoiceId: string, amount: number, linked = true) {
  const bankId = randomUUID(), runId = randomUUID(), itemId = randomUUID();
  const number = encryptColumnWithDek("012345678901234", Buffer.alloc(32, 9));
  await pool.query(`INSERT INTO company_bank_accounts
    (id,company_id,label,account_number,account_last_four,account_fingerprint,bank_code,bank_name,registered_by,currency,active)
    VALUES ($1,$2,'Banco sintético',$3,'1234',$4,'012','Banco',$5,'MXN',true)`,
    [bankId, companyId, number, randomUUID(), actorId]);
  if (linked) await pool.query(`INSERT INTO accounting_source_links (company_id,account_id,bank_account_id,created_by,updated_by)
    VALUES ($1,$2,$3,$4,$4)`, [companyId, accounts.PAYMENT_SOURCE, bankId, actorId]);
  await pool.query(`INSERT INTO payment_runs (id,company_id,branch_id,title,run_date,status,prepared_by,source_bank_account_id,source_account)
    VALUES ($1,$2,$3,'Pago sintético',now(),'APPROVED',$4,$5,$6)`, [runId, companyId, branchId, actorId, bankId, number]);
  await pool.query(`INSERT INTO payment_run_items (id,payment_run_id,item_type,reference_id,amount_cents)
    VALUES ($1,$2,'INVOICE',$3,$4)`, [itemId, runId, invoiceId, amount]);
  return { bankId, runId, itemId };
}
const confirm = (item: Awaited<ReturnType<typeof payment>>) => TreasuryService.settlePaymentRunItem({ companyId,
  paymentRunId: item.runId, itemId: item.itemId, settlementStatus: "CONFIRMED", userId: actorId,
  actorRole: "OWNER", reference: "SYN-EVIDENCE" });

async function credit(invoiceId: string, net: number, tax: number) {
  const id = randomUUID();
  await pool.query(`INSERT INTO credit_notes (id,company_id,invoice_id,uuid,fecha,subtotal,tax_amount,total,reason)
    VALUES ($1,$2,$3,$4,'2026-10-10',$5,$6,$7,'Devolución documentada')`, [id, companyId, invoiceId, randomUUID(), net, tax, net + tax]);
  return id;
}
const declareCredit = (id: string, returnMovementIds: string[] = []) => declarePurchase(ctx, { sourceType: "PURCHASE_CREDIT",
  sourceId: id, accountingDate: "2026-10-10", documentReference: "SYN-CREDIT", reason: "Crédito sintético revisado",
  creditTreatment: returnMovementIds.length ? "RETURN" : "PRICE_ADJUSTMENT", returnMovementIds });

it("recognizes the FC-02 acquisition once and only reclassifies its invoice", async () => {
  const source = await receipt();
  const received = await runtime(() => declareReceipt(source));
  expect(received.reason).toBeNull();
  expect(await lines(received.journal!.id)).toEqual([
    { memo: "PURCHASE:INVENTORY", debit_cents: 60000, credit_cents: 0 }, { memo: "PURCHASE:RECEIVING_PENDING", debit_cents: 0, credit_cents: 60000 }]);
  const id = await invoice(source), invoiced = await runtime(() => declareInvoice(id));
  expect(await lines(invoiced.journal!.id)).toEqual([
    { memo: "PURCHASE:RECEIVING_PENDING", debit_cents: 60000, credit_cents: 0 }, { memo: "PURCHASE:PAYABLE", debit_cents: 0, credit_cents: 60000 }]);
  expect((await runtime(() => declareInvoice(id))).journal!.id).toBe(invoiced.journal!.id);
  await pool.query("UPDATE inventory_items SET last_cost=99999 WHERE id=$1", [source.itemId]);
  expect((await runtime(() => declareReceipt(source))).journal!.id).toBe(received.journal!.id);
  expect((await pool.query("SELECT current_quantity::text FROM inventory_batches WHERE id=$1", [source.batchId])).rows[0].current_quantity).toBe("10.0000");
});

it("keeps an invoice arriving before receipt pending until the existing receipt is linked", async () => {
  const source = await receipt();
  const id = await invoice(source, { linked: false });
  await expect(declareInvoice(id)).rejects.toMatchObject({ statusCode: 409 });
  await declareReceipt(source);
  await pool.query("UPDATE invoices SET receiving_report_id=$2 WHERE id=$1", [id, source.id]);
  expect((await declareInvoice(id)).journal).toBeTruthy();
});

it("refuses unresolved discrepancies and posts reviewed price differences without another inventory debit", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source, { net: 61000, tax: 9760, matched: "DISCREPANCY" });
  await expect(declareInvoice(id)).rejects.toMatchObject({ statusCode: 409 });
  await pool.query("UPDATE invoices SET match_status='EXCEPTION_APPROVED',exception_approved_by=$2,exception_approved_at=now(),exception_reason='Precio revisado' WHERE id=$1", [id, actorId]);
  const result = await declareInvoice(id);
  expect(await lines(result.journal!.id)).toContainEqual({ memo: "PURCHASE:PURCHASE_VARIANCE", debit_cents: 1000, credit_cents: 0 });
  expect((await lines(result.journal!.id)).some(row => row.memo === "PURCHASE:INVENTORY")).toBe(false);
});

it("denies another company, hidden branch, disabled posting and missing valuation review", async () => {
  const source = await receipt();
  await expect(declarePurchase({ ...ctx, companyId: foreignCompany }, { sourceType: "RECEIVING_REPORT", sourceId: source.id,
    accountingDate: source.date, documentReference: "X", reason: "Prueba de ámbito", valuationConfirmed: true })).rejects.toMatchObject({ statusCode: 404 });
  await expect(declarePurchase({ ...ctx, role: "GERENTE" }, { sourceType: "RECEIVING_REPORT", sourceId: source.id,
    accountingDate: source.date, documentReference: "X", reason: "Prueba de ámbito", valuationConfirmed: true })).rejects.toMatchObject({ statusCode: 403 });
  await expect(declarePurchase(ctx, { sourceType: "RECEIVING_REPORT", sourceId: source.id,
    accountingDate: source.date, documentReference: "X", reason: "Prueba de ámbito" })).rejects.toMatchObject({ statusCode: 400 });
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0");
  await expect(declareReceipt(source)).rejects.toMatchObject({ statusCode: 503 });
});

it("keeps a closed-period receipt durable and recovers its frozen value once", async () => {
  const source = await receipt("2027-01-02");
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2027,1,'CLOSED')", [companyId]);
  const result = await declareReceipt(source); expect(result.journal).toBeNull(); expect(result.reason).toMatch(/cerrado/);
  const [event] = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [source.id])).rows;
  await pool.query("UPDATE inventory_items SET last_cost=123 WHERE id=$1", [source.itemId]);
  await pool.query("UPDATE financial_periods SET status='OPEN' WHERE company_id=$1 AND year=2027 AND month=1", [companyId]);
  const recovered = await runtime(() => retryAccountingEvent(ctx, event.id));
  expect(recovered.journal).toBeTruthy();
  expect((await runtime(() => processAccountingEvent(companyId, event.id))).journal!.id).toBe(recovered.journal!.id);
  expect(await lines(recovered.journal!.id)).toContainEqual({ memo: "PURCHASE:INVENTORY", debit_cents: 60000, credit_cents: 0 });
});

it("prevents two invoices from consuming one receipt and freezes declarations in SQL", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source); await declareInvoice(id);
  await expect(declareInvoice(await invoice(source))).rejects.toBeTruthy();
  await expect(pool.query("UPDATE accounting_purchase_facts SET document_reference='MUTATED' WHERE receiving_report_id=$1", [source.id])).rejects.toMatchObject({ code: "23514" });
  await expect(pool.query("DELETE FROM accounting_purchase_facts WHERE receiving_report_id=$1", [source.id])).rejects.toMatchObject({ code: "23514" });
});

it("enforces tenant RLS for purchase snapshots with the runtime role", async () => {
  const client = await pool.connect();
  try { await client.query(`SET ROLE "${runtimeRole}"`);
    await client.query("BEGIN"); await client.query("SELECT set_config('app.current_company_id',$1,true)", [foreignCompany]);
    expect((await client.query("SELECT event_id FROM accounting_purchase_facts")).rows).toEqual([]);
    await client.query("ROLLBACK");
  } finally { await client.query("RESET ROLE"); client.release(); }
});

it("confirms two partial treasury payments without marking the invoice paid too early or repeating inventory", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source); await declareInvoice(id);
  const first = await payment(id, 10000); await confirm(first);
  expect((await pool.query("SELECT payment_status FROM invoices WHERE id=$1", [id])).rows[0].payment_status).toBe("PENDING");
  const second = await payment(id, 50000); await confirm(second);
  expect((await pool.query("SELECT payment_status FROM invoices WHERE id=$1", [id])).rows[0].payment_status).toBe("PAID");
  const journals = (await pool.query("SELECT id FROM accounting_journals WHERE source_type='INVOICE_PAYMENT' AND source_id IN ($1,$2)", [first.itemId, second.itemId])).rows;
  expect(journals).toHaveLength(2);
  expect(await lines(journals[0].id)).toHaveLength(2);
  expect((await lines(journals[0].id)).every(row => !row.memo.includes("INVENTORY"))).toBe(true);
  await confirm(second);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_type='INVOICE_PAYMENT' AND source_id=$1", [second.itemId])).rows).toHaveLength(1);
  await expect(confirm(await payment(id, 1))).rejects.toMatchObject({ statusCode: 409 });
});

it("captures a confirmed payment durably when the bank link is absent and retries once after configuration", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source); await declareInvoice(id);
  const item = await payment(id, 10000, false); await confirm(item);
  const [event] = (await pool.query("SELECT id,status FROM accounting_events WHERE source_type='INVOICE_PAYMENT' AND source_id=$1", [item.itemId])).rows;
  expect(event.status).toBe("PENDING");
  await pool.query(`INSERT INTO accounting_source_links (company_id,account_id,bank_account_id,created_by,updated_by)
    VALUES ($1,$2,$3,$4,$4)`, [companyId, accounts.PAYMENT_SOURCE, item.bankId, actorId]);
  const recovered = await runtime(() => retryAccountingEvent(ctx, event.id));
  expect(recovered.journal).toBeTruthy();
  expect((await runtime(() => retryAccountingEvent(ctx, event.id))).journal!.id).toBe(recovered.journal!.id);
});

it("links a physical return to its original frozen lot value and refuses reuse or excess", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source, { tax: 9600 }); await declareInvoice(id);
  await pool.query("UPDATE inventory_items SET last_cost=99999 WHERE id=$1", [source.itemId]);
  const returned = await InventoryService.recordMovement({ branchId, itemId: source.itemId, batchId: source.batchId,
    type: "RETURN", quantityChange: -2, performedBy: actorId, reason: "Devolución de compra revisada" });
  const creditId = await credit(id, 12000, 1920);
  const result = await declareCredit(creditId, [returned.id]);
  expect((await declareCredit(creditId, [returned.id])).journal!.id).toBe(result.journal!.id);
  expect(await lines(result.journal!.id)).toContainEqual({ memo: "PURCHASE:INVENTORY", debit_cents: 0, credit_cents: 12000 });
  expect((await pool.query("SELECT current_quantity::text FROM inventory_batches WHERE id=$1", [source.batchId])).rows[0].current_quantity).toBe("8.0000");
  await expect(declareCredit(await credit(id, 12000, 1920), [returned.id])).rejects.toBeTruthy();
  const excess = await declareCredit(await credit(id, 60000, 9600));
  expect(excess.journal).toBeNull(); expect(excess.reason).toMatch(/excede/);
});

it("posts a price credit only to the obligation, tax and configured variance", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source, { tax: 9600 }); await declareInvoice(id);
  const result = await declareCredit(await credit(id, 1000, 160));
  expect((await lines(result.journal!.id)).some(row => row.memo === "PURCHASE:INVENTORY")).toBe(false);
  expect(await lines(result.journal!.id)).toContainEqual({ memo: "PURCHASE:PURCHASE_VARIANCE", debit_cents: 0, credit_cents: 1000 });
});

it("captures receipt, inventory, audit and accounting fact in the real receiving transaction exactly once", async () => {
  const itemId = randomUUID(), key = randomUUID();
  await pool.query("INSERT INTO inventory_items (id,company_id,name,unit) VALUES ($1,$2,'Recepción real','KG')", [itemId, companyId]);
  const input = { supplierId, businessDate: "2026-10-08", idempotencyKey: key, items: [{ itemId, quantity: 10, unitCost: 60 }] };
  const actor = { user: { id: actorId, companyId }, branchId, role: "OWNER" as const };
  const report = await processReceiving(actor, input);
  expect((await processReceiving(actor, input)).id).toBe(report.id);
  const [event] = (await pool.query("SELECT id,status,journal_id FROM accounting_events WHERE source_id=$1", [report.id])).rows;
  expect(event.status).toBe("POSTED");
  expect(await lines(event.journal_id)).toContainEqual({ memo: "PURCHASE:INVENTORY", debit_cents: 60000, credit_cents: 0 });
  expect((await pool.query("SELECT id FROM inventory_movements WHERE item_id=$1", [itemId])).rows).toHaveLength(1);
  expect((await pool.query("SELECT id FROM inventory_audit_log WHERE new_value->>'itemId'=$1", [itemId])).rows).toHaveLength(1);
});

it("rolls receiving back if the durable purchase fact cannot be persisted", async () => {
  const itemId = randomUUID(), key = randomUUID();
  await pool.query("INSERT INTO inventory_items (id,company_id,name,unit) VALUES ($1,$2,'Fallo controlado','KG')", [itemId, companyId]);
  await pool.query(`CREATE FUNCTION "${namespace}".fail_purchase_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.source_type='RECEIVING_REPORT' THEN RAISE EXCEPTION 'controlled purchase capture failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER fail_purchase_capture BEFORE INSERT ON accounting_events FOR EACH ROW EXECUTE FUNCTION "${namespace}".fail_purchase_capture()`);
  try {
    await expect(processReceiving({ user: { id: actorId, companyId }, branchId, role: "OWNER" },
      { supplierId, businessDate: "2026-10-08", idempotencyKey: key, items: [{ itemId, quantity: 10, unitCost: 60 }] })).rejects.toThrow();
    expect((await pool.query("SELECT id FROM receiving_reports WHERE idempotency_key=$1", [key])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM inventory_batches WHERE item_id=$1", [itemId])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM inventory_movements WHERE item_id=$1", [itemId])).rows).toHaveLength(0);
  } finally { await pool.query("DROP TRIGGER fail_purchase_capture ON accounting_events"); }
});

it("keeps manual journals available after installing the purchase guards", async () => {
  const draft = await createDraft(ctx, { accountingDate: "2026-10-12", description: "Ajuste manual existente",
    branchId, lines: [{ accountId: accounts.INVENTORY, debitCents: 100, creditCents: 0 },
      { accountId: accounts.PAYABLE, debitCents: 0, creditCents: 100 }] });
  expect((await publishDraft(ctx, draft.id, { expectedVersion: draft.version, reason: "Ajuste manual revisado" })).status).toBe("POSTED");
});

it("rejects a generic purchase reversal with an actionable conflict and no orphan draft", async () => {
  const source = await receipt();
  const result = await declareReceipt(source);
  const journalId = result.journal!.id;
  const before = (await pool.query("SELECT count(*)::int AS total FROM accounting_journals")).rows[0].total;
  await expect(reverseJournal(ctx, journalId, {
    expectedVersion: 2, accountingDate: "2026-10-12", reason: "Corrección de compra con documentos vinculados",
  })).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/compra|devolución/i) });
  expect((await pool.query("SELECT count(*)::int AS total FROM accounting_journals")).rows[0].total).toBe(before);
  expect((await pool.query("SELECT status FROM accounting_journals WHERE id=$1", [journalId])).rows[0].status).toBe("POSTED");
});

it("does not consume money already confirmed by treasury while its accounting is pending", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source); await declareInvoice(id);
  await confirm(await payment(id, 60000, false));
  const result = await declareCredit(await credit(id, 10000, 0));
  expect(result.journal).toBeNull(); expect(result.reason).toMatch(/excede/);
});

it("does not recover a cancelled invoice or confirm a new payment against it", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source);
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2026,10,'CLOSED')", [companyId]);
  expect((await declareInvoice(id)).journal).toBeNull();
  const [event] = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows;
  await pool.query("UPDATE invoices SET sat_status='CANCELADO' WHERE id=$1", [id]);
  await pool.query("UPDATE financial_periods SET status='OPEN' WHERE company_id=$1 AND year=2026 AND month=10", [companyId]);
  const result = await retryAccountingEvent(ctx, event.id);
  expect(result.journal).toBeNull(); expect(result.reason).toMatch(/cancelad|vigente/i);
  await expect(confirm(await payment(id, 1))).rejects.toMatchObject({ statusCode: 409 });
});

it("rejects a manual journal which borrows a pending purchase identity with different amounts", async () => {
  const source = await receipt("2028-01-02");
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2028,1,'CLOSED')", [companyId]);
  await declareReceipt(source);
  await pool.query("UPDATE financial_periods SET status='OPEN' WHERE company_id=$1 AND year=2028 AND month=1", [companyId]);
  await expect((async () => {
    const draft = await createDraft(ctx, { accountingDate: source.date, description: "Fuente de compra ajena al adaptador", branchId,
      source: { type: "RECEIVING_REPORT", id: source.id, version: 1, eventType: "PURCHASE_RECEIVED" },
      lines: [{ accountId: accounts.INVENTORY, debitCents: 120000, creditCents: 0, memo: "PURCHASE:INVENTORY" },
        { accountId: accounts.RECEIVING_PENDING, debitCents: 0, creditCents: 120000, memo: "PURCHASE:RECEIVING_PENDING" }] });
    return publishDraft(ctx, draft.id, { expectedVersion: draft.version, reason: "No debe apropiarse del hecho" });
  })()).rejects.toMatchObject({ statusCode: 409 });
});

it("retains the full reviewed reason even with a maximum length document reference", async () => {
  const source = await receipt();
  const reason = "Motivo completo de la revisión contable de una recepción sintética";
  await declarePurchase(ctx, { sourceType: "RECEIVING_REPORT", sourceId: source.id, accountingDate: source.date,
    documentReference: "R".repeat(200), reason, valuationConfirmed: true });
  const [fact] = (await pool.query("SELECT document_reference,snapshot FROM accounting_purchase_facts WHERE receiving_report_id=$1", [source.id])).rows;
  expect(fact.document_reference).toBe("R".repeat(200)); expect(fact.snapshot.reviewReason).toBe(reason);
});

it("serializes source edits against snapshot capture and rejects an invoice change after capture", async () => {
  const source = await receipt(); await declareReceipt(source);
  const id = await invoice(source);
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,614))", [companyId]);
    const change = pool.query("UPDATE invoices SET subtotal=70000,total=70000 WHERE id=$1", [id]);
    // Attach the rejection handler immediately; the update waits for this transaction's lock.
    const outcome = change.then(() => null, error => error);
    const eventId = (await client.query(`INSERT INTO accounting_events (company_id,branch_id,source_type,source_id,event_type,actor_id,accounting_date)
      VALUES ($1,$2,'PURCHASE_INVOICE',$3,'PURCHASE_INVOICED',$4,'2026-10-09') RETURNING id`, [companyId, branchId, id, actorId])).rows[0].id;
    await client.query(`INSERT INTO accounting_purchase_facts (event_id,company_id,receiving_report_id,invoice_id,kind,document_reference,declared_by,snapshot)
      VALUES ($1,$2,$3,$4,'INVOICE','Snapshot en concurrencia',$5,$6)`, [eventId, companyId, source.id, id, actorId,
      JSON.stringify({ kind: "INVOICE", receivedCents: 60000, netCents: 60000, taxCents: 0, totalCents: 60000, differenceApproved: false })]);
    await client.query("COMMIT");
    expect(await outcome).toMatchObject({ code: "23514" });
    expect((await pool.query("SELECT total FROM invoices WHERE id=$1", [id])).rows[0].total).toBe(60000);
  } finally { await client.query("ROLLBACK"); client.release(); }
});

it("rejects SQL publication with balanced but unsupported purchase amounts", async () => {
  const source = await receipt("2029-01-02");
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2029,1,'CLOSED')", [companyId]);
  await declareReceipt(source);
  await pool.query("UPDATE financial_periods SET status='OPEN' WHERE company_id=$1 AND year=2029 AND month=1", [companyId]);
  const rule = (await pool.query("SELECT id,version FROM accounting_rules WHERE company_id=$1 AND event_type='PURCHASE_RECEIVED'", [companyId])).rows[0];
  const journal = (await pool.query(`INSERT INTO accounting_journals
    (company_id,branch_id,accounting_date,business_date,description,source_type,source_id,source_version,event_type,rule_id,rule_version,created_by,updated_by)
    VALUES ($1,$2,$3,$3,'Intento SQL fuera del contrato','RECEIVING_REPORT',$4,1,'PURCHASE_RECEIVED',$5,$6,$7,$7) RETURNING id`,
    [companyId, branchId, source.date, source.id, rule.id, rule.version, actorId])).rows[0];
  await pool.query(`INSERT INTO accounting_journal_lines (company_id,journal_id,line_number,account_id,debit_cents,credit_cents,memo)
    VALUES ($1,$2,1,$3,120000,0,'PURCHASE:INVENTORY'),($1,$2,2,$4,0,120000,'PURCHASE:RECEIVING_PENDING')`,
    [companyId, journal.id, accounts.INVENTORY, accounts.RECEIVING_PENDING]);
  await expect(pool.query(`UPDATE accounting_journals SET status='POSTED',number=99999,version=version+1,posted_at=now(),posted_by=$2,
    posting_reason='Intento balanceado inválido' WHERE id=$1`, [journal.id, actorId])).rejects.toMatchObject({ code: "23514" });
});
