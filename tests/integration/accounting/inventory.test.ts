import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount, readAccountingPreparation } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { createOpening } from "@/lib/services/accounting/opening-service";
import { recoverInventoryFacts } from "@/lib/services/accounting/inventory-adapter";
import { processAccountingEvent } from "@/lib/services/accounting/event-service";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { postInTransaction, reverseJournal } from "@/lib/services/accounting/journal-service";
import { InventoryService } from "@/lib/services/inventory-service";
import { getFoodCostByBranch } from "@/lib/services/food-cost-service";
import { getInventoryPnlDetail } from "@/lib/services/pnl-inventory-detail-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc14_${randomUUID().replaceAll("-", "")}`, runtimeRole = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 10000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=20000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), branchId = randomUUID(), destinationId = randomUUID();
let created = false, roleCreated = false;
const ctx = { companyId, actorId, role: "OWNER" as const }, accounts: Record<string, string> = {};
const events = { USAGE: "INVENTORY_USED", USAGE_RETURN: "INVENTORY_USAGE_RETURNED", WASTE: "INVENTORY_WASTED",
  TRANSFER_OUT: "INVENTORY_SHIPPED", TRANSFER_IN: "INVENTORY_RECEIVED", TRANSFER_WASTE: "INVENTORY_TRANSIT_WASTED" };
beforeEach(() => { vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1"); vi.stubEnv("ACCOUNTING_INVENTORY_ENABLED", "1"); });
afterEach(() => vi.unstubAllEnvs());

beforeAll(async () => {
  const testUrl = new URL(process.env.TEST_DATABASE_URL!);
  const operative = new URL(parse(readFileSync(".env")).DATABASE_URL!);
  if (testUrl.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "") && testUrl.pathname === operative.pathname) {
    throw new Error("La base aislada coincide con la operativa.");
  }
  await pool.query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const type of [schema.expensePaymentMethodEnum, schema.terminalAcquirerEnum]) {
    await pool.query(`CREATE TYPE "${namespace}".${type.enumName} AS ENUM (${type.enumValues.map(v => `'${v}'`).join(",")})`);
  }
  const tables = ["companies", "users", "cost_centers", "company_bank_accounts", "branches", "financial_periods",
    "operating_expenses", "payment_runs", "payment_run_items", "daily_sales_cuts", "gateway_transactions", "bank_transactions",
    "suppliers", "inventory_items", "inventory_batches", "inventory_movements", "receiving_reports", "receiving_report_items",
    "invoices", "invoice_lines", "credit_notes", "inventory_transfers", "inventory_transfer_items", "inventory_waste",
    "inventory_periods", "inventory_price_history", "inventory_audit_log"];
  await pool.query(tables.map(table => `CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
    ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id);`).join("\n"));
  await pool.query(`ALTER TABLE "${namespace}".payment_runs DROP COLUMN IF EXISTS source_bank_account_id`);
  await pool.query("INSERT INTO companies(id,name,costing_method) VALUES($1,'Inventario sintético','LAST_COST'),($2,'Ajena','LAST_COST')", [companyId, foreignCompany]);
  await pool.query("INSERT INTO users(id,email,role,company_id,created_at,updated_at) VALUES($1,'inventory@fixture.invalid','OWNER',$2,now(),now())", [actorId, companyId]);
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$3,'Origen','OR','OWNED'),($2,$3,'Destino','DE','OWNED')", [branchId, destinationId, companyId]);
  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules", "0131_fc09_expense_payments", "0132_fc09_treasury_source",
    "0133_fc10_accounting_events", "0134_fc11_sales", "0136_fc12_settlements", "0140_fc13_purchases", "0142_fc14_inventory_valuation"]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`).replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
      .replaceAll("rolname='pulso_app'", `rolname='${runtimeRole}'`).replaceAll("TO pulso_app", `TO "${runtimeRole}"`);
    await pool.query(migration.split("--> statement-breakpoint").join("\n"));
  }
  state.db = drizzle(pool, { schema });
  for (const [role, kind] of Object.entries({ INVENTORY: "ASSET", IN_TRANSIT: "ASSET", COGS: "EXPENSE", WASTE: "EXPENSE", CAPITAL: "EQUITY" })) {
    accounts[role] = (await createAccount(ctx, { code: role, name: role, kind,
      normalBalance: kind === "EQUITY" ? "CREDIT" : "DEBIT", validFrom: "2026-01-01" })).id;
  }
  for (const event of Object.values(events)) await createRule(ctx, { code: event, name: event,
    eventType: event, effectiveFrom: "2026-01-01", entries: ["INVENTORY", "IN_TRANSIT", "COGS", "WASTE"].map(role => ({ role, accountId: accounts[role] })) });
  await createOpening(ctx, { openingDate: "2026-01-01", reason: "Apertura sintética de inventario",
    documents: [{ label: "Apertura sintética", reference: "SYN-FC14" }], lines: [
      { accountId: accounts.INVENTORY, debitCents: 100000, creditCents: 0 },
      { accountId: accounts.CAPITAL, debitCents: 0, creditCents: 100000 },
    ] });
}, 120000);
afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${runtimeRole}"`);
  } finally { await pool.end(); }
});

