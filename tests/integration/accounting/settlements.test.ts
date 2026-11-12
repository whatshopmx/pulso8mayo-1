import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { createAccount, linkGateway, listGatewayLinks } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { declareSalesCut } from "@/lib/services/accounting/sales-adapter";
import { processAccountingEvent, recoverMissingAccountingEvents, retryAccountingEvent } from "@/lib/services/accounting/event-service";
import { settleConfirmedTransactionIn } from "@/lib/services/accounting/settlement-adapter";
import { confirmDepositMatch, importBankStatement, unmatchDepositTransaction, unmatchTransaction } from "@/lib/services/bank-statement-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc12_${randomUUID().replaceAll("-", "")}`, runtimeRole = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), branchId = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
let created = false, roleCreated = false, foreignAccount = "";
let settlementRule = { id: "", version: 0 };
const accounts: Record<string, string> = {};

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
    "operating_expenses", "payment_runs", "payment_run_items", "daily_sales_cuts", "gateway_transactions", "bank_transactions"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id)`);
  }
  await pool.query(`CREATE UNIQUE INDEX daily_sales_cut_unique ON daily_sales_cuts (company_id,branch_id,business_date,shift,channel)`);
  await pool.query(`CREATE UNIQUE INDEX bank_fingerprint_unique ON bank_transactions (fingerprint)`);
  await pool.query(`CREATE UNIQUE INDEX gateway_external_unique ON gateway_transactions (company_id,acquirer,external_id)`);
  await pool.query("INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena')", [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at)
    VALUES ($1,'settlement@fixture.invalid','OWNER',$2,now(),now())`, [actorId, companyId]);
  await pool.query("INSERT INTO branches (id,company_id,name,code,ownership_type) VALUES ($1,$2,'Sucursal sintética','SYN','OWNED')", [branchId, companyId]);
  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules", "0131_fc09_expense_payments",
    "0132_fc09_treasury_source", "0133_fc10_accounting_events", "0134_fc11_sales", "0136_fc12_settlements"]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`).replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
      .replaceAll("TO pulso_app", `TO "${runtimeRole}"`);
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  }
  state.db = drizzle(pool, { schema });
  for (const [role, kind] of Object.entries({ CASH: "ASSET", CARD_RECEIVABLE: "ASSET", PLATFORM_RECEIVABLE: "ASSET",
    OTHER_RECEIVABLE: "ASSET", SALES_REVENUE: "INCOME", SALES_TAX: "LIABILITY", TIPS_PAYABLE: "LIABILITY",
    RECEPTION_SOURCE: "ASSET", COMMISSION_EXPENSE: "EXPENSE", RECOVERABLE_TAX: "ASSET" })) {
    accounts[role] = (await createAccount(ctx, { code: role, name: role, kind,
      normalBalance: kind === "ASSET" || kind === "EXPENSE" ? "DEBIT" : "CREDIT", validFrom: "2026-01-01" })).id;
  }
  await createRule(ctx, { code: "SALE_RECOGNIZED", name: "Venta reconocida", eventType: "SALE_RECOGNIZED",
    effectiveFrom: "2026-01-01", entries: ["CASH", "CARD_RECEIVABLE", "PLATFORM_RECEIVABLE", "OTHER_RECEIVABLE",
      "SALES_REVENUE", "SALES_TAX", "TIPS_PAYABLE"].map(role => ({ role, accountId: accounts[role] })) });
  const rule = await createRule(ctx, { code: "SETTLEMENT_RECOGNIZED", name: "Liquidación reconocida",
    eventType: "SETTLEMENT_RECOGNIZED", effectiveFrom: "2026-01-01",
    entries: ["RECEPTION_SOURCE", "COMMISSION_EXPENSE", "RECOVERABLE_TAX", "CARD_RECEIVABLE",
      "PLATFORM_RECEIVABLE", "OTHER_RECEIVABLE"].map(role => ({ role, accountId: accounts[role] })) });
  settlementRule = { id: rule.rule.id, version: rule.rule.version };
  foreignAccount = (await pool.query(`INSERT INTO accounting_accounts
    (id,company_id,code,name,kind,normal_balance,postable,active,valid_from,created_by,updated_by)
    VALUES ($1,$2,'CARD_RECEIVABLE','Por liquidar ajena','ASSET','DEBIT',true,true,'2026-01-01',$3,$3) RETURNING id`,
  [randomUUID(), foreignCompany, actorId])).rows[0].id;
}, 120000);
beforeEach(() => vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${runtimeRole}"`);
  } finally { await pool.end(); }
});

