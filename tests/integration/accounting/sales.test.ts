import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAccount } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import * as mappingService from "@/lib/services/accounting/mapping-service";
import { declareSalesCut, recordSalesRefund } from "@/lib/services/accounting/sales-adapter";
import { processAccountingEvent } from "@/lib/services/accounting/event-service";
import { reverseJournal } from "@/lib/services/accounting/journal-service";
import { ingestSalesCut, previewSalesCut } from "@/lib/services/sales-ingestion-service";
import { month } from "@/tests/fixtures/accounting/month";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
neonConfig.webSocketConstructor = ws;
const namespace = `fc11_${randomUUID().replaceAll("-", "")}`, runtimeRole = `${namespace}_app`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4, allowExitOnIdle: true,
  connectionTimeoutMillis: 5000, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=15000` });
const companyId = randomUUID(), foreignCompany = randomUUID(), actorId = randomUUID(), branchId = randomUUID();
const ctx = { companyId, actorId, role: "OWNER" as const };
let created = false, roleCreated = false;
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
  await pool.query(`CREATE TYPE "${namespace}".expense_payment_method AS ENUM (${schema.expensePaymentMethodEnum.enumValues.map(v => `'${v}'`).join(",")})`);
  for (const table of ["companies", "users", "cost_centers", "company_bank_accounts", "branches", "financial_periods",
    "operating_expenses", "payment_runs", "payment_run_items", "daily_sales_cuts"]) {
    await pool.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await pool.query(`ALTER TABLE "${namespace}".${table} ADD PRIMARY KEY (id)`);
  }
  await pool.query(`CREATE UNIQUE INDEX daily_sales_cut_unique ON daily_sales_cuts (company_id,branch_id,business_date,shift,channel)`);
  await pool.query("INSERT INTO companies (id,name) VALUES ($1,'Sintética'),($2,'Ajena')", [companyId, foreignCompany]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,created_at,updated_at)
    VALUES ($1,'sales@fixture.invalid','OWNER',$2,now(),now())`, [actorId, companyId]);
  await pool.query("INSERT INTO branches (id,company_id,name,code) VALUES ($1,$2,'Sucursal sintética','SYN')", [branchId, companyId]);
  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`); roleCreated = true;
  await pool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);
  for (const file of ["0124_fc05_tenant_keys", "0125_fc05_accounts", "0126_fc05_account_guards", "0127_fc06_journals",
    "0128_fc06_journal_guards", "0129_fc07_review", "0130_fc08_rules", "0131_fc09_expense_payments",
    "0132_fc09_treasury_source", "0133_fc10_accounting_events", "0134_fc11_sales"]) {
    const migration = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll('SCHEMA "public"', `SCHEMA "${namespace}"`).replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
      .replaceAll("TO pulso_app", `TO "${runtimeRole}"`);
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  }
  state.db = drizzle(pool, { schema });
  for (const role of ["CASH", "CARD_RECEIVABLE", "PLATFORM_RECEIVABLE", "OTHER_RECEIVABLE",
    "SALES_REVENUE", "SALES_TAX", "TIPS_PAYABLE"]) {
    const kind = role === "SALES_REVENUE" || role === "SALES_DISCOUNTS" ? "INCOME"
      : role === "SALES_TAX" || role === "TIPS_PAYABLE" ? "LIABILITY" : "ASSET";
    accounts[role] = (await createAccount(ctx, { code: role, name: role, kind,
      normalBalance: role === "SALES_REVENUE" || kind === "LIABILITY" ? "CREDIT" : "DEBIT", validFrom: "2026-01-01" })).id;
  }
  for (const eventType of ["SALE_RECOGNIZED", "SALE_REFUNDED"]) await createRule(ctx, {
    code: eventType, name: eventType, eventType, effectiveFrom: "2026-01-01",
    entries: Object.entries(accounts).map(([role, accountId]) => ({ role, accountId })),
  });
}, 120000);
afterAll(async () => {
  try { if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    if (roleCreated) await pool.query(`DROP ROLE "${runtimeRole}"`);
  } finally { await pool.end(); }
});

const amounts = { totalCents: 11800, cashCents: 11800, cardCents: 0, platformCents: 0, otherCents: 0,
  revenueCents: 10000, discountCents: 0, taxCents: 1600, tipsCents: 200 };
const declaration = (cutId: string) => ({ ...amounts, documentId: randomUUID(), cutId,
  totalIncludesTaxAndTips: true as const, documentReference: "SYN-POS", reason: "Declaración sintética revisada" });

it("recognizes a documented sale once under concurrent retries, separating tax and tips", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await cut("2026-10-02"), data = declaration(id);
  const results = await Promise.all([declareSalesCut(ctx, data), declareSalesCut(ctx, data)]);
  expect(results[0].journal?.id).toBe(results[1].journal?.id);
  expect((await pool.query("SELECT source_version,status FROM accounting_journals WHERE source_id=$1", [id])).rows)
    .toEqual([{ source_version: 1, status: "POSTED" }]);
  expect((await pool.query(`SELECT memo,debit_cents::int,credit_cents::int FROM accounting_journal_lines WHERE journal_id=$1 ORDER BY line_number`,
    [results[0].journal!.id])).rows).toEqual([
    { memo: "SALE:CASH", debit_cents: 11800, credit_cents: 0 },
    { memo: "SALE:SALES_REVENUE", debit_cents: 0, credit_cents: 10000 },
    { memo: "SALE:SALES_TAX", debit_cents: 0, credit_cents: 1600 },
    { memo: "SALE:TIPS_PAYABLE", debit_cents: 0, credit_cents: 200 },
  ]);
});

it("keeps gross-after-discount distinct from revenue, cash and each unsettled payment method", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await cut("2026-10-03");
  await pool.query(`UPDATE daily_sales_cuts SET total_sales=11220,cash_sales=2000,card_sales=4000,other_payments=5220,tax_amount=1520 WHERE id=$1`, [id]);
  const result = await declareSalesCut(ctx, { ...declaration(id), totalCents: 11220, cashCents: 2000, cardCents: 4000,
    platformCents: 4000, otherCents: 1220, discountCents: 500, taxCents: 1520 });
  expect(result.journal?.status).toBe("POSTED");
  expect((await pool.query(`SELECT sum(debit_cents)::int debit,sum(credit_cents)::int credit FROM accounting_journal_lines WHERE journal_id=$1`,
    [result.journal!.id])).rows[0]).toEqual({ debit: 11220, credit: 11220 });
});

it("blocks overlapping TOTAL/channel cuts and recovers once the noncanonical cut is rejected", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await cut("2026-10-04"), extra = await cut("2026-10-04", "SALON");
  const result = await declareSalesCut(ctx, declaration(id));
  expect(result.journal).toBeNull(); expect(result.reason).toContain("solapados");
  await pool.query("UPDATE daily_sales_cuts SET status='REJECTED' WHERE id=$1", [extra]);
  const event = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [id])).rows[0];
  expect((await processAccountingEvent(companyId, event.id)).journal).toMatchObject({ status: "POSTED" });
  await expect(pool.query(`INSERT INTO accounting_events (company_id,branch_id,source_type,source_id,event_type,actor_id)
    VALUES ($1,$2,'SALES_ENTRY',$3,'SALE_RECOGNIZED',$4)`, [companyId, branchId, randomUUID(), actorId]))
    .rejects.toMatchObject({ code: "23514" });
});

it("records partial refunds once, limits concurrent refunds and forbids untracked manual reversals", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const sale = await declareSalesCut(ctx, declaration(await cut("2026-10-05")));
  const data = { ...amounts, totalCents: 1180, cashCents: 1180, revenueCents: 1000, taxCents: 160, tipsCents: 20,
    documentId: randomUUID(), originalId: sale.document.id, accountingDate: "2026-11-01", documentReference: "REF-PARTIAL", reason: "Devolución parcial documentada" };
  const first = await recordSalesRefund(ctx, data), retry = await recordSalesRefund(ctx, data);
  expect(first.journal?.id).toBe(retry.journal?.id);
  const remainder = { ...data, totalCents: 10620, cashCents: 10620, revenueCents: 9000, taxCents: 1440, tipsCents: 180 };
  const results = await Promise.allSettled([
    recordSalesRefund(ctx, { ...remainder, documentId: randomUUID() }),
    recordSalesRefund(ctx, { ...remainder, documentId: randomUUID() }),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const refund = results.find(result => result.status === "fulfilled")!;
  if (refund.status !== "fulfilled") throw new Error("No refund completed");
  expect(refund.value.journal?.status).toBe("POSTED");
  expect((await pool.query(`SELECT sum(l.debit_cents-l.credit_cents)::int net FROM accounting_journal_lines l
    WHERE l.account_id=$1 AND l.journal_id=ANY($2::uuid[])`, [accounts.CASH,
    [sale.journal!.id, first.journal!.id, refund.value.journal!.id]])).rows[0].net).toBe(0);
  await expect(reverseJournal(ctx, sale.journal!.id, { expectedVersion: 2, accountingDate: "2026-11-01", reason: "Intento de reversa manual" }))
    .rejects.toMatchObject({ statusCode: 409 });
  await expect(recordSalesRefund(ctx, { ...data, documentId: randomUUID() })).rejects.toMatchObject({ statusCode: 409 });
});

it("preserves the old business date and creates a linked new version only after the full refund posts", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await cut("2026-10-06"), data = declaration(id), original = await declareSalesCut(ctx, data);
  await pool.query("UPDATE daily_sales_cuts SET business_date='2026-11-02' WHERE id=$1", [id]);
  expect((await declareSalesCut(ctx, data)).journal?.businessDate).toBe("2026-10-06");
  await expect(declareSalesCut(ctx, { ...data, documentId: randomUUID(), version: 2, originalId: original.document.id }))
    .rejects.toMatchObject({ statusCode: 409 });
  const refund = await recordSalesRefund(ctx, { ...amounts, documentId: randomUUID(), originalId: original.document.id,
    accountingDate: "2026-11-02", documentReference: "REF-DATE", reason: "Corrección de fecha de negocio" });
  expect(refund.journal?.status).toBe("POSTED");
  const corrected = await declareSalesCut(ctx, { ...data, documentId: randomUUID(), version: 2, originalId: original.document.id });
  expect(corrected.journal).toMatchObject({ businessDate: "2026-11-02", sourceVersion: 2, status: "POSTED" });
  expect((await pool.query("SELECT source_version,business_date::text FROM accounting_journals WHERE source_type='DAILY_SALES_CUT' AND source_id=$1 ORDER BY source_version", [id])).rows)
    .toEqual([{ source_version: 1, business_date: "2026-10-06" }, { source_version: 2, business_date: "2026-11-02" }]);
  expect((await pool.query("SELECT source_version,status FROM accounting_events WHERE source_id=$1 ORDER BY source_version", [id])).rows)
    .toEqual([{ source_version: 1, status: "POSTED" }, { source_version: 2, status: "POSTED" }]);
});

it("rejects undocumented, unvalidated, cross-company, closed-period and unauthorized declarations", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await cut("2026-10-07"), data = declaration(id);
  await expect(declareSalesCut(ctx, { ...data, tipsCents: undefined as unknown as number })).rejects.toMatchObject({ statusCode: 400 });
  await expect(declareSalesCut({ ...ctx, companyId: foreignCompany }, data)).rejects.toMatchObject({ statusCode: 403 });
  await expect(declareSalesCut(ctx, { ...data, cutId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
  await pool.query("UPDATE daily_sales_cuts SET status='PENDING_REVIEW' WHERE id=$1", [id]);
  await expect(declareSalesCut(ctx, data)).rejects.toMatchObject({ statusCode: 409 });
  await pool.query("UPDATE daily_sales_cuts SET status='VALIDATED',business_date='2026-12-01' WHERE id=$1", [id]);
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2026,12,'CLOSED')", [companyId]);
  await expect(declareSalesCut(ctx, data)).rejects.toMatchObject({ statusCode: 409 });
  const manager = randomUUID(), hidden = randomUUID();
  await pool.query("INSERT INTO branches (id,company_id,name) VALUES ($1,$2,'Oculta')", [hidden, companyId]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,branch_id,created_at,updated_at)
    VALUES ($1,$2,'GERENTE',$3,$4,now(),now())`, [manager, `${manager}@fixture.invalid`, companyId, hidden]);
  await expect(declareSalesCut({ companyId, actorId: manager, role: "GERENTE" }, data)).rejects.toMatchObject({ statusCode: 403 });
  expect((await pool.query("SELECT id FROM accounting_sales_documents WHERE cut_id=$1", [id])).rows).toEqual([]);
});