async function item(cost: number | null = 100) {
  const id = randomUUID();
  await pool.query("INSERT INTO inventory_items(id,company_id,name,unit,last_cost) VALUES($1,$2,'Insumo sintético','KG',$3)", [id, companyId, cost]);
  return id;
}
async function movement(itemId: string, quantity: string, options: { type?: string; branch?: string; reference?: string; batch?: string } = {}) {
  return (await pool.query(`INSERT INTO inventory_movements(branch_id,item_id,type,quantity_change,reference_id,performed_by,timestamp,batch_id)
    VALUES($1,$2,$3,$4,$5,$6,'2026-11-12 10:00:00',$7) RETURNING id`,
  [options.branch ?? branchId, itemId, options.type ?? "USAGE", quantity, options.reference ?? null, actorId, options.batch ?? null])).rows[0].id as string;
}
const valuation = async (id: string) => (await pool.query("SELECT * FROM accounting_inventory_valuations WHERE movement_id=$1", [id])).rows[0];
async function enqueue(id: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await withCompanyContext(ctx, tx => recoverInventoryFacts(tx, companyId));
    const row = (await pool.query("SELECT * FROM accounting_events WHERE company_id=$1 AND source_type='INVENTORY_MOVEMENT' AND source_id=$2", [companyId, id])).rows[0];
    if (row) return row;
  }
  throw new Error("El barrido no capturó el movimiento sintético");
}
const linesOf = async (id: string) => (await pool.query("SELECT memo,debit_cents,credit_cents,account_id FROM accounting_journal_lines WHERE journal_id=$1 ORDER BY line_number", [id])).rows;

it("freezes exact movement cost before later item or costing-method changes", async () => {
  const product = await item(), id = await movement(product, "-1.2345");
  expect(await valuation(id)).toMatchObject({ kind: "USAGE", quantity: "-1.2345", amount_cents: "123", unit_cost_cents: "100", pending_reason: null });
  await pool.query("UPDATE inventory_items SET last_cost=9999,average_cost=7777 WHERE id=$1", [product]);
  await pool.query("UPDATE branches SET costing_method='AVERAGE_COST' WHERE id=$1", [branchId]);
  expect((await valuation(id)).amount_cents).toBe("123");
  await pool.query("UPDATE branches SET costing_method=NULL WHERE id=$1", [branchId]);
});

it("keeps missing costs pending after a later cost capture", async () => {
  const product = await item(null), id = await movement(product, "-2", { type: "WASTE" });
  expect(await valuation(id)).toMatchObject({ kind: "WASTE", amount_cents: null });
  expect((await valuation(id)).pending_reason).toMatch(/costo/i);
  await pool.query("UPDATE inventory_items SET last_cost=500 WHERE id=$1", [product]);
  expect((await valuation(id)).amount_cents).toBeNull();
});

