import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { confirmOperatingCfdi } from "@/lib/services/operating-cfdi-confirm";
import { getAccountsPayable } from "@/lib/services/accounts-payable-service";
import { approveOperatingExpense } from "@/lib/services/expense-service";
import { insertPaymentIn } from "@/lib/services/accounting/expense-adapter";
import { cfdiTables, createCfdiFixture, cfdiId as id, fixtureXml as xml } from "../support/operating-cfdi-fixture";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

/**
 * T13 / Control 2 — recorrido completo del emisor mixto.
 *
 * Harina entra como compra de inventario; la luz se captura desde Finanzas sin
 * proveedor de insumos, queda pendiente de aprobación, al aprobarse produce
 * UNA obligación, y el pago se aplica una sola vez.
 *
 * Base PostgreSQL embebida con las migraciones reales 0151/0153. No usa la base
 * operativa ni envía avisos.
 */

vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn(), select: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: { sendBatchNotifications: vi.fn() } }));
vi.mock("@/lib/services/domain-event-service", () => ({ emitDomainEvent: vi.fn() }));
vi.mock("@/lib/services/tenant-config-service", () => ({ getTenantOperatingConfig: async () => ({
  managerAuthLimitCents: 200000, doubleApprovalThresholdCents: 1000000, managerAutonomy: "MEDIA" }) }));

const companyId = id(1), branchId = id(2), payeeId = id(3), supplierId = id(4);
const actorId = "actor", approverId = "approver";
const harinaId = id(50), harinaOrderId = id(51);
const actor = { companyId, userId: actorId, role: "ADMIN" as const };
const input = () => ({ mode: "CREATE" as const, branchId, payeeId, category: "SERVICIOS" as const,
  description: "Luz noviembre" });

/**
 * La CxP y la contabilización leen sus propias tablas. Se crean desde el modelo
 * (sin FKs) para que los servicios reales corran; las restricciones de destino
 * de 0151/0153 las aplica `createCfdiFixture`.
 */
const extraTables = [schema.recurringPayables, schema.recurringContracts, schema.supplierBankAccounts,
  schema.payeeBankAccounts, schema.accountingAccounts,
  schema.accountingSourceLinks, schema.accountingGatewayLinks, schema.accountingRules, schema.accountingRuleEntries,
  schema.accountingJournalLines, schema.accountingEvents, schema.accountingOpenings, schema.accountingCompanySettings,
  schema.accountingPeriodCloses, schema.accountingInventoryValuations, schema.accountingSalesDocuments] as const;

async function createExtraTables() {
  for (const table of extraTables) {
    const config = getTableConfig(table as unknown as PgTable);
    const columns = config.columns.map(column => {
      const raw = column.getSQLType();
      const type = /^(uuid|text|integer|bigint|int|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      return `"${column.name}" ${type}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(",")})`);
  }
}

let pg: PGlite, connection: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite(); connection = drizzle(pg, { schema }); await createCfdiFixture(sql => pg.exec(sql));
  await createExtraTables();
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  vi.mocked(db.update).mockImplementation(connection.update.bind(connection) as typeof db.update);
}, 30000);
afterAll(async () => { await pg?.close(); });

beforeEach(async () => {
  const names = [...cfdiTables, ...extraTables].map(table => `"${getTableConfig(table as unknown as PgTable).name}"`);
  await pg.exec(`truncate ${names.join(",")} cascade`);
  await connection.insert(schema.companies).values({ id: companyId, name: "Empresa", taxId: "BBB010101BBB" });
  await connection.insert(schema.users).values([
    { id: actorId, companyId, email: "actor@fixture.invalid", role: "ADMIN", active: true, createdAt: new Date(), updatedAt: new Date() },
    { id: approverId, companyId, email: "approver@fixture.invalid", role: "ADMIN", active: true, createdAt: new Date(), updatedAt: new Date() },
  ] as never);
  await connection.insert(schema.branches).values({ id: branchId, companyId, name: "Centro" });
  // El mismo emisor que vende harina y presta servicios no necesita ser proveedor de insumos.
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "Insumos y Servicios", taxId: "AAA010101AAA", active: true });
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "Insumos y Servicios", payeeId } as never);
  await connection.insert(schema.purchaseOrders).values({ id: harinaOrderId, companyId, branchId, supplierId,
    poNumber: "OC-1042", status: "APPROVED", total: 58000, requestedBy: actorId } as never);
  await connection.insert(schema.invoices).values({ id: harinaId, companyId, branchId, supplierId,
    purchaseOrderId: harinaOrderId, uuid: "CFDI-HARINA-1042", fecha: "2026-11-02T12:00:00", subtotal: 50000,
    taxAmount: 8000, total: 58000, currency: "MXN", paymentStatus: "PENDING", destination: "INVENTORY_PURCHASE",
    classifiedAt: new Date(), classifiedBy: actorId, classificationReason: "Compra de inventario con orden",
    classificationSource: "CAPTURE", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" } as never);
  vi.mocked(NotificationDispatcher.sendBatchNotifications).mockClear();
});