/** A validated card cut: the only thing that can register "por liquidar" capacity. */
async function cut(date: string, cardCents: number, taxCents: number) {
  const id = randomUUID();
  await pool.query(`INSERT INTO daily_sales_cuts
    (id,company_id,branch_id,business_date,shift,channel,total_sales,cash_sales,card_sales,other_payments,tax_amount,source,status,received_by)
    VALUES ($1,$2,$3,$4,'COMPLETO','TOTAL',$5,0,$6,0,$7,'UPLOAD','VALIDATED',$8)`,
  [id, companyId, branchId, date, cardCents, cardCents, taxCents, actorId]);
  await declareSalesCut(ctx, { documentId: randomUUID(), cutId: id, totalIncludesTaxAndTips: true,
    totalCents: cardCents, cashCents: 0, cardCents, platformCents: 0, otherCents: 0,
    revenueCents: cardCents - taxCents, discountCents: 0, taxCents, tipsCents: 0,
    documentReference: "SYN-CARD", reason: "Declaración sintética revisada" });
  return id;
}

type Line = { role: string; debit?: number; credit?: number; memo: string };
async function draft(date: string, lines: Line[], options: { sourceId?: string | null; reversalOfId?: string } = {}) {
  const sourceId = options.sourceId === undefined ? randomUUID() : options.sourceId;
  const [journal] = (await pool.query(`INSERT INTO accounting_journals
    (company_id,accounting_date,business_date,description,branch_id,source_type,source_id,source_version,event_type,
      rule_id,rule_version,reversal_of_id,created_by,updated_by)
    VALUES ($1,$2,$2,'Liquidación sintética de pasarela',$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id,version`,
  [companyId, date, branchId, sourceId ? "GATEWAY_SETTLEMENT" : null, sourceId, sourceId ? 1 : null,
    sourceId ? "SETTLEMENT_RECOGNIZED" : null, sourceId ? settlementRule.id : null,
    sourceId ? settlementRule.version : null, options.reversalOfId ?? null, actorId])).rows;
  for (const [index, line] of lines.entries()) {
    await pool.query(`INSERT INTO accounting_journal_lines
      (company_id,journal_id,line_number,account_id,debit_cents,credit_cents,memo) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [companyId, journal.id, index + 1, accounts[line.role], line.debit ?? 0, line.credit ?? 0, line.memo]);
  }
  return { id: journal.id as string, version: journal.version as number };
}

/** FC-02 October card settlement: net 225 040 + comisión 6 000 + IVA 960 = bruto 232 000. */
function settling(gross: number, role = "CARD_RECEIVABLE"): Line[] {
  return [
    { role: "RECEPTION_SOURCE", debit: gross - 6_960, memo: "SETTLEMENT:NET" },
    { role: "COMMISSION_EXPENSE", debit: 6_000, memo: "SETTLEMENT:COMMISSION" },
    { role: "RECOVERABLE_TAX", debit: 960, memo: "SETTLEMENT:COMMISSION_VAT" },
    { role, credit: gross, memo: "SETTLEMENT:RECEIVABLE" },
  ];
}

type Runner = { query: (sql: string, params?: readonly unknown[]) => Promise<unknown> };
const post = (id: string, version: number, number: number, client: Runner = pool) =>
  client.query(`UPDATE accounting_journals SET status='POSTED',number=$2,posted_at=now(),posted_by=$3,
    posting_reason='Depósito conciliado contra el corte',version=$4,updated_at=now() WHERE id=$1`,
  [id, number, actorId, version + 1]);

/** Corre el servicio con el rol runtime, como lo haría la aplicación. */
async function runtimeService<T>(operation: () => Promise<T>) {
  const client = await pool.connect(), previous = state.db;
  try {
    await client.query(`SET ROLE "${runtimeRole}"`);
    state.db = drizzle(client, { schema });
    return await operation();
  } finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
}

/**
 * Un depósito real: cuenta bancaria del catálogo, su vínculo contable, la partida
 * de pasarela liquidada y el match confirmado. `net` se pasa explícito porque una
 * liquidación sin cuadre debe existir como caso, no como comentario.
 */
async function deposit(gross: number, date: string, options: { acquirer?: string; net?: number;
  linkBank?: boolean; linkAcquirer?: boolean; withDeposit?: boolean } = {}) {
  const net = options.net ?? gross - 6_960, bankId = randomUUID();
  await pool.query(`INSERT INTO company_bank_accounts
    (id,company_id,label,account_number,account_last_four,account_fingerprint,bank_code,bank_name,registered_by,currency,active)
    VALUES ($1,$2,'Banco de recepción sintética',$3,'5555',$4,'012','Banco sintético',$5,'MXN',true)`,
  [bankId, companyId, encryptColumnWithDek("012345678901234", Buffer.alloc(32, 9)), randomUUID(), actorId]);
  if (options.linkBank !== false) await pool.query(`INSERT INTO accounting_source_links
    (company_id,account_id,bank_account_id,created_by,updated_by) VALUES ($1,$2,$3,$4,$4)`,
  [companyId, accounts.RECEPTION_SOURCE, bankId, actorId]);
  const gateway = randomUUID();
  await pool.query(`INSERT INTO gateway_transactions (id,company_id,branch_id,acquirer,external_id,transaction_date,
    settlement_date,gross_amount_cents,fee_amount_cents,fee_vat_cents,net_amount_cents,destination_bank_account_id,
    status,imported_by) VALUES ($1,$2,$3,$4,$5,$6::date::timestamp,$6::date,$7,6000,960,$8,$9,'SETTLED',$10)`,
  [gateway, companyId, branchId, options.acquirer ?? "CLIP", `EXT-${randomUUID()}`, date, gross, net, bankId, actorId]);
  if (options.withDeposit !== false) await pool.query(`INSERT INTO bank_transactions
    (id,company_id,source_bank_account_id,value_date,description,amount_cents,fingerprint,match_status,
      matched_gateway_transaction_id,imported_by)
    VALUES ($1,$2,$3,$4,'Depósito de pasarela',$5,$6,'MATCHED',$7,$8)`,
  [randomUUID(), companyId, bankId, date, net, randomUUID(), gateway, actorId]);
  // CLIP ya quedó vinculado en la primera prueba; volver a insertarlo sería el
  // conflicto que esa prueba exige, no una configuración nueva.
  if (options.linkAcquirer === true) await pool.query(`INSERT INTO accounting_gateway_links
    (company_id,account_id,gateway_acquirer,sales_destination,created_by,updated_by) VALUES ($1,$2,$3,'CARD',$4,$4)`,
  [companyId, accounts.CARD_RECEIVABLE, options.acquirer ?? "CLIP", actorId]);
  return { gateway, bank: bankId };
}

const settle = (sourceId: string) => runtimeService(() =>
  withCompanyContext(ctx, tx => settleConfirmedTransactionIn(tx, companyId, actorId, sourceId)));

it("links one acquirer to one por-liquidar destination and rejects ambiguous targets", async () => {
  const link = (company: string, account: string, acquirer: string, destination: string | null = "CARD") =>
    pool.query(`INSERT INTO accounting_gateway_links
      (company_id,account_id,gateway_acquirer,sales_destination,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$5)`,
    [company, account, acquirer, destination, actorId]);
  expect((await link(companyId, accounts.CARD_RECEIVABLE, "CLIP")).rowCount).toBe(1);
  await expect(link(companyId, accounts.CARD_RECEIVABLE, "CLIP")).rejects.toMatchObject({ code: "23505" });
  expect((await link(foreignCompany, foreignAccount, "CLIP")).rowCount).toBe(1);
  expect((await link(companyId, accounts.TIPS_PAYABLE, "MERCADO_PAGO")).rowCount).toBe(1);
  await expect(link(companyId, accounts.CARD_RECEIVABLE, "SANTANDER", "TAX")).rejects.toMatchObject({ code: "23514" });
  await expect(link(companyId, accounts.SALES_REVENUE, "BBVA")).rejects.toMatchObject({ code: "23514" });
  await expect(link(foreignCompany, accounts.CARD_RECEIVABLE, "BANORTE")).rejects.toMatchObject({ code: "23503" });
  await expect(pool.query(`UPDATE accounting_gateway_links SET gateway_acquirer='BBVA'
    WHERE company_id=$1 AND gateway_acquirer='MERCADO_PAGO'`, [companyId])).rejects.toMatchObject({ code: "23514" });
  await expect(pool.query(`UPDATE accounting_gateway_links SET account_id=$2,updated_at=now()
    WHERE company_id=$1 AND gateway_acquirer='MERCADO_PAGO'`, [companyId, accounts.CARD_RECEIVABLE]))
    .resolves.toMatchObject({ rowCount: 1 });
  expect((await pool.query(`SELECT gateway_acquirer,sales_destination,company_id FROM accounting_gateway_links
    WHERE company_id=ANY($1) ORDER BY company_id,gateway_acquirer`, [[companyId, foreignCompany]]))
    .rows.map(row => `${row.company_id.slice(0, 4)}:${row.gateway_acquirer}:${row.sales_destination}`))
    .toEqual([`${companyId.slice(0, 4)}:CLIP:CARD`, `${companyId.slice(0, 4)}:MERCADO_PAGO:CARD`, `${foreignCompany.slice(0, 4)}:CLIP:CARD`].sort());
});

it("records the settlement fact type and refuses an unversioned source identity", async () => {
  const event = (sourceType: string, eventType: string, version: number) => pool.query(`INSERT INTO accounting_events
    (company_id,branch_id,source_type,source_id,event_type,source_version,actor_id,accounting_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-11-02')`, [companyId, branchId, sourceType, randomUUID(), eventType, version, actorId]);
  expect((await event("GATEWAY_SETTLEMENT", "SETTLEMENT_RECOGNIZED", 1)).rowCount).toBe(1);
  await expect(event("GATEWAY_SETTLEMENT", "SALE_RECOGNIZED", 1)).rejects.toMatchObject({ code: "23514" });
  await expect(event("GATEWAY_SETTLEMENT", "SETTLEMENT_RECOGNIZED", 2)).rejects.toMatchObject({ code: "23514" });
  await expect(event("BANK_ACCOUNT", "SETTLEMENT_RECOGNIZED", 1)).rejects.toMatchObject({ code: "23514" });
});

it("settles exactly the por-liquidar balance the cuts registered, in the month it was deposited", async () => {
  await cut("2026-10-31", 232_000, 32_000);
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2026,10,'CLOSED')", [companyId]);
  const settled = await draft("2026-11-02", settling(232_000));
  await expect(post(settled.id, settled.version, 10)).resolves.toBeDefined();
  expect((await pool.query("SELECT status,number FROM accounting_journals WHERE id=$1", [settled.id])).rows)
    .toEqual([{ status: "POSTED", number: 10 }]);
  const over = await draft("2026-11-03", settling(232_001));
  await expect(post(over.id, over.version, 11)).rejects.toMatchObject({ code: "23514" });
  await expect(post(over.id, over.version, 11)).rejects.toThrow(/excede la cuenta por liquidar CARD_RECEIVABLE/);
  expect((await pool.query("SELECT status FROM accounting_journals WHERE id=$1", [over.id])).rows).toEqual([{ status: "DRAFT" }]);
  const platform = await draft("2026-11-04", settling(7_000, "PLATFORM_RECEIVABLE"));
  await expect(post(platform.id, platform.version, 12)).rejects.toThrow(/PLATFORM_RECEIVABLE/);
});

it("refuses a settlement with no cut behind it and keeps capacity accumulated per account", async () => {
  const orphan = await draft("2026-11-05", settling(50_000));
  await expect(post(orphan.id, orphan.version, 20)).rejects.toMatchObject({ code: "23514" });
  await cut("2026-11-05", 50_000, 6_896);
  await expect(post(orphan.id, orphan.version, 21)).resolves.toBeDefined();
  const second = await draft("2026-11-06", settling(50_000));
  await expect(post(second.id, second.version, 22)).rejects.toMatchObject({ code: "23514" });
});

it("serialises two concurrent settlements against one por-liquidar balance", async () => {
  await cut("2026-11-07", 10_000, 1_379);
  const a = await draft("2026-11-07", settling(10_000)), b = await draft("2026-11-07", settling(10_000));
  const first = await pool.connect(), second = await pool.connect();
  try {
    await first.query("BEGIN");
    await post(a.id, a.version, 30, first);
    const pending = second.query("BEGIN").then(() => post(b.id, b.version, 31, second));
    let finished = false;
    await Promise.race([pending.then(() => { finished = true; }).catch(() => undefined),
      new Promise(resolve => setTimeout(resolve, 500))]);
    expect(finished).toBe(false);
    await first.query("COMMIT");
    await expect(pending).rejects.toMatchObject({ code: "23514" });
    await second.query("ROLLBACK");
  } finally {
    // Un rollback explícito: una transacción abortada devuelta al pool envenena
    // la siguiente prueba que reutilice esa conexión.
    await first.query("ROLLBACK").catch(() => undefined); first.release();
    await second.query("ROLLBACK").catch(() => undefined); second.release();
  }
  const statuses = (await pool.query("SELECT status FROM accounting_journals WHERE id=ANY($1)", [[a.id, b.id]]))
    .rows.map(row => row.status).sort();
  expect(statuses).toEqual(["DRAFT", "POSTED"]);
});

it("frees the balance through a reversal and refuses snapshots taken outside read committed", async () => {
  await cut("2026-11-08", 20_000, 2_759);
  const settled = await draft("2026-11-08", settling(20_000));
  await post(settled.id, settled.version, 40);
  const reversal = await draft("2026-12-01", [
    { role: "RECEPTION_SOURCE", credit: 13_040, memo: "SETTLEMENT:NET" },
    { role: "COMMISSION_EXPENSE", credit: 6_000, memo: "SETTLEMENT:COMMISSION" },
    { role: "RECOVERABLE_TAX", credit: 960, memo: "SETTLEMENT:COMMISSION_VAT" },
    { role: "CARD_RECEIVABLE", debit: 20_000, memo: "SETTLEMENT:RECEIVABLE" },
  ], { sourceId: null, reversalOfId: settled.id });
  await expect(post(reversal.id, reversal.version, 41)).resolves.toBeDefined();
  const again = await draft("2026-12-02", settling(20_000));
  await expect(post(again.id, again.version, 42)).resolves.toBeDefined();
  const blocked = await draft("2026-12-02", settling(20_000));
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await expect(post(blocked.id, blocked.version, 43, client)).rejects.toThrow(/Las liquidaciones requieren READ COMMITTED/);
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
});

it("enforces tenant row security on acquirer links for the runtime role", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
    expect((await client.query("SELECT gateway_acquirer,sales_destination FROM accounting_gateway_links ORDER BY gateway_acquirer")).rows)
      .toEqual([{ gateway_acquirer: "CLIP", sales_destination: "CARD" }, { gateway_acquirer: "MERCADO_PAGO", sales_destination: "CARD" }]);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [foreignCompany]);
    expect((await client.query("SELECT gateway_acquirer FROM accounting_gateway_links")).rows)
      .toEqual([{ gateway_acquirer: "CLIP" }]);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
    await expect(client.query(`INSERT INTO accounting_gateway_links
      (company_id,account_id,gateway_acquirer,sales_destination,created_by,updated_by)
      VALUES ($1,$2,'OTHER','CARD',$3,$3)`, [foreignCompany, foreignAccount, actorId])).rejects.toMatchObject({ code: "42501" });
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
});