it("freezes append-only source and valuation, and rejects a forged direct capture", async () => {
  const product = await item(), id = await movement(product, "-1");
  await expect(pool.query("UPDATE accounting_inventory_valuations SET amount_cents=999 WHERE movement_id=$1", [id])).rejects.toMatchObject({ code: "23514" });
  await expect(pool.query("DELETE FROM inventory_movements WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
  await expect(pool.query("UPDATE inventory_movements SET quantity_change=-99 WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
  await expect(pool.query(`INSERT INTO accounting_inventory_valuations
    SELECT * FROM accounting_inventory_valuations WHERE movement_id=$1`, [id])).rejects.toMatchObject({ code: "23514" });
});

it("captures for an isolated stock writer and hides another tenant's values", async () => {
  const product = await item(123), client = await pool.connect();
  await pool.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${runtimeRole}";
    GRANT INSERT(branch_id,item_id,type,quantity_change,performed_by),SELECT(id) ON inventory_movements TO "${runtimeRole}"`);
  try {
    await client.query("BEGIN"); await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
    const id = (await client.query("INSERT INTO inventory_movements(branch_id,item_id,type,quantity_change,performed_by) VALUES($1,$2,'WASTE',-2,$3) RETURNING id", [branchId, product, actorId])).rows[0].id;
    expect((await client.query("SELECT amount_cents FROM accounting_inventory_valuations WHERE movement_id=$1", [id])).rows).toEqual([{ amount_cents: "246" }]);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [foreignCompany]);
    expect((await client.query("SELECT amount_cents FROM accounting_inventory_valuations WHERE movement_id=$1", [id])).rows).toEqual([]);
    await expect(client.query("INSERT INTO inventory_movements(branch_id,item_id,type,quantity_change,performed_by) VALUES($1,$2,'WASTE',-2,$3)", [branchId, product, actorId]))
      .rejects.toMatchObject({ code: "42501" });
    await client.query("ROLLBACK");
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
});

it("supports the serializable stock writer and rolls source and capture back together", async () => {
  const product = await item(45), client = await pool.connect();
  let id: string;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    id = (await client.query("INSERT INTO inventory_movements(branch_id,item_id,type,quantity_change,performed_by) VALUES($1,$2,'USAGE',-2,$3) RETURNING id", [branchId, product, actorId])).rows[0].id;
    expect((await client.query("SELECT amount_cents FROM accounting_inventory_valuations WHERE movement_id=$1", [id])).rows[0].amount_cents).toBe("90");
    await client.query("ROLLBACK");
    expect(await valuation(id)).toBeUndefined();
    expect((await pool.query("SELECT id FROM inventory_movements WHERE id=$1", [id])).rows).toEqual([]);
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
});

it("values every partial usage return from the original movement after today's cost changes", async () => {
  const product = await item(1), reference = `salecons:${randomUUID()}`;
  const source = await movement(product, "-1.5000", { reference });
  await pool.query("UPDATE inventory_items SET last_cost=9999 WHERE id=$1", [product]);
  const returns = [];
  for (let index = 0; index < 3; index++) {
    returns.push(await movement(product, "0.5000", { reference: `${reference}:reverse:${source}` }));
  }
  expect(await Promise.all(returns.map(async id => (await valuation(id)).amount_cents))).toEqual(["1", "0", "1"]);
  await expect(movement(product, "0.0001", { reference: `${reference}:reverse:${source}` })).rejects.toMatchObject({ code: "23514" });
});

it("conserves shipped value across fractional receipt and transport waste without destination revaluation", async () => {
  const product = await item(67), transfer = randomUUID();
  await pool.query(`INSERT INTO inventory_transfers(id,from_branch_id,to_branch_id,status,requested_by,transfer_number)
    VALUES($1,$2,$3,'IN_TRANSIT',$4,$5)`, [transfer, branchId, destinationId, actorId, `SYN-${transfer}`]);
  const outgoing = await movement(product, "-1.5000", { type: "TRANSFER", reference: transfer });
  expect((await valuation(outgoing)).amount_cents).toBe("101");
  await pool.query("UPDATE inventory_items SET last_cost=9999 WHERE id=$1", [product]);
  const received = await movement(product, "1.2500", { type: "TRANSFER", reference: transfer, branch: destinationId });
  const wasted = await movement(product, "-0.2500", { type: "WASTE", reference: transfer, branch: destinationId });
  expect(await valuation(received)).toMatchObject({ kind: "TRANSFER_IN", amount_cents: "84" });
  expect(await valuation(wasted)).toMatchObject({ kind: "TRANSFER_WASTE", amount_cents: "17" });
  await expect(movement(product, "0.0001", { type: "TRANSFER", reference: transfer, branch: destinationId })).rejects.toMatchObject({ code: "23514" });
});

it("does not adopt an unrelated usage as a recipe return and keeps unstructured transfers pending", async () => {
  const product = await item(), original = await movement(product, "-1");
  await expect(movement(product, "1", { reference: `salecons:${randomUUID()}:reverse:${original}` })).rejects.toMatchObject({ code: "23514" });
  const unstructured = await movement(product, "-1", { type: "TRANSFER", reference: "-".repeat(36) });
  expect((await valuation(unstructured)).pending_reason).toMatch(/transferencia/i);
});

it("posts frozen consumption once, even after changing the current cost and retrying", async () => {
  const product = await item(100), source = await movement(product, "-1.5"), event = await enqueue(source);
  await pool.query("UPDATE inventory_items SET last_cost=9999 WHERE id=$1", [product]);
  const first = await processAccountingEvent(companyId, event.id);
  expect(first.journal).toBeTruthy();
  expect(await linesOf(first.journal!.id)).toMatchObject([
    { memo: "INVENTORY:COGS", debit_cents: "150", credit_cents: "0" },
    { memo: "INVENTORY:INVENTORY", debit_cents: "0", credit_cents: "150" },
  ]);
  expect((await processAccountingEvent(companyId, event.id)).journal!.id).toBe(first.journal!.id);
});

it("posts waste without adding it to normal consumption", async () => {
  const product = await item(123), event = await enqueue(await movement(product, "-2", { type: "WASTE" }));
  const result = await processAccountingEvent(companyId, event.id);
  expect(await linesOf(result.journal!.id)).toMatchObject([
    { memo: "INVENTORY:WASTE", debit_cents: "246" }, { memo: "INVENTORY:INVENTORY", credit_cents: "246" },
  ]);
});

it("keeps a missing original cost and a closed accounting period pending", async () => {
  const source = await movement(await item(null), "-1"), event = await enqueue(source);
  expect(await processAccountingEvent(companyId, event.id)).toMatchObject({ journal: null, reason: expect.stringMatching(/costo/i) });
  const closedEvent = await enqueue(await movement(await item(100), "-1"));
  const periodId = randomUUID();
  await pool.query("INSERT INTO financial_periods(id,company_id,year,month,status) VALUES($1,$2,2026,11,'CLOSED')", [periodId, companyId]);
  try { expect(await processAccountingEvent(companyId, closedEvent.id)).toMatchObject({ journal: null, reason: expect.stringMatching(/cerrado/i) }); }
  finally { await pool.query("DELETE FROM financial_periods WHERE id=$1", [periodId]); }
});

it("rejects balanced ledger lines that disagree with the frozen physical amount", async () => {
  const source = await movement(await item(100), "-1"), event = await enqueue(source);
  const rule = (await pool.query("SELECT id,version FROM accounting_rules WHERE company_id=$1 AND event_type=$2", [companyId, event.event_type])).rows[0];
  const draft = (await pool.query(`INSERT INTO accounting_journals(company_id,branch_id,accounting_date,description,source_type,source_id,
    event_type,source_version,rule_id,rule_version,created_by,updated_by) VALUES($1,$2,'2026-11-12','Valor sintético incorrecto',
    'INVENTORY_MOVEMENT',$3,$4,1,$5,$6,$7,$7) RETURNING id,version`, [companyId, branchId, source, event.event_type, rule.id, rule.version, actorId])).rows[0];
  await pool.query(`INSERT INTO accounting_journal_lines(company_id,journal_id,line_number,account_id,debit_cents,credit_cents,memo)
    VALUES($1,$2,1,$3,999,0,'INVENTORY:COGS'),($1,$2,2,$4,0,999,'INVENTORY:INVENTORY')`, [companyId, draft.id, accounts.COGS, accounts.INVENTORY]);
  await expect(withCompanyContext(ctx, tx => postInTransaction(tx, companyId, actorId, draft.id, draft.version, "Reproducción de importe discordante"))).rejects.toBeTruthy();
  expect((await pool.query("SELECT status FROM accounting_journals WHERE id=$1", [draft.id])).rows[0].status).toBe("DRAFT");
});

it("requires an operational linked correction instead of a manual reversal", async () => {
  const event = await enqueue(await movement(await item(100), "-1")), posted = await processAccountingEvent(companyId, event.id);
  const journal = (await pool.query("SELECT version FROM accounting_journals WHERE id=$1", [posted.journal!.id])).rows[0];
  await expect(reverseJournal(ctx, posted.journal!.id, { expectedVersion: journal.version, accountingDate: "2026-11-12",
    reason: "Reversa que eludiría el movimiento físico original" })).rejects.toMatchObject({ statusCode: 409 });
});

it("preserves value through the real transfer service and accepts only one concurrent receipt", async () => {
  const product = await item(67), transfer = randomUUID();
  for (let index = 0; index < 2; index++) await pool.query(`INSERT INTO inventory_batches(item_id,branch_id,initial_quantity,current_quantity,unit_cost,status,expiration_date)
    VALUES($1,$2,1.5,1.5,67,'AVAILABLE','2030-01-01')`, [product, branchId]);
  await pool.query(`INSERT INTO inventory_transfers(id,from_branch_id,to_branch_id,status,requested_by,transfer_number)
    VALUES($1,$2,$3,'APPROVED',$4,$5)`, [transfer, branchId, destinationId, actorId, `FLOW-${transfer}`]);
  const transferItem = (await pool.query("INSERT INTO inventory_transfer_items(transfer_id,item_id,requested_quantity,approved_quantity) VALUES($1,$2,3,3) RETURNING id", [transfer, product])).rows[0];
  await InventoryService.shipTransfer(transfer, companyId, actorId);
  const receipts = await Promise.allSettled([1, 2].map(() => InventoryService.receiveTransfer(transfer, companyId, actorId,
    [{ id: transferItem.id, receivedQuantity: 2 }])));
  expect(receipts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const captured = (await pool.query("SELECT movement_id,kind,amount_cents,quantity FROM accounting_inventory_valuations WHERE reference_id=$1 ORDER BY captured_at,movement_id", [transfer])).rows;
  expect(captured.filter(row => row.kind === "TRANSFER_OUT")).toHaveLength(2);
  expect(captured.find(row => row.kind === "TRANSFER_IN")).toMatchObject({ quantity: "2.0000", amount_cents: "135" });
  expect(captured.find(row => row.kind === "TRANSFER_WASTE")).toMatchObject({ quantity: "-1.0000", amount_cents: "67" });
  for (const row of [...captured.filter(row => row.kind === "TRANSFER_OUT"), ...captured.filter(row => row.kind !== "TRANSFER_OUT")]) {
    const event = await enqueue(row.movement_id);
    expect((await processAccountingEvent(companyId, event.id)).journal).toBeTruthy();
  }
  const transit = (await pool.query(`SELECT sum(l.debit_cents-l.credit_cents)::text amount FROM accounting_journal_lines l
    JOIN accounting_journals j ON j.id=l.journal_id JOIN accounting_inventory_valuations v ON v.movement_id::text=j.source_id
    WHERE v.reference_id=$1 AND l.memo='INVENTORY:IN_TRANSIT' AND j.status='POSTED'`, [transfer])).rows[0];
  expect(transit.amount).toBe("0");
});

it("rejects unknown receipt lines and unsupported fractional line quantities before mutating stock", async () => {
  const product = await item(100), transfer = randomUUID();
  await pool.query(`INSERT INTO inventory_transfers(id,from_branch_id,to_branch_id,status,requested_by,transfer_number)
    VALUES($1,$2,$3,'IN_TRANSIT',$4,$5)`, [transfer, branchId, destinationId, actorId, `CHECK-${transfer}`]);
  const line = (await pool.query("INSERT INTO inventory_transfer_items(transfer_id,item_id,requested_quantity,shipped_quantity) VALUES($1,$2,3,3) RETURNING id", [transfer, product])).rows[0];
  await movement(product, "-3", { type: "TRANSFER", reference: transfer });
  await expect(InventoryService.receiveTransfer(transfer, companyId, actorId, [{ id: randomUUID(), receivedQuantity: 2 }])).rejects.toMatchObject({ statusCode: 400 });
  await expect(InventoryService.receiveTransfer(transfer, companyId, actorId, [{ id: line.id, receivedQuantity: 0.5 }])).rejects.toMatchObject({ statusCode: 400 });
});

it("keeps food cost and its detail on the original values, subtracting linked returns", async () => {
  const branch = randomUUID(), product = await item(101), reference = `salecons:${randomUUID()}`;
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Resultados','PNL','OWNED')", [branch, companyId]);
  const original = await movement(product, "-1.5", { branch, reference });
  await movement(product, "0.5", { branch, reference: `${reference}:reverse:${original}` });
  await movement(product, "-0.5", { branch, type: "WASTE" });
  await pool.query("UPDATE inventory_items SET last_cost=9999 WHERE id=$1", [product]);
  const food = (await getFoodCostByBranch(companyId, "2026-11-12", "2026-11-12")).find(row => row.branchId === branch)!;
  expect(food).toMatchObject({ foodCostCents: 101, wasteCents: 51, frozenLines: 3, frozenUncostedLines: 0, legacyLines: 0 });
  for (const [line, expected] of [["foodCost", 101], ["waste", 51]] as const) {
    const detail = await getInventoryPnlDetail({ companyId, branchId: branch, line,
      period: { startDate: "2026-11-12", endDate: "2026-11-12", days: 1 }, page: 1, pageSize: 25 });
    expect(detail).toMatchObject({ totalCents: expected, valuation: "FROZEN_MOVEMENT_COST", source: "MEASURED" });
    expect(detail.items.reduce((sum, row) => sum + row.cents, 0)).toBe(expected);
  }
});

it("discloses missing original costs as a partial figure instead of adopting the current price", async () => {
  const branch = randomUUID(), product = await item(null);
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Costo pendiente','PEND','OWNED')", [branch, companyId]);
  await movement(product, "-1", { branch });
  await pool.query("UPDATE inventory_items SET last_cost=9999 WHERE id=$1", [product]);
  expect((await getFoodCostByBranch(companyId, "2026-11-12", "2026-11-12")).find(row => row.branchId === branch))
    .toMatchObject({ foodCostCents: 0, frozenUncostedLines: 1 });
  const detail = await getInventoryPnlDetail({ companyId, branchId: branch, line: "foodCost",
    period: { startDate: "2026-11-12", endDate: "2026-11-12", days: 1 }, page: 1, pageSize: 25 });
  expect(detail).toMatchObject({ totalCents: 0, source: "DERIVED", frozenUncostedLines: 1, uncostedLines: 1 });
  expect(detail.items[0].unitCostCents).toBeNull();
});

it("does not discover inventory events when the separate feature flag is disabled", async () => {
  const source = await movement(await item(), "-1");
  expect((await readAccountingPreparation(ctx)).inventoryEnabled).toBe(true);
  vi.stubEnv("ACCOUNTING_INVENTORY_ENABLED", "0");
  expect((await readAccountingPreparation(ctx)).inventoryEnabled).toBe(false);
  expect(await withCompanyContext(ctx, tx => recoverInventoryFacts(tx, companyId))).toBe(0);
  expect((await pool.query("SELECT count(*)::int n FROM accounting_events WHERE source_id=$1", [source])).rows[0].n).toBe(0);
});

it("posts a linked usage return only after its original and remains idempotent under concurrent retries", async () => {
  const product = await item(101), reference = `salecons:${randomUUID()}`;
  const original = await movement(product, "-1.5", { reference });
  const returned = await movement(product, "0.5", { reference: `${reference}:reverse:${original}` });
  const event = await enqueue(returned);
  expect(await processAccountingEvent(companyId, event.id)).toMatchObject({ journal: null, reason: expect.stringMatching(/original/i) });
  await processAccountingEvent(companyId, (await enqueue(original)).id);
  const results = await Promise.all([1, 2].map(() => processAccountingEvent(companyId, event.id)));
  expect(results[0].journal!.id).toBe(results[1].journal!.id);
  expect(await linesOf(results[0].journal!.id)).toMatchObject([
    { memo: "INVENTORY:INVENTORY", debit_cents: "51" }, { memo: "INVENTORY:COGS", credit_cents: "51" },
  ]);
});

it("posts using the scoped runtime role without granting writes to captured valuations", async () => {
  const event = await enqueue(await movement(await item(100), "-1"));
  const client = await pool.connect(), previous = state.db;
  try {
    await client.query(`SET ROLE "${runtimeRole}"`);
    state.db = drizzle(client, { schema });
    const posted = await processAccountingEvent(companyId, event.id);
    expect(posted.journal).toBeTruthy();
    await expect(client.query("UPDATE accounting_inventory_valuations SET amount_cents=1 WHERE movement_id=$1", [event.source_id]))
      .rejects.toMatchObject({ code: "42501" });
  } finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
});

it("marks mixed historical/current valuation explicitly without backfilling old movements", async () => {
  const branch = randomUUID(), product = await item(100);
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Mixta','MIX','OWNED')", [branch, companyId]);
  // Only this isolated fixture simulates a movement created before migration 0142.
  await pool.query("ALTER TABLE inventory_movements DISABLE TRIGGER accounting_inventory_capture");
  try { await movement(product, "-1", { branch }); }
  finally { await pool.query("ALTER TABLE inventory_movements ENABLE TRIGGER accounting_inventory_capture"); }
  await movement(product, "-1", { branch });
  await pool.query("UPDATE inventory_items SET last_cost=200 WHERE id=$1", [product]);
  const food = (await getFoodCostByBranch(companyId, "2026-11-12", "2026-11-12")).find(row => row.branchId === branch)!;
  expect(food).toMatchObject({ foodCostCents: 300, frozenLines: 1, legacyLines: 1 });
  expect(await getInventoryPnlDetail({ companyId, branchId: branch, line: "foodCost",
    period: { startDate: "2026-11-12", endDate: "2026-11-12", days: 1 }, page: 1, pageSize: 25 }))
    .toMatchObject({ totalCents: 300, valuation: "MIXED_FROZEN_AND_CURRENT" });
});

it("preserves the disclosed average-cost fallback when the branch method later changes", async () => {
  const branch = randomUUID(), product = await item(100);
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type,costing_method) VALUES($1,$2,'Promedio','AVG','OWNED','AVERAGE_COST')", [branch, companyId]);
  await movement(product, "-1", { branch });
  await pool.query("UPDATE branches SET costing_method='LAST_COST' WHERE id=$1", [branch]);
  expect((await getFoodCostByBranch(companyId, "2026-11-12", "2026-11-12")).find(row => row.branchId === branch))
    .toMatchObject({ foodCostCents: 100, usedCostFallback: true });
  expect(await getInventoryPnlDetail({ companyId, branchId: branch, line: "foodCost",
    period: { startDate: "2026-11-12", endDate: "2026-11-12", days: 1 }, page: 1, pageSize: 25 }))
    .toMatchObject({ totalCents: 100, source: "DERIVED" });
});

it("reads frozen food cost and its detail under the tenant-scoped runtime role", async () => {
  const branch = randomUUID(), product = await item(100);
  await pool.query("INSERT INTO branches(id,company_id,name,code,ownership_type) VALUES($1,$2,'Lectura RLS','RLS','OWNED')", [branch, companyId]);
  await movement(product, "-1", { branch });
  await pool.query("UPDATE inventory_items SET last_cost=9999 WHERE id=$1", [product]);
  // Existing inventory/report permissions; 0142 grants only the new valuation read.
  await pool.query(`GRANT SELECT ON inventory_items,inventory_movements TO "${runtimeRole}";
    GRANT SELECT(id,costing_method) ON companies TO "${runtimeRole}";
    GRANT SELECT(costing_method) ON branches TO "${runtimeRole}"`);
  const client = await pool.connect(), previous = state.db;
  try {
    await client.query(`SET ROLE "${runtimeRole}"`);
    state.db = drizzle(client, { schema });
    expect((await getFoodCostByBranch(companyId, "2026-11-12", "2026-11-12")).find(row => row.branchId === branch))
      .toMatchObject({ foodCostCents: 100, frozenLines: 1, legacyLines: 0 });
    expect(await getInventoryPnlDetail({ companyId, branchId: branch, line: "foodCost",
      period: { startDate: "2026-11-12", endDate: "2026-11-12", days: 1 }, page: 1, pageSize: 25 }))
      .toMatchObject({ totalCents: 100, valuation: "FROZEN_MOVEMENT_COST" });
  } finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
});
