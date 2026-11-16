import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { SQL, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { confirmPaymentIn, ensureRecognitionIn, insertPaymentIn, postPaymentIn } from "@/lib/services/accounting/expense-adapter";
import { capturePurchaseReceiptIn, declarePurchase, postPurchaseEventIn,
  remainingInvoiceCentsIn } from "@/lib/services/accounting/purchase-adapter";

vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("@/lib/db/tenant-context", () => ({
  withCompanyContext: (_scope: unknown, work: Parameters<typeof db.transaction>[0]) => db.transaction(work),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), branchId = id(2), supplierId = id(3), payeeId = id(4);
const invoiceId = id(5), expenseId = id(6), reportId = id(7), actorId = "actor";
const ctx = { companyId, actorId, role: "OWNER" as const };
const tables = [schema.invoices, schema.operatingExpenses, schema.suppliers, schema.payees,
  schema.users, schema.branches, schema.receivingReports, schema.paymentRuns, schema.paymentRunItems,
  schema.expensePayments, schema.accountingAccounts, schema.accountingRules, schema.accountingRuleEntries,
  schema.accountingJournals, schema.accountingJournalLines, schema.accountingEvents, schema.accountingPurchaseFacts,
  schema.financialPeriods, schema.accountingOpenings, schema.accountingCompanySettings];
let pg: PGlite;
let connection: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite(); connection = drizzle(pg, { schema });
  const dialect = new PgDialect();
  // Tablas descartables con columnas/defaults reales. No reproduce FKs, RLS
  // ni triggers; ejercita servicios, planes, publicación y transacciones SQL.
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.map(c => {
      const raw = c.getSQLType();
      const type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      const value = c.default;
      const fallback = value instanceof SQL ? dialect.sqlToQuery(value).sql
        : typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value);
      return `"${c.name}" ${type}${value === undefined ? "" : ` default ${fallback}`}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(", ")})`);
  }
  await pg.exec(`create unique index event_identity on accounting_events (company_id,source_type,source_id,event_type,source_version);
    create unique index fact_identity on accounting_purchase_facts (event_id);
    create unique index journal_identity on accounting_journals (company_id,source_type,source_id,event_type,source_version)`);
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
}, 30000);
afterAll(async () => { await pg?.close(); });
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.users).values({ id: actorId, companyId, role: "OWNER", active: true } as never);
  await connection.insert(schema.branches).values({ id: branchId, companyId, name: "Centro", ownershipType: "OWNED", active: true } as never);
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "Emisor mixto", payeeId });
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "Servicios", active: true });
  await connection.insert(schema.invoices).values({ id: invoiceId, companyId, branchId, supplierId: null,
    payeeId, destination: "OPERATING_EXPENSE", subtotal: 10000, taxAmount: 1600, total: 11600,
    uuid: "UUID-SYN", fecha: "2026-11-16", currency: "MXN", paymentStatus: "PENDING", matchStatus: "MATCHED" } as never);
  await connection.insert(schema.operatingExpenses).values({ id: expenseId, companyId, branchId, payeeId,
    invoiceId, amount: 11600, taxAmount: 1600, status: "APPROVED", approvedBy: actorId,
    description: "Mantenimiento", category: "SERVICIOS", businessDate: "2026-11-16" } as never);
  await connection.insert(schema.receivingReports).values({ id: reportId, companyId, branchId, supplierId } as never);
  const accountKinds = ["EXPENSE", "LIABILITY", "ASSET", "ASSET", "LIABILITY", "EXPENSE"] as const;
  for (let n = 0; n < accountKinds.length; n++) {
    await connection.insert(schema.accountingAccounts).values({ id: id(20 + n), companyId, code: `A${n}`,
      name: `Cuenta ${n}`, kind: accountKinds[n], normalBalance: accountKinds[n] === "LIABILITY" ? "CREDIT" : "DEBIT",
      validFrom: "2026-01-01", createdBy: actorId, updatedBy: actorId });
  }
  const rules = [
    ["EXPENSE_RECOGNIZED", [["EXPENSE", 20], ["PAYABLE", 21], ["RECOVERABLE_TAX", 22]]],
    ["PURCHASE_RECEIVED", [["INVENTORY", 23], ["RECEIVING_PENDING", 24]]],
    ["PURCHASE_INVOICED", [["RECEIVING_PENDING", 24], ["RECOVERABLE_TAX", 22], ["PAYABLE", 21], ["PURCHASE_VARIANCE", 25]]],
  ] as const;
  for (const [index, [eventType, entries]] of rules.entries()) {
    const ruleId = id(30 + index);
    await connection.insert(schema.accountingRules).values({ id: ruleId, companyId, code: eventType,
      name: eventType, eventType, version: 1, effectiveFrom: "2026-01-01", createdBy: actorId, updatedBy: actorId });
    for (const [role, account] of entries) await connection.insert(schema.accountingRuleEntries).values({
      companyId, ruleId, role, accountId: id(account), required: true } as never);
  }
});