const upload = (date: string) => ({ companyId, branchId, receivedBy: actorId, shift: "COMPLETO" as const, source: "UPLOAD" as const,
  fileName: "synthetic.csv", buffer: Buffer.from(`Fecha,Total,Efectivo,Tarjeta,Otros,IVA,Tickets\n${date},118,118,0,0,16,1\n`) });

it("persists ingestion and its fact together, survives missing declaration and rejects a repeated canonical import", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const result = await ingestSalesCut(upload("2026-10-20"));
  expect(result.rows).toHaveLength(1);
  const id = result.rows[0].id;
  const event = (await pool.query("SELECT * FROM accounting_events WHERE source_id=$1", [id])).rows[0];
  expect(event).toMatchObject({ source_type: "DAILY_SALES_CUT", status: "PENDING", source_version: 1 });
  expect((await processAccountingEvent(companyId, event.id)).reason).toContain("declaración");
  expect((await declareSalesCut(ctx, declaration(id))).journal?.status).toBe("POSTED");
  await expect(ingestSalesCut(upload("2026-10-20"))).rejects.toMatchObject({ code: "DUPLICATE_CUT" });
  const tickets = Buffer.from("Folio,Fecha,Forma de Pago,Total,IVA\n" + Array.from({ length: 16 }, (_, index) =>
    `${index + 1},2026-10-20,Efectivo,${index === 15 ? "7.45" : "7.37"},1`).join("\n"));
  expect((await previewSalesCut({ buffer: tickets, fileName: "tickets.csv" })).fileShape).toBe("ticket_detail");
  await expect(ingestSalesCut({ ...upload("2026-10-20"), buffer: tickets, fileName: "tickets.csv" }))
    .rejects.toMatchObject({ code: "DUPLICATE_CUT" });
  expect((await pool.query("SELECT id FROM accounting_journals WHERE source_id=$1", [id])).rows).toHaveLength(1);
});

