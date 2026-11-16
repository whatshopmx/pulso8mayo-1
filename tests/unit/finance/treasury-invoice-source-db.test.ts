import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { TreasuryService } from "@/lib/services/treasury-service";
import { serviceInvoiceBlocker } from "@/lib/services/expense-invoice-evidence";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), transaction: vi.fn(), query: {} } }));
vi.mock("@/lib/db/tenant-context", () => ({ setTenantContext: vi.fn(),
  withCompanyContext: (_scope: unknown, work: Parameters<typeof db.transaction>[0]) => db.transaction(work) }));
const config = vi.hoisted(() => ({ threshold: 999999999 }));
vi.mock("@/lib/services/tenant-config-service", () => ({
  getTenantOperatingConfig: async () => ({ doubleApprovalThresholdCents: config.threshold }) }));
vi.mock("@/lib/services/supplier-bank-account-service", () => ({
  getBankAccountsForPayment: async () => ({ porProveedor: new Map(), porId: new Map() }) }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), branchId = id(2), payeeId = id(3), supplierId = id(4);
const invoiceId = id(5), expenseId = id(6), runId = id(7), itemId = id(8);
const tables = [schema.invoices, schema.operatingExpenses, schema.suppliers, schema.payees,
  schema.supplierBankAccounts, schema.payeeBankAccounts, schema.paymentRuns, schema.paymentRunItems,
  schema.expensePayments, schema.accountingPurchaseFacts, schema.accountingEvents,
  schema.accountingJournals, schema.financialPeriods, schema.accountingOpenings, schema.accountingCompanySettings,
  schema.accountingRules, schema.paymentApprovals];
let pg: PGlite;
let connection: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite(); connection = drizzle(pg, { schema });
  // SQL PostgreSQL descartable; sin FKs/defaults generales ni conexiones externas.
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.map(c => {
      const raw = c.getSQLType();
      const type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      return `"${c.name}" ${type}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(", ")})`);
  }
  await pg.exec(`alter table accounting_events alter column source_version set default 1;
    alter table accounting_events alter column status set default 'PENDING';
    create unique index event_source on accounting_events (company_id,source_type,source_id,event_type,source_version)`);
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
  Object.assign(db.query, connection.query);
}, 30000);
afterAll(async () => { await pg?.close(); });
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  config.threshold = 999999999;
  vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "0");
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "Proveedor mixto", payeeId });
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "Servicios", active: true });
  await connection.insert(schema.supplierBankAccounts).values({ id: id(9), companyId, supplierId,
    active: true, status: "VERIFIED", clabeLast4: "1234" } as never);
  await connection.insert(schema.invoices).values({ id: invoiceId, companyId, branchId, supplierId,
    destination: "UNCLASSIFIED", subtotal: 100001, taxAmount: 16000, total: 116001, paymentStatus: "PENDING", matchStatus: "MATCHED",
    currency: "MXN", uuid: "UUID", fecha: "2026-11-16" } as never);
  await connection.insert(schema.operatingExpenses).values({ id: expenseId, companyId, branchId, payeeId,
    amount: 116001, taxAmount: 16000, status: "APPROVED" } as never);
  await connection.insert(schema.paymentRuns).values({ id: runId, companyId, status: "PROCESSING",
    preparedBy: "preparer", title: "Servicios", totalAmountCents: 116001 } as never);
  await connection.insert(schema.paymentRunItems).values({ id: itemId, paymentRunId: runId,
    itemType: "INVOICE", referenceId: invoiceId, amountCents: 116001, settlementStatus: "PENDING" } as never);
});

const confirm = () => TreasuryService.settlePaymentRunItem({ companyId, paymentRunId: runId, itemId,
  settlementStatus: "CONFIRMED", actorRole: "ADMIN", userId: "actor", reference: "SPEI-1" });
const source = () => TreasuryService.assertCounterpartyPayable({ companyId, itemType: "INVOICE", referenceId: invoiceId });
async function operational(link = false) {
  await pg.exec(`update invoices set destination='OPERATING_EXPENSE', payee_id='${payeeId}'`);
  if (link) await pg.exec(`update operating_expenses set invoice_id='${invoiceId}'`);
}