it("grants the runtime role only the settlement columns it needs", async () => {
  const gateway = randomUUID(), bank = randomUUID();
  await pool.query(`INSERT INTO gateway_transactions (id,company_id,branch_id,acquirer,external_id,transaction_date,
    gross_amount_cents,fee_amount_cents,fee_vat_cents,net_amount_cents,status,imported_by)
    VALUES ($1,$2,$3,'CLIP','EXT-1','2026-11-02',232000,6000,960,225040,'SETTLED',$4)`, [gateway, companyId, branchId, actorId]);
  await pool.query(`INSERT INTO bank_transactions (id,company_id,source_bank_account_id,value_date,description,amount_cents,
    fingerprint,match_status,matched_gateway_transaction_id,imported_by)
    VALUES ($1,$2,$3,'2026-11-02','Depósito Clip',225040,$4,'MATCHED',$5,$6)`,
  [bank, companyId, randomUUID(), randomUUID(), gateway, actorId]);
  const client = await pool.connect();
  try {
    await client.query(`SET ROLE "${runtimeRole}"`);
    expect((await client.query(`SELECT id,company_id,branch_id,acquirer,external_id,transaction_date,settlement_date,
      gross_amount_cents,fee_amount_cents,fee_vat_cents,net_amount_cents,destination_bank_account_id,status,imported_by
      FROM gateway_transactions WHERE id=$1`, [gateway])).rows).toHaveLength(1);
    expect((await client.query(`SELECT id,company_id,source_bank_account_id,value_date,amount_cents,match_status,
      matched_gateway_transaction_id FROM bank_transactions WHERE id=$1`, [bank])).rows).toHaveLength(1);
    await expect(client.query("SELECT card_last_4,raw_report_file_url FROM gateway_transactions")).rejects.toMatchObject({ code: "42501" });
    await expect(client.query("SELECT description,reference,fingerprint FROM bank_transactions")).rejects.toMatchObject({ code: "42501" });
    await expect(client.query("UPDATE gateway_transactions SET status='REFUNDED' WHERE id=$1", [gateway])).rejects.toMatchObject({ code: "42501" });
  } finally { await client.query("RESET ROLE"); client.release(); }
});