it("rolls back ingestion on fact persistence failure and leaves the disabled path unchanged", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  await pool.query(`CREATE FUNCTION reject_sales_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.source_type='DAILY_SALES_CUT' THEN RAISE EXCEPTION 'Injected fact failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER reject_sales_event BEFORE INSERT ON accounting_events FOR EACH ROW EXECUTE FUNCTION reject_sales_event()`);
  try { await expect(ingestSalesCut(upload("2026-10-21"))).rejects.toBeDefined(); }
  finally { await pool.query("DROP TRIGGER reject_sales_event ON accounting_events"); await pool.query("DROP FUNCTION reject_sales_event()"); }
  expect((await pool.query("SELECT id FROM daily_sales_cuts WHERE business_date='2026-10-21'")).rows).toEqual([]);
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0");
  const result = await ingestSalesCut(upload("2026-10-21"));
  expect((await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [result.rows[0].id])).rows).toEqual([]);
});

it("fails closed before source persistence when transactional capture is not installed or enabled", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  await pool.query("ALTER TABLE daily_sales_cuts DISABLE TRIGGER accounting_capture_sales_cut");
  try { await expect(ingestSalesCut(upload("2026-10-29"))).rejects.toMatchObject({ statusCode: 503 }); }
  finally { await pool.query("ALTER TABLE daily_sales_cuts ENABLE TRIGGER accounting_capture_sales_cut"); }
  expect((await pool.query("SELECT id FROM daily_sales_cuts WHERE business_date='2026-10-29'")).rows).toEqual([]);
});