describe("T04: fuente única de pago en tesorería con SQL real", () => {
  it("no ofrece un CFDI operativo huérfano como compra", async () => {
    await pg.exec("delete from payment_run_items"); await operational();
    expect(await TreasuryService.getUnpaidMatchedInvoices(companyId)).toHaveLength(0);
  });
  it("rechaza programar un CFDI operativo sin gasto", async () => {
    await operational(); await expect(source()).rejects.toThrow(/gasto operativo/i);
  });
  it.each(["0", "1"])("revierte liquidación si cambió a gasto, bandera contable %s", async flag => {
    await operational(true); vi.stubEnv("ACCOUNTING_POSTING_ENABLED", flag);
    await expect(confirm()).rejects.toThrow(/gasto operativo/i);
    const [item] = await connection.select().from(schema.paymentRunItems);
    const [invoice] = await connection.select().from(schema.invoices);
    expect(item.settlementStatus).toBe("PENDING"); expect(invoice.paymentStatus).toBe("PENDING");
    expect(await connection.select().from(schema.expensePayments)).toHaveLength(0);
  });
  it("bloquea una asociación histórica aunque no cambie destino", async () => {
    await pg.exec(`update operating_expenses set invoice_id='${invoiceId}'`);
    await expect(confirm()).rejects.toThrow(/gasto operativo/i);
  });
  it.each(["PENDING_APPROVAL", "APPROVED", "PROCESSING"] as const)("revalida antes de pasar a %s", async next => {
    const previous = { PENDING_APPROVAL: "DRAFT", APPROVED: "PENDING_APPROVAL", PROCESSING: "APPROVED" }[next];
    await pg.exec(`update payment_runs set status='${previous}'`); await operational();
    await expect(TreasuryService.updatePaymentRunStatus(runId, companyId, next, "actor", "ADMIN"))
      .rejects.toThrow(/gasto operativo/i);
    expect((await connection.select().from(schema.paymentRuns))[0].status).toBe(previous);
  });
  it("revalida una partida antigua al descargar layout", async () => {
    await operational();
    await expect(TreasuryService.generateBankDisbursementLayout(runId, companyId, "ADMIN"))
      .rejects.toThrow(/gasto operativo/i);
  });
  it("no registra la primera firma si cambió la fuente", async () => {
    config.threshold = 1;
    await pg.exec("update payment_runs set status='PENDING_APPROVAL'"); await operational();
    await expect(TreasuryService.updatePaymentRunStatus(runId, companyId, "APPROVED", "actor", "ADMIN"))
      .rejects.toThrow(/gasto operativo/i);
    expect(await connection.select().from(schema.paymentApprovals)).toHaveLength(0);
  });
  it("conserva la primera firma válida sin aprobar todavía la corrida", async () => {
    config.threshold = 1;
    await pg.exec("update payment_runs set status='PENDING_APPROVAL'");
    await expect(TreasuryService.updatePaymentRunStatus(runId, companyId, "APPROVED", "actor", "ADMIN"))
      .rejects.toThrow(/Primera firma registrada/);
    expect((await connection.select().from(schema.paymentApprovals))[0].approvedBy).toBe("actor");
    expect((await connection.select().from(schema.paymentRuns))[0].status).toBe("PENDING_APPROVAL");
  });
  it("revalida confirmaciones antiguas al cerrar, sin reescribirlas", async () => {
    await operational(); await pg.exec("update payment_run_items set settlement_status='CONFIRMED'");
    await expect(TreasuryService.updatePaymentRunStatus(runId, companyId, "COMPLETED", "actor", "ADMIN"))
      .rejects.toThrow(/gasto operativo/i);
    expect((await connection.select().from(schema.paymentRuns))[0].status).toBe("PROCESSING");
    expect((await connection.select().from(schema.invoices))[0].paymentStatus).toBe("PENDING");
  });
  it.each(["UNCLASSIFIED", "INVENTORY_PURCHASE"])("conserva pago y doble intento idempotente de %s", async destination => {
    await pg.exec(`update invoices set destination='${destination}'`);
    expect((await confirm()).accion).toBe("CONFIRMAR");
    expect((await confirm()).accion).toBe("SIN_CAMBIO");
    expect((await connection.select().from(schema.invoices))[0].paymentStatus).toBe("PAID");
    await TreasuryService.updatePaymentRunStatus(runId, companyId, "COMPLETED", "actor", "ADMIN");
  });
  it("acepta evidencia operativa con payee directo sin proveedor", async () => {
    await operational(true); await pg.exec("update invoices set supplier_id=null");
    const [expense] = await connection.select().from(schema.operatingExpenses);
    expect(await serviceInvoiceBlocker(connection as never, companyId, expense)).toBeNull();
  });
  it.each([
    "destination='INVENTORY_PURCHASE'", "currency='USD'", `payee_id='${id(33)}'`,
  ])("bloquea evidencia incompatible %s", async change => {
    await pg.exec(`update operating_expenses set invoice_id='${invoiceId}'; update invoices set ${change}`);
    const [expense] = await connection.select().from(schema.operatingExpenses);
    expect(await serviceInvoiceBlocker(connection as never, companyId, expense)).not.toBeNull();
  });
  it.each(["0", "1"])("revalida el comprobante del gasto al liquidar, bandera %s", async flag => {
    await operational(true); vi.stubEnv("ACCOUNTING_POSTING_ENABLED", flag);
    await pg.exec(`update payment_run_items set item_type='OPERATING_EXPENSE', reference_id='${expenseId}';
      update invoices set currency='USD'`);
    await expect(confirm()).rejects.toThrow(/MXN/);
    expect((await connection.select().from(schema.paymentRunItems))[0].settlementStatus).toBe("PENDING");
    expect((await connection.select().from(schema.operatingExpenses))[0].status).toBe("APPROVED");
  });
  it("un abono parcial operativo conserva el saldo; completar y reintentar no duplica", async () => {
    await operational(true); vi.stubEnv("ACCOUNTING_POSTING_ENABLED", "1");
    await pg.exec(`update invoices set supplier_id=null;
      update payment_run_items set item_type='OPERATING_EXPENSE', reference_id='${expenseId}', amount_cents=16001`);
    await connection.insert(schema.expensePayments).values([
      { id: id(50), companyId, branchId, expenseId, amountCents: 16001, status: "PENDING", source: "TREASURY", paymentRunItemId: itemId },
      { id: id(51), companyId, branchId, expenseId, amountCents: 100000, status: "FAILED", source: "MANUAL" },
    ] as never);
    await confirm(); await confirm();
    expect((await connection.select().from(schema.operatingExpenses))[0].status).toBe("APPROVED");
    expect((await connection.select().from(schema.invoices))[0].paymentStatus).toBe("PENDING");
    expect((await connection.select().from(schema.expensePayments)).filter(p => p.status === "CONFIRMED")).toHaveLength(1);
    await connection.insert(schema.paymentRunItems).values({ id: id(52), paymentRunId: runId,
      itemType: "OPERATING_EXPENSE", referenceId: expenseId, amountCents: 100000, settlementStatus: "PENDING" } as never);
    await connection.insert(schema.expensePayments).values({ id: id(53), companyId, branchId, expenseId,
      amountCents: 100000, status: "PENDING", source: "TREASURY", paymentRunItemId: id(52) } as never);
    await TreasuryService.settlePaymentRunItem({ companyId, paymentRunId: runId, itemId: id(52),
      settlementStatus: "CONFIRMED", actorRole: "ADMIN", userId: "actor", reference: "SPEI-2" });
    expect((await connection.select().from(schema.operatingExpenses))[0].status).toBe("PAID");
    expect((await connection.select().from(schema.invoices))[0].paymentStatus).toBe("PAID");
    await TreasuryService.updatePaymentRunStatus(runId, companyId, "COMPLETED", "actor", "ADMIN");
  });
  it.each(["payment_status='PAID'", "sat_status='CANCELADO'", `company_id='${id(99)}'`])("rechaza liquidar compra incompatible %s", async change => {
    await pg.exec(`update invoices set ${change}`);
    await expect(confirm()).rejects.toThrow();
    expect((await connection.select().from(schema.paymentRunItems))[0].settlementStatus).toBe("PENDING");
  });
  it("permite registrar el rechazo bancario aunque la fuente requiera revisión", async () => {
    await operational();
    await TreasuryService.settlePaymentRunItem({ companyId, paymentRunId: runId, itemId,
      settlementStatus: "FAILED", actorRole: "ADMIN", userId: "actor", failureReason: "Devuelto por el banco" });
    expect((await connection.select().from(schema.paymentRunItems))[0].settlementStatus).toBe("FAILED");
    expect((await connection.select().from(schema.invoices))[0].paymentStatus).toBe("PENDING");
  });
});