it("posts from the real bank confirmation, reimports once and never recognizes another sale", async () => {
  await cut("2030-10-31", 232_000, 32_000);
  const source = await deposit(232_000, "2030-11-02", { acquirer: "UBER_EATS", withDeposit: false, linkAcquirer: true });
  const csvText = "fecha,descripcion,monto,referencia\n2030-11-02,Depósito,2250.40,FC12-E2E";
  const input = { companyId, importedBy: actorId, sourceBankAccountId: source.bank, csvText };
  expect(await importBankStatement(input)).toEqual({ importedCount: 1, duplicateCount: 0, errorCount: 0 });
  const transactionId = (await pool.query("SELECT id FROM bank_transactions WHERE source_bank_account_id=$1", [source.bank])).rows[0].id;
  const match = { companyId, transactionId, gatewayTransactionId: source.gateway, userId: actorId };
  await confirmDepositMatch(match);
  const journals = (await pool.query("SELECT id,status,accounting_date::text FROM accounting_journals WHERE source_id=$1", [source.gateway])).rows;
  expect(journals).toHaveLength(1);
  expect(journals[0]).toMatchObject({ status: "POSTED", accounting_date: "2030-11-02" });
  expect((await pool.query(`SELECT a.kind,l.debit_cents::int,l.credit_cents::int FROM accounting_journal_lines l
    JOIN accounting_accounts a ON a.id=l.account_id WHERE l.journal_id=$1 ORDER BY l.line_number`, [journals[0].id])).rows)
    .toEqual([{ kind: "ASSET", debit_cents: 225040, credit_cents: 0 },
      { kind: "EXPENSE", debit_cents: 6000, credit_cents: 0 },
      { kind: "ASSET", debit_cents: 960, credit_cents: 0 },
      { kind: "ASSET", debit_cents: 0, credit_cents: 232000 }]);
  expect(await importBankStatement(input)).toEqual({ importedCount: 0, duplicateCount: 1, errorCount: 0 });
  await expect(confirmDepositMatch(match)).rejects.toMatchObject({ statusCode: 409 });
  expect((await settle(source.gateway)).journal?.id).toBe(journals[0].id);
  await expect(unmatchDepositTransaction({ companyId, transactionId })).rejects.toMatchObject({ statusCode: 409 });
  await expect(unmatchTransaction({ companyId, transactionId })).rejects.toMatchObject({ statusCode: 400 });
});