async function runtimeService<T>(operation: () => Promise<T>) {
  const client = await pool.connect(), previous = state.db;
  try { await client.query(`SET ROLE "${runtimeRole}"`); state.db = drizzle(client, { schema }); return await operation(); }
  finally { state.db = previous; await client.query("RESET ROLE"); client.release(); }
}

it("captures, declares and recovers a sale with only migration-provisioned runtime privileges", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const result = await runtimeService(() => ingestSalesCut(upload("2026-10-22")));
  const data = declaration(result.rows[0].id);
  const sale = await runtimeService(() => declareSalesCut(ctx, data));
  expect(sale.journal?.status).toBe("POSTED");
  const event = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [data.cutId])).rows[0];
  expect((await runtimeService(() => processAccountingEvent(companyId, event.id))).journal?.id).toBe(sale.journal!.id);
  expect((await runtimeService(() => recordSalesRefund(ctx, { ...amounts, documentId: randomUUID(), originalId: sale.document.id,
    accountingDate: "2026-11-01", documentReference: "REF-RUNTIME", reason: "Devolución runtime documentada" }))).journal?.status).toBe("POSTED");
});

it("rejects a moved pending date, mismatched measured amounts and source capture outside actor scope", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const result = await ingestSalesCut(upload("2026-10-23")), id = result.rows[0].id;
  await pool.query("UPDATE daily_sales_cuts SET business_date='2026-10-24' WHERE id=$1", [id]);
  await expect(declareSalesCut(ctx, declaration(id))).rejects.toMatchObject({ statusCode: 409 });
  await pool.query("UPDATE daily_sales_cuts SET business_date='2026-10-23',cash_sales=11799 WHERE id=$1", [id]);
  await expect(declareSalesCut(ctx, declaration(id))).rejects.toMatchObject({ statusCode: 409 });
  const manager = randomUUID(), hidden = randomUUID();
  await pool.query("INSERT INTO branches (id,company_id,name) VALUES ($1,$2,'Oculta para captura')", [hidden, companyId]);
  await pool.query(`INSERT INTO users (id,email,role,company_id,branch_id,created_at,updated_at)
    VALUES ($1,$2,'SUPERVISOR',$3,$4,now(),now())`, [manager, `${manager}@fixture.invalid`, companyId, hidden]);
  await expect(ingestSalesCut({ ...upload("2026-10-24"), receivedBy: manager })).rejects.toMatchObject({ statusCode: 403 });
  await pool.query("INSERT INTO financial_periods (company_id,year,month,status) VALUES ($1,2026,9,'CLOSED')", [companyId]);
  await expect(ingestSalesCut(upload("2026-09-25"))).rejects.toMatchObject({ statusCode: 409 });
  expect((await pool.query("SELECT id FROM daily_sales_cuts WHERE business_date IN ('2026-10-24','2026-09-25')")).rows).toEqual([]);
});