const payable = () => getAccountsPayable({ companyId });

describe("T13: luz sin proveedor de insumos, harina como compra", () => {
  it("documenta la luz, no la vuelve deuda de compra y la única obligación aparece al aprobar", async () => {
    const confirmado = await confirmOperatingCfdi(actor, xml, input());
    expect(confirmado.outcome).toBe("CREATED");

    const factura = (await connection.select().from(schema.invoices)).find(row => row.id === confirmado.invoiceId)!;
    expect(factura).toMatchObject({ destination: "OPERATING_EXPENSE", supplierId: null, purchaseOrderId: null,
      receivingReportId: null, total: 116001, xmlContent: xml });
    const gasto = (await connection.select().from(schema.operatingExpenses))[0];
    expect(gasto).toMatchObject({ id: confirmado.expenseId, status: "PENDING_APPROVAL", amount: 116001 });

    // Pendiente de aprobación: no es deuda firme y la factura no entra como compra.
    const antes = await payable();
    expect(antes.itemsTotal).toBe(1);
    expect(antes.items.map(item => item.source)).toEqual(["INVOICE"]);
    expect(antes.items[0]).toMatchObject({ id: harinaId, invoiceDestination: "INVENTORY_PURCHASE", amountCents: 58000 });

    await approveOperatingExpense(gasto.id, companyId, { kind: "ALL" }, approverId, "ADMIN");

    const despues = await payable();
    expect(despues.itemsTotal).toBe(2);
    expect(despues.confirmedCents).toBe(58000 + 116001);
    const porOrigen = despues.items.map(item => `${item.source}:${item.amountCents}`).sort();
    expect(porOrigen).toEqual(["INVOICE:58000", "OPERATING_EXPENSE:116001"]);
    // La misma factura operativa no aparece también como obligación de compra.
    expect(despues.items.filter(item => item.source === "INVOICE")).toHaveLength(1);
    expect(despues.items.filter(item => item.id === confirmado.invoiceId)).toHaveLength(0);
  });

  it("el pago se aplica una sola vez y salda gasto y CFDI sin crear deuda de compra", async () => {
    const { expenseId, invoiceId } = await confirmOperatingCfdi(actor, xml, input());
    await approveOperatingExpense(expenseId, companyId, { kind: "ALL" }, approverId, "ADMIN");

    const pago = await db.transaction(tx => insertPaymentIn(tx, companyId, actorId, {
      expenseId, amountCents: 116001, paidAt: "2026-11-16", paymentMethod: "TRANSFERENCIA", source: "MANUAL" }));
    expect(pago.payment).toMatchObject({ expenseId, amountCents: 116001, status: "CONFIRMED" });

    const gasto = (await connection.select().from(schema.operatingExpenses))[0];
    expect(gasto.status).toBe("PAID");
    const factura = (await connection.select().from(schema.invoices)).find(row => row.id === invoiceId)!;
    expect(factura).toMatchObject({ destination: "OPERATING_EXPENSE", paymentStatus: "PAID", xmlContent: xml });

    // Un segundo abono no cabe: el saldo del gasto ya es cero.
    await expect(db.transaction(tx => insertPaymentIn(tx, companyId, actorId, {
      expenseId, amountCents: 116001, paidAt: "2026-11-17", source: "MANUAL" }))).rejects.toThrow(/saldo/i);
    expect(await connection.select().from(schema.expensePayments)).toHaveLength(1);

    const saldo = await payable();
    expect(saldo.itemsTotal).toBe(1);
    expect(saldo.items[0]).toMatchObject({ id: harinaId, source: "INVOICE", amountCents: 58000 });
    expect(saldo.confirmedCents).toBe(58000);
  });

  it("el XML sigue disponible después del pago y el gasto conserva el vínculo", async () => {
    const { expenseId, invoiceId } = await confirmOperatingCfdi(actor, xml, input());
    await approveOperatingExpense(expenseId, companyId, { kind: "ALL" }, approverId, "ADMIN");
    await db.transaction(tx => insertPaymentIn(tx, companyId, actorId, {
      expenseId, amountCents: 116001, paidAt: "2026-11-16", source: "MANUAL" }));

    const factura = (await connection.select().from(schema.invoices)).find(row => row.id === invoiceId)!;
    expect(factura.xmlContent).toBe(xml);
    expect((await connection.select().from(schema.operatingExpenses))[0]).toMatchObject({ id: expenseId, invoiceId });
    // Sin proveedor de insumos: no se creó ni se enlazó un proveedor de inventario.
    expect(await connection.select().from(schema.suppliers)).toHaveLength(1);
    expect((await connection.select().from(schema.accountingJournals))).toHaveLength(0);
  });
});