it("posts a zero-commission deposit using only bank and receivable lines", async () => {
  await cut("2031-01-01", 10_000, 0);
  const source = await deposit(10_000, "2031-01-02", { net: 10_000, acquirer: "OTHER", linkAcquirer: true });
  await pool.query("UPDATE gateway_transactions SET fee_amount_cents=0,fee_vat_cents=0 WHERE id=$1", [source.gateway]);
  const result = await settle(source.gateway);
  expect(result.reason).toBeNull();
  expect(result.journal).toBeTruthy();
  expect((await pool.query("SELECT debit_cents::int,credit_cents::int FROM accounting_journal_lines WHERE journal_id=$1 ORDER BY line_number", [result.journal!.id])).rows)
    .toEqual([{ debit_cents: 10000, credit_cents: 0 }, { debit_cents: 0, credit_cents: 10000 }]);
});

it("keeps a confirmed deposit pending for a missing bank link and recovers it exactly once", async () => {
  await cut("2032-01-01", 20_000, 0);
  const source = await deposit(20_000, "2032-01-02", { linkBank: false, acquirer: "DIDI", linkAcquirer: true });
  const result = await settle(source.gateway);
  expect(result.journal).toBeNull();
  expect(result.reason).toMatch(/no tiene vínculo contable/);
  const [event] = (await pool.query("SELECT id,status,last_error FROM accounting_events WHERE source_id=$1", [source.gateway])).rows;
  expect(event.status).toBe("PENDING");
  expect(event.last_error).toMatch(/no tiene vínculo contable/);
  await expect(retryAccountingEvent({ ...ctx, role: "EMPLEADO" }, event.id)).rejects.toMatchObject({ statusCode: 403 });
  await pool.query(`INSERT INTO accounting_source_links (company_id,account_id,bank_account_id,created_by,updated_by)
    VALUES ($1,$2,$3,$4,$4)`, [companyId, accounts.RECEPTION_SOURCE, source.bank, actorId]);
  const recovered = await runtimeService(() => retryAccountingEvent(ctx, event.id));
  expect(recovered.journal).toBeTruthy();
  expect((await runtimeService(() => processAccountingEvent(companyId, event.id))).journal?.id).toBe(recovered.journal!.id);
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [source.gateway])).rows).toHaveLength(1);
});