it("admits disjoint channel partitions and preserves business date across a UTC month boundary", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  for (const channel of ["SALON", "DELIVERY"]) {
    const id = await cut("2026-10-31", channel);
    await pool.query("UPDATE daily_sales_cuts SET received_at='2026-11-01T05:30:00Z' WHERE id=$1", [id]);
    expect((await declareSalesCut(ctx, declaration(id))).journal?.businessDate).toBe("2026-10-31");
  }
  const total = await cut("2026-10-31");
  expect((await declareSalesCut(ctx, declaration(total))).journal).toBeNull();
});

it("rejects a franchise source and a FULL shift overlapping a partial shift", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await cut("2026-10-26");
  await pool.query("UPDATE branches SET ownership_type='FRANCHISE' WHERE id=$1", [branchId]);
  try { await expect(declareSalesCut(ctx, declaration(id))).rejects.toMatchObject({ statusCode: 409 }); }
  finally { await pool.query("UPDATE branches SET ownership_type='OWNED' WHERE id=$1", [branchId]); }
  await cut("2026-10-26", "TOTAL", "MATUTINO");
  expect((await declareSalesCut(ctx, declaration(id))).reason).toContain("solapados");
});

it("matches the independent FC-02 discounted sale exactly and prevents refunding more net revenue than recognized", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const referenceBranch = randomUUID();
  await pool.query("INSERT INTO branches (id,company_id,name) VALUES ($1,$2,'Referencia B')", [referenceBranch, companyId]);
  const expected = month.journals.find(journal => journal.id === "discounted-cash-sale")!;
  const id = await cut(expected.date, "TOTAL", "COMPLETO", 52200, referenceBranch);
  await pool.query("UPDATE daily_sales_cuts SET tax_amount=7200 WHERE id=$1", [id]);
  const declared = { ...declaration(id), totalCents: 52200, cashCents: 52200, revenueCents: 50000,
    discountCents: 5000, taxCents: 7200, tipsCents: 0 };
  const sale = await declareSalesCut(ctx, declared);
  const accountMap: Record<string, string> = { cash: accounts.CASH, revenue: accounts.SALES_REVENUE, outputVat: accounts.SALES_TAX };
  expect((await pool.query(`SELECT account_id,debit_cents::int debit,credit_cents::int credit FROM accounting_journal_lines
    WHERE journal_id=$1 ORDER BY line_number`, [sale.journal!.id])).rows).toEqual(expected.lines.map(line => ({
    account_id: accountMap[line.account], debit: line.debit, credit: line.credit,
  })));
  await expect(recordSalesRefund(ctx, { ...amounts, documentId: randomUUID(), originalId: sale.document.id,
    accountingDate: "2026-11-01", documentReference: "EXCESS-NET", reason: "Intento de exceder ingreso neto",
    totalCents: 45001, cashCents: 45001, revenueCents: 45001, taxCents: 0, tipsCents: 0 })).rejects.toMatchObject({ statusCode: 409 });
  const full = await recordSalesRefund(ctx, { totalCents: 52200, cashCents: 52200, cardCents: 0, platformCents: 0, otherCents: 0,
    revenueCents: 50000, discountCents: 5000, taxCents: 7200, tipsCents: 0, documentId: randomUUID(), originalId: sale.document.id,
    accountingDate: "2026-11-01", documentReference: "REF-DISCOUNT", reason: "Devolución total con descuento documentado" });
  expect(full.journal?.status).toBe("POSTED");
});