const recognize = async () => {
  const [expense] = await connection.select().from(schema.operatingExpenses).where(eq(schema.operatingExpenses.id, expenseId));
  return connection.transaction(tx => ensureRecognitionIn(tx as never, companyId, actorId, expense));
};
const declareInvoice = () => declarePurchase(ctx, { sourceType: "PURCHASE_INVOICE", sourceId: invoiceId,
  accountingDate: "2026-11-16", documentReference: "SYN", reason: "Declaración sintética revisada" });
async function purchaseInvoice() {
  await pg.exec(`update operating_expenses set invoice_id=null;
    update invoices set destination='INVENTORY_PURCHASE', supplier_id='${supplierId}', receiving_report_id='${reportId}'`);
  return connection.transaction(tx => capturePurchaseReceiptIn(tx as never, { companyId, actorId,
    receivingReportId: reportId, accountingDate: "2026-11-16", documentReference: "SYN-REC",
    lines: [{ itemId: id(80), quantity: "1", unitCostCents: 10000, basis: "DOCUMENT", accepted: true }] }));
}
async function journals() { return connection.select().from(schema.accountingJournals); }

describe("T05: CFDI y una sola fuente de reconocimiento contable", () => {
  it("reconoce el gasto con IVA una sola vez por contraparte directa", async () => {
    const first = await recognize(), again = await recognize();
    expect(first.reason).toBeNull(); expect(again.journal?.id).toBe(first.journal?.id);
    expect(await journals()).toHaveLength(1);
    const lines = await connection.select().from(schema.accountingJournalLines);
    expect(lines.reduce((sum, l) => sum + l.debitCents, 0)).toBe(11600);
    expect(lines.find(l => l.accountId === id(20))?.debitCents).toBe(10000);
    expect(lines.find(l => l.accountId === id(22))?.debitCents).toBe(1600);
    expect(lines.find(l => l.accountId === id(21))?.creditCents).toBe(11600);
  });
  it("rechaza declarar el CFDI operativo como compra incluso huérfano", async () => {
    await pg.exec("update operating_expenses set invoice_id=null");
    await expect(declareInvoice()).rejects.toThrow(/gasto operativo/i);
    expect(await journals()).toHaveLength(0);
    expect(await connection.select().from(schema.accountingPurchaseFacts)).toHaveLength(0);
  });
  it("rechaza saldo/pago contable como compra de un CFDI operativo", async () => {
    await pg.exec("update operating_expenses set invoice_id=null");
    await expect(connection.transaction(tx => remainingInvoiceCentsIn(tx as never, companyId, invoiceId)))
      .rejects.toThrow(/gasto operativo/i);
  });
  it.each(["tax_amount=1000", "subtotal=9900"])("no reconoce importes fiscales incompatibles %s", async change => {
    await pg.exec(`update invoices set ${change}`);
    expect((await recognize()).reason).toMatch(/impuesto|importes/i);
    expect(await journals()).toHaveLength(0);
  });
  it("no reconoce otra vez una factura ya contabilizada como compra", async () => {
    await purchaseInvoice(); await declareInvoice();
    await pg.exec(`update invoices set destination='OPERATING_EXPENSE', supplier_id=null, receiving_report_id=null;
      update operating_expenses set invoice_id='${invoiceId}'`);
    expect((await recognize()).reason).toMatch(/compra|revisión/i);
    expect(await journals()).toHaveLength(2);
  });
  it("no permite dos gastos históricos contabilizados para el mismo CFDI", async () => {
    await pg.exec("update invoices set destination='UNCLASSIFIED'");
    await recognize();
    await connection.insert(schema.operatingExpenses).values({ id: id(60), companyId, branchId, payeeId,
      invoiceId, amount: 11600, taxAmount: 1600, status: "APPROVED", approvedBy: actorId,
      description: "Duplicado histórico", category: "SERVICIOS", businessDate: "2026-11-16" } as never);
    const [other] = await connection.select().from(schema.operatingExpenses).where(eq(schema.operatingExpenses.id, id(60)));
    const result = await connection.transaction(tx => ensureRecognitionIn(tx as never, companyId, actorId, other));
    expect(result.reason).toMatch(/otro gasto|duplicad/i); expect(await journals()).toHaveLength(1);
  });
  it("conserva compra/recepción y pólizas existentes al reintentar tras reclasificar", async () => {
    await purchaseInvoice(); await declareInvoice();
    const before = await journals(); expect(before).toHaveLength(2);
    await pg.exec("update invoices set destination='OPERATING_EXPENSE'");
    const [event] = (await connection.select().from(schema.accountingEvents)).filter(e => e.sourceType === "PURCHASE_INVOICE");
    await connection.transaction(tx => postPurchaseEventIn(tx as never, event));
    expect(await journals()).toEqual(before);
    const lines = await connection.select().from(schema.accountingJournalLines);
    expect(lines.filter(l => l.accountId === id(20))).toHaveLength(0); // compra no reconoce consumo/costo de ventas
  });
  it("un hecho pendiente de compra no publica después de cambiar a operativo", async () => {
    await purchaseInvoice();
    await pg.exec("update accounting_rules set active=false where event_type='PURCHASE_INVOICED'");
    await declareInvoice();
    await pg.exec("update invoices set destination='OPERATING_EXPENSE'; update accounting_rules set active=true");
    const [event] = (await connection.select().from(schema.accountingEvents)).filter(e => e.sourceType === "PURCHASE_INVOICE");
    const result = await connection.transaction(tx => postPurchaseEventIn(tx as never, event));
    expect(result.reason).toMatch(/gasto operativo/i); expect(await journals()).toHaveLength(1);
  });
  it("preserva la póliza del gasto, pero bloquea otro pago contable si el CFDI pasa a compra", async () => {
    await recognize(); const before = await journals();
    await pg.exec("update invoices set destination='INVENTORY_PURCHASE'");
    const [payment] = await connection.insert(schema.expensePayments).values({ id: id(70), companyId, branchId,
      expenseId, amountCents: 11600, paidAt: "2026-11-17", source: "MANUAL", status: "CONFIRMED", createdBy: actorId }).returning();
    const result = await connection.transaction(tx => postPaymentIn(tx as never, companyId, actorId, payment));
    expect(result.reason).toMatch(/compra de inventario/i);
    expect(await journals()).toEqual(before);
  });
  it.each([true, false])("gasto sin CFDI con impuesto cero, documentado=%s", async documented => {
    await pg.exec(`update operating_expenses set invoice_id=null, tax_amount=0,
      evidence_url=${documented ? "'https://fixture.invalid/ticket'" : "null"}`);
    expect((await recognize()).reason).toBeNull(); expect(await journals()).toHaveLength(1);
  });
  it("respeta periodo cerrado sin crear póliza", async () => {
    await connection.insert(schema.financialPeriods).values({ id: id(71), companyId, year: 2026, month: 11, status: "CLOSED" } as never);
    expect((await recognize()).reason).toMatch(/cerrado/i); expect(await journals()).toHaveLength(0);
  });
  it("acepta CFDI operativo con impuesto cero explícito", async () => {
    await pg.exec("update invoices set subtotal=11600,tax_amount=0; update operating_expenses set tax_amount=0");
    expect((await recognize()).reason).toBeNull(); expect(await journals()).toHaveLength(1);
  });
  it.each(["null", "-1", "11600"])("rechaza impuesto de gasto no soportado %s", async tax => {
    await pg.exec(`update operating_expenses set tax_amount=${tax}`);
    expect((await recognize()).reason).toMatch(/impuesto/i); expect(await journals()).toHaveLength(0);
  });
  it("mantiene el tratamiento fiscal de una asociación histórica sin clasificar", async () => {
    await pg.exec(`update invoices set destination='UNCLASSIFIED',supplier_id='${supplierId}',payee_id=null,tax_amount=1000`);
    expect((await recognize()).reason).toBeNull(); expect(await journals()).toHaveLength(1);
  });
  it("bloquea actividad de compra pendiente antes de reconocer el gasto", async () => {
    await purchaseInvoice();
    await pg.exec("update accounting_rules set active=false where event_type='PURCHASE_INVOICED'");
    await declareInvoice();
    await pg.exec(`update invoices set destination='OPERATING_EXPENSE',supplier_id=null,receiving_report_id=null;
      update operating_expenses set invoice_id='${invoiceId}'`);
    expect((await recognize()).reason).toMatch(/actividad contable de compra/i);
    expect(await journals()).toHaveLength(1);
  });
  it("no toma actividad contable de otra empresa como bloqueo propio", async () => {
    await connection.insert(schema.operatingExpenses).values({ id: id(60), companyId, branchId, payeeId,
      invoiceId, amount: 11600, taxAmount: 1600, status: "APPROVED" } as never);
    await connection.insert(schema.accountingJournals).values({ companyId: id(90), accountingDate: "2026-11-16",
      description: "Ajena", sourceType: "OPERATING_EXPENSE", sourceId: id(60), eventType: "EXPENSE_RECOGNIZED",
      sourceVersion: 1, status: "POSTED", createdBy: actorId, updatedBy: actorId } as never);
    expect((await recognize()).reason).toBeNull(); expect(await journals()).toHaveLength(2);
  });
  it("no revela ni reconoce un CFDI de otra empresa", async () => {
    await pg.exec(`update invoices set company_id='${id(90)}'`);
    expect((await recognize()).reason).toMatch(/no corresponde/i); expect(await journals()).toHaveLength(0);
  });
  it("reintentar un gasto ya publicado tras cerrar el periodo conserva la póliza", async () => {
    await recognize(); const before = await journals();
    await connection.insert(schema.financialPeriods).values({ id: id(71), companyId, year: 2026, month: 11, status: "CLOSED" } as never);
    expect((await recognize()).journal?.id).toBe(before[0].id);
    expect(await journals()).toEqual(before);
  });
  it("rechaza un pago manual nuevo con fuente incompatible antes de escribir el abono", async () => {
    await pg.exec("update invoices set destination='INVENTORY_PURCHASE'");
    await expect(connection.transaction(tx => insertPaymentIn(tx as never, companyId, actorId, {
      paymentId: id(75), expenseId, amountCents: 11600, paidAt: "2026-11-17", source: "MANUAL",
    }))).rejects.toThrow(/compra de inventario/i);
    expect(await connection.select().from(schema.expensePayments)).toHaveLength(0);
    expect(await journals()).toHaveLength(0);
  });
  it("rechaza confirmar un abono anterior si cambió la fuente, conservando el pendiente", async () => {
    await connection.insert(schema.expensePayments).values({ id: id(75), companyId, branchId,
      expenseId, amountCents: 11600, paidAt: "2026-11-17", source: "TREASURY", status: "PENDING", createdBy: actorId });
    await pg.exec("update invoices set destination='INVENTORY_PURCHASE'");
    await expect(connection.transaction(tx => confirmPaymentIn(tx as never, companyId, actorId, {
      paymentId: id(75), paidAt: "2026-11-17", reference: "SYN-SPEI",
    }))).rejects.toThrow(/compra de inventario/i);
    expect((await connection.select().from(schema.expensePayments))[0].status).toBe("PENDING");
    expect(await journals()).toHaveLength(0);
  });
});