it("recovers a missing settlement fact and respects a closed deposit month", async () => {
  await cut("2033-01-01", 20_000, 0);
  const source = await deposit(20_000, "2033-02-02");
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2033,2,'CLOSED')", [companyId]);
  await runtimeService(() => recoverMissingAccountingEvents(companyId));
  const [event] = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [source.gateway])).rows;
  expect(event).toBeTruthy();
  const result = await runtimeService(() => processAccountingEvent(companyId, event.id));
  expect(result.journal).toBeNull();
  expect(result.reason).toMatch(/cerrado/);
});

it("does not create settlement facts with posting disabled", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0");
  const source = await deposit(20_000, "2034-01-02");
  expect((await settle(source.gateway)).journal).toBeNull();
  expect((await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [source.gateway])).rows).toHaveLength(0);
});

it("configures acquirer links through the authorized service without exposing other tenants", async () => {
  const input = { accountId: accounts.PLATFORM_RECEIVABLE, gatewayAcquirer: "RAPPI" as const, salesDestination: "PLATFORM" as const };
  await expect(linkGateway({ ...ctx, role: "EMPLEADO" }, input)).rejects.toMatchObject({ statusCode: 403 });
  await expect(linkGateway(ctx, { ...input, accountId: foreignAccount })).rejects.toMatchObject({ statusCode: 404 });
  const linked = await runtimeService(() => linkGateway(ctx, input));
  expect(linked).toMatchObject({ companyId, ...input });
  const changed = await runtimeService(() => linkGateway(ctx, { ...input, accountId: accounts.OTHER_RECEIVABLE, salesDestination: "OTHER" }));
  expect(changed.id).toBe(linked.id);
  const page = await runtimeService(() => listGatewayLinks(ctx));
  expect(page.items.find(row => row.gatewayAcquirer === "RAPPI")).toMatchObject({ accountId: accounts.OTHER_RECEIVABLE, salesDestination: "OTHER" });
  expect(page.items.every(row => row.companyId === companyId)).toBe(true);
});