it("keeps a refund pending when its rule changes the original account and recovers after an explicit compatible revision", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const sale = await declareSalesCut(ctx, declaration(await cut("2026-10-30")));
  const changed = await createAccount(ctx, { code: "OTHER_TAX", name: "Otra cuenta", kind: "LIABILITY", normalBalance: "CREDIT", validFrom: "2026-01-01" });
  const previous = (await pool.query("SELECT id FROM accounting_rules WHERE event_type='SALE_REFUNDED' ORDER BY version DESC LIMIT 1")).rows[0];
  const revised = await createRule(ctx, { code: "SALE_REFUNDED", name: "Devolución revisada", eventType: "SALE_REFUNDED",
    effectiveFrom: "2026-11-01", supersedesId: previous.id,
    entries: Object.entries(accounts).map(([role, accountId]) => ({ role, accountId: role === "SALES_TAX" ? changed.id : accountId })),
  });
  const refund = await recordSalesRefund(ctx, { ...amounts, documentId: randomUUID(), originalId: sale.document.id,
    accountingDate: "2026-11-03", documentReference: "REF-REVISION", reason: "Devolución con regla revisada" });
  expect(refund.journal).toBeNull(); expect(refund.reason).toContain("original");
  await createRule(ctx, { code: "SALE_REFUNDED", name: "Devolución compatible", eventType: "SALE_REFUNDED",
    effectiveFrom: "2026-11-02", supersedesId: revised.rule.id,
    entries: Object.entries(accounts).map(([role, accountId]) => ({ role, accountId })),
  });
  const event = (await pool.query("SELECT id FROM accounting_events WHERE source_id=$1", [refund.document.id])).rows[0];
  const recovered = await processAccountingEvent(companyId, event.id);
  expect(recovered.journal?.status).toBe("POSTED");
  expect((await pool.query("SELECT id FROM accounting_journal_lines WHERE account_id=$1", [changed.id])).rows).toEqual([]);
});
afterEach(() => vi.unstubAllEnvs());