it("posts a second receiving bank to its own linked account without changing the generic rule", async () => {
  await cut("2035-01-01", 20_000, 0);
  const bankAccount = await createAccount(ctx, { code: "SECOND_RECEIVING_BANK", name: "Segundo banco",
    kind: "ASSET", normalBalance: "DEBIT", validFrom: "2026-01-01" });
  const source = await deposit(20_000, "2035-01-02");
  await pool.query("UPDATE accounting_source_links SET account_id=$2 WHERE bank_account_id=$1", [source.bank, bankAccount.id]);
  const result = await settle(source.gateway);
  expect(result.reason).toBeNull();
  expect(result.journal).toBeTruthy();
  expect((await pool.query("SELECT account_id,debit_cents::int FROM accounting_journal_lines WHERE journal_id=$1 AND memo='SETTLEMENT:NET'", [result.journal!.id])).rows)
    .toEqual([{ account_id: bankAccount.id, debit_cents: 13040 }]);
});

it("keeps an inactive mapped receiving account pending without rolling back the captured fact", async () => {
  const bankAccount = await createAccount(ctx, { code: "INACTIVE_RECEIVING_BANK", name: "Banco retirado",
    kind: "ASSET", normalBalance: "DEBIT", validFrom: "2026-01-01" });
  const source = await deposit(20_000, "2036-01-02");
  await pool.query("UPDATE accounting_source_links SET account_id=$2 WHERE bank_account_id=$1", [source.bank, bankAccount.id]);
  await pool.query("UPDATE accounting_accounts SET active=false WHERE id=$1", [bankAccount.id]);
  const result = await settle(source.gateway);
  expect(result.journal).toBeNull();
  expect(result.reason).toMatch(/activa.*vigente/);
  expect((await pool.query("SELECT status FROM accounting_events WHERE source_id=$1", [source.gateway])).rows)
    .toEqual([{ status: "PENDING" }]);
});

it("posts the minimum settlement rule using the bank link without a generic reception role", async () => {
  await createRule(ctx, { code: "SETTLEMENT_RECOGNIZED", name: "Liquidación por banco seleccionado",
    eventType: "SETTLEMENT_RECOGNIZED", effectiveFrom: "2037-01-01", supersedesId: settlementRule.id,
    entries: ["COMMISSION_EXPENSE", "RECOVERABLE_TAX", "CARD_RECEIVABLE"].map(role => ({ role, accountId: accounts[role] })) });
  await cut("2037-01-01", 20_000, 0);
  const source = await deposit(20_000, "2037-01-02");
  const result = await settle(source.gateway);
  expect(result.reason).toBeNull();
  expect(result.journal).toMatchObject({ ruleVersion: 2, status: "POSTED" });
  expect((await pool.query("SELECT account_id,debit_cents::int FROM accounting_journal_lines WHERE journal_id=$1 AND memo='SETTLEMENT:NET'", [result.journal!.id])).rows)
    .toEqual([{ account_id: accounts.RECEPTION_SOURCE, debit_cents: 13040 }]);
});