async function cut(date = "2026-10-01", channel = "TOTAL", shift = "COMPLETO", total = 11800, cutBranchId = branchId) {
  const id = randomUUID();
  await pool.query(`INSERT INTO daily_sales_cuts
    (id,company_id,branch_id,business_date,shift,channel,total_sales,cash_sales,card_sales,other_payments,tax_amount,source,status,received_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$7,0,0,1600,'UPLOAD','VALIDATED',$8)`, [id, companyId, cutBranchId, date, shift, channel, total, actorId]);
  return id;
}

it("keeps documented sales immutable and enforces tenant row security", async () => {
  const cutId = await cut();
  const id = randomUUID();
  await pool.query(`INSERT INTO accounting_sales_documents
    (id,company_id,branch_id,cut_id,kind,business_date,shift,channel,total_cents,cash_cents,card_cents,platform_cents,
      other_cents,revenue_cents,discount_cents,tax_cents,tips_cents,document_reference,reason,created_by)
    VALUES ($1,$2,$3,$4,'SALE','2026-10-01','COMPLETO','TOTAL',11800,11800,0,0,0,10000,0,1600,200,'SYN-1','Declaración sintética',$5)`,
  [id, companyId, branchId, cutId, actorId]);
  await expect(pool.query("UPDATE accounting_sales_documents SET business_date='2026-10-02' WHERE id=$1", [id]))
    .rejects.toMatchObject({ code: "23514" });
  const snapshotClient = await pool.connect();
  try {
    await snapshotClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await expect(snapshotClient.query("INSERT INTO accounting_sales_documents SELECT * FROM accounting_sales_documents WHERE id=$1", [id]))
      .rejects.toMatchObject({ code: "0A000" });
  } finally { await snapshotClient.query("ROLLBACK"); snapshotClient.release(); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [foreignCompany]);
    expect((await client.query("SELECT id FROM accounting_sales_documents WHERE id=$1", [id])).rows).toEqual([]);
    await client.query("SELECT set_config('app.current_company_id',$1,true)", [companyId]);
    expect((await client.query("SELECT id FROM accounting_sales_documents WHERE id=$1", [id])).rows).toEqual([{ id }]);
    await expect(client.query("DELETE FROM accounting_sales_documents WHERE id=$1", [id])).rejects.toMatchObject({ code: "42501" });
  } finally { await client.query("ROLLBACK"); client.release(); }
});

it("freezes the rule actually used even when a revision commits between resolution and posting", async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  const id = await cut("2026-11-03");
  const originalRule = (await pool.query("SELECT id,version FROM accounting_rules WHERE event_type='SALE_RECOGNIZED' ORDER BY version DESC LIMIT 1")).rows[0];
  const changed = await createAccount(ctx, { code: "FROZEN_REVENUE", name: "Cuenta de revisión concurrente",
    kind: "INCOME", normalBalance: "CREDIT", validFrom: "2026-01-01" });
  const resolve = mappingService.resolveRuleIn;
  let revisionId: string | undefined;
  const interleave = vi.spyOn(mappingService, "resolveRuleIn").mockImplementationOnce(async (...args) => {
    const selected = await resolve(...args);
    const revision = await createRule(ctx, { code: "SALE_RECOGNIZED", name: "Revisión concurrente", eventType: "SALE_RECOGNIZED",
      effectiveFrom: "2026-11-03", supersedesId: originalRule.id,
      entries: Object.entries(accounts).map(([role, accountId]) => ({ role, accountId: role === "SALES_REVENUE" ? changed.id : accountId })),
    });
    revisionId = revision.rule.id;
    return selected;
  });
  try {
    const result = await declareSalesCut(ctx, declaration(id));
    expect(revisionId).toEqual(expect.any(String));
    expect(result.journal).toMatchObject({ ruleId: originalRule.id, ruleVersion: originalRule.version });
    expect((await pool.query("SELECT id FROM accounting_journal_lines WHERE journal_id=$1 AND account_id=$2", [result.journal!.id, changed.id])).rows)
      .toEqual([]);
  } finally { interleave.mockRestore(); }
});
