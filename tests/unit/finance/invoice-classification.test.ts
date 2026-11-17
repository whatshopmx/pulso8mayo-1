import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { db } from "@/lib/db";
import { backfillInvoiceClassification, classifyHistoricalInvoice, getInvoiceClassificationReport,
  type HistoricalInvoiceRow } from "@/lib/services/invoice-classification-service";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() } }));
/** Permite simular un cambio externo entre el reporte y la transacción de escritura. */
const hooks = vi.hoisted(() => ({ beforeTransaction: null as null | (() => Promise<void>) }));
vi.mock("@/lib/db/tenant-context", () => ({
  withCompanyContext: async (_ctx: unknown, work: Parameters<typeof db.transaction>[0]) => {
    const pending = hooks.beforeTransaction;
    hooks.beforeTransaction = null;
    if (pending) await pending();
    return db.transaction(work);
  },
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), otherCompanyId = id(2), branchId = id(3), otherBranchId = id(4);
const supplierId = id(5), payeeId = id(6), userId = id(7), otherSupplierId = id(8);
const tables = [schema.invoices, schema.operatingExpenses, schema.suppliers, schema.users, schema.payees];

let pg: PGlite;
let connection: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  connection = drizzle(pg);
  for (const table of tables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.map(column => {
      const raw = column.getSQLType();
      const type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      return `"${column.name}" ${type}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(", ")})`);
    await pg.exec(`alter table "${config.name}" alter column "id" set default gen_random_uuid()`);
    await pg.exec(`alter table "${config.name}" alter column "created_at" set default now()`);
  }
  await pg.exec("alter table invoices alter column destination set default 'UNCLASSIFIED'");
  await pg.exec("alter table invoices alter column currency set default 'MXN'");
  await pg.exec("alter table invoices alter column payment_status set default 'PENDING'");
  vi.mocked(db.select).mockImplementation(connection.select.bind(connection) as typeof db.select);
  vi.mocked(db.transaction).mockImplementation(connection.transaction.bind(connection) as typeof db.transaction);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  for (const table of tables) await pg.exec(`delete from "${getTableConfig(table as PgTable).name}"`);
  await connection.insert(schema.users).values({ id: userId, companyId, name: "Clasificador" } as never);
  await connection.insert(schema.payees).values({ id: payeeId, companyId, name: "Proveedor de servicios", active: true } as never);
  await connection.insert(schema.suppliers).values({ id: supplierId, companyId, name: "Harina", payeeId } as never);
  await connection.insert(schema.suppliers).values({ id: otherSupplierId, companyId: otherCompanyId, name: "Ajeno" } as never);
});

function row(overrides: Partial<HistoricalInvoiceRow> = {}): HistoricalInvoiceRow {
  return {
    id: id(50), uuid: "UUID-1", fecha: "2026-11-01", total: 116000, currency: "MXN",
    destination: "UNCLASSIFIED", branchId, supplierId: null, payeeId: null,
    purchaseOrderId: null, receivingReportId: null, recurringContractId: null, serviceOrderId: null,
    paymentStatus: "PENDING", supplierCompanyId: null, supplierPayeeId: null,
    expenseCount: 0, expensePayeeId: null, expenseBranchId: null, expenseAmount: null,
    ...overrides,
  };
}

describe("T12: la clasificación histórica no infiere destinos", () => {
  it("propone gasto operativo solo con gasto vigente, coherente y en MXN", () => {
    const decision = classifyHistoricalInvoice(row({
      expenseCount: 1, expensePayeeId: payeeId, expenseBranchId: branchId, expenseAmount: 116000,
    }), companyId);
    expect(decision).toMatchObject({ outcome: "PROPOSAL", proposedDestination: "OPERATING_EXPENSE", payeeId });
  });
  it("propone compra solo con orden de compra o recepción", () => {
    expect(classifyHistoricalInvoice(row({ purchaseOrderId: id(60) }), companyId))
      .toMatchObject({ outcome: "PROPOSAL", proposedDestination: "INVENTORY_PURCHASE" });
    expect(classifyHistoricalInvoice(row({ receivingReportId: id(61) }), companyId))
      .toMatchObject({ outcome: "PROPOSAL", proposedDestination: "INVENTORY_PURCHASE" });
  });
  it("deja sin clasificar el documento que no tiene evidencia", () => {
    expect(classifyHistoricalInvoice(row(), companyId)).toMatchObject({ outcome: "PENDING", proposedDestination: "UNCLASSIFIED" });
  });
  it.each([
    ["gasto y OC", { expenseCount: 1, purchaseOrderId: id(60) }, "contradictorias"],
    ["varios gastos", { expenseCount: 2 }, "ambigua"],
    ["moneda distinta", { expenseCount: 1, expensePayeeId: payeeId, expenseBranchId: branchId, expenseAmount: 116000,
      currency: "USD" }, "Moneda no soportada"],
    ["importe distinto", { expenseCount: 1, expensePayeeId: payeeId, expenseBranchId: branchId,
      expenseAmount: 100000 }, "importe del gasto"],
    ["sucursal distinta", { expenseCount: 1, expensePayeeId: payeeId, expenseBranchId: otherBranchId }, "sucursales distintas"],
    ["sin contraparte", { expenseCount: 1, expenseBranchId: branchId, expenseAmount: 116000 }, "contraparte directa"],
    ["contrato recurrente", { recurringContractId: id(62) }, "Contrato recurrente"],
    ["orden de servicio", { serviceOrderId: id(63) }, "orden de servicio"],
    ["proveedor ajeno", { expenseCount: 1, expensePayeeId: payeeId, expenseBranchId: branchId, expenseAmount: 116000,
      supplierId: otherSupplierId, supplierCompanyId: otherCompanyId }, "otra empresa"],
  ])("reporta conflicto en %s", (_caso, overrides, expected) => {
    const decision = classifyHistoricalInvoice(row(overrides as Partial<HistoricalInvoiceRow>), companyId);
    expect(decision.outcome).toBe("CONFLICT");
    expect(decision.proposedDestination).toBe("UNCLASSIFIED");
    expect(decision.conflict).toContain(expected);
  });
  it("no vuelve a proponer un documento ya clasificado", () => {
    expect(classifyHistoricalInvoice(row({ destination: "INVENTORY_PURCHASE" }), companyId))
      .toMatchObject({ outcome: "ALREADY_CLASSIFIED" });
  });
});

async function sembrar() {
  await connection.insert(schema.invoices).values([
    { id: id(70), companyId, branchId, supplierId, destination: "UNCLASSIFIED", uuid: "UUID-GASTO", fecha: "2026-11-01",
      subtotal: 100000, total: 116000, currency: "MXN", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    { id: id(71), companyId, branchId, supplierId, purchaseOrderId: id(72), destination: "UNCLASSIFIED", uuid: "UUID-COMPRA",
      fecha: "2026-11-02", subtotal: 50000, total: 58000, currency: "MXN", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    { id: id(73), companyId, branchId, supplierId, destination: "UNCLASSIFIED", uuid: "UUID-SIN-INDICIO",
      fecha: "2026-11-03", subtotal: 20000, total: 23200, currency: "MXN", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
    { id: id(74), companyId, branchId, supplierId, destination: "UNCLASSIFIED", uuid: "UUID-MONEDA", fecha: "2026-11-04",
      subtotal: 20000, total: 23200, currency: "USD", rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB" },
  ] as never);
  await connection.insert(schema.operatingExpenses).values([
    { id: id(80), companyId, branchId, payeeId, invoiceId: id(70), amount: 116000, status: "APPROVED",
      description: "Luz", createdAt: new Date("2026-11-01") },
    // La factura en USD sí respalda un gasto; el conflicto es la moneda, no la falta de evidencia.
    { id: id(81), companyId, branchId, payeeId, invoiceId: id(74), amount: 23200, status: "PENDING_APPROVAL",
      description: "Servicio en divisa", createdAt: new Date("2026-11-04") },
  ] as never);
}

describe("T12: reporte y backfill histórico", () => {
  it("el reporte cuenta, propone y no modifica ningún saldo elegible", async () => {
    await sembrar();
    const reporte = await getInvoiceClassificationReport(companyId);
    expect(reporte.mode).toBe("SIMULATION");
    expect(reporte.totals.invoices).toBe(4);
    expect(reporte.scope).toEqual({ limit: 1000, truncated: false });
    expect(reporte.proposals.byDestination.OPERATING_EXPENSE).toMatchObject({ count: 1, amountCents: 116000 });
    expect(reporte.proposals.byDestination.INVENTORY_PURCHASE).toMatchObject({ count: 1, amountCents: 58000 });
    expect(reporte.pending.count).toBe(1);
    expect(reporte.conflicts.count).toBe(1);
    expect(reporte.conflicts.reasons["Moneda no soportada para gasto operativo (USD)"]).toBe(1);
    expect(reporte.balanceImpact.deltaCents).toBe(0);
    expect(reporte.balanceImpact.affectedInvoices).toBe(0);
    const rows = await connection.select().from(schema.invoices);
    expect(rows.every(row => row.destination === "UNCLASSIFIED")).toBe(true);
  });

  it("el backfill clasifica con metadata auditable y es idempotente", async () => {
    await sembrar();
    const applied = await backfillInvoiceClassification(companyId, {
      actorId: userId, reason: "Revisión histórica de destinos", dryRun: false,
    });
    expect(applied.applied.count).toBe(2);
    const rows = await connection.select().from(schema.invoices);
    const gasto = rows.find(row => row.id === id(70));
    const compra = rows.find(row => row.id === id(71));
    expect(gasto).toMatchObject({ destination: "OPERATING_EXPENSE", payeeId, classifiedBy: userId,
      classificationSource: "BACKFILL" });
    expect(gasto.classifiedAt).toBeInstanceOf(Date);
    expect(gasto.classificationReason).toContain("Revisión histórica de destinos");
    expect(compra).toMatchObject({ destination: "INVENTORY_PURCHASE", classifiedBy: userId });
    expect(rows.find(row => row.id === id(73))?.destination).toBe("UNCLASSIFIED");
    expect(rows.find(row => row.id === id(74))?.destination).toBe("UNCLASSIFIED");

    const segunda = await backfillInvoiceClassification(companyId, {
      actorId: userId, reason: "Revisión histórica de destinos", dryRun: false,
    });
    expect(segunda.proposals.count).toBe(0);
    expect(segunda.applied.count).toBe(0);
    // La clasificación no crea gastos: solo siguen existiendo los dos sembrados.
    expect((await connection.select().from(schema.operatingExpenses)).length).toBe(2);
  });

  it("avisa cuando el alcance no cubre toda la empresa", async () => {
    await sembrar();
    const reporte = await getInvoiceClassificationReport(companyId, { limit: 2 });
    expect(reporte.totals.invoices).toBe(2);
    expect(reporte.scope).toEqual({ limit: 2, truncated: true });
  });

  it("la simulación no escribe y el actor debe pertenecer a la empresa", async () => {
    await sembrar();
    const reporte = await backfillInvoiceClassification(companyId, { actorId: userId, reason: "Solo reporte" });
    expect(reporte.mode).toBe("SIMULATION");
    expect(reporte.applied.count).toBe(0);
    expect((await connection.select().from(schema.invoices)).every(row => row.destination === "UNCLASSIFIED")).toBe(true);
    await expect(backfillInvoiceClassification(companyId, {
      actorId: id(99), reason: "Actor ajeno", dryRun: false,
    })).rejects.toThrow(/actor/);
  });

  it("no clasifica un documento que dejó de ser inequívoco después del reporte", async () => {
    await sembrar();
    // El reporte lo ve como gasto operativo inequívoco...
    expect((await getInvoiceClassificationReport(companyId)).proposals.count).toBe(2);
    // ...pero antes de escribir aparece un segundo gasto para la misma factura.
    hooks.beforeTransaction = async () => {
      await connection.insert(schema.operatingExpenses).values({ id: id(82), companyId, branchId, payeeId,
        invoiceId: id(70), amount: 116000, status: "PENDING_APPROVAL", description: "Luz (duplicado)",
        createdAt: new Date("2026-11-05") } as never);
    };
    const applied = await backfillInvoiceClassification(companyId, {
      actorId: userId, reason: "Revisión histórica de destinos", dryRun: false,
    });
    const rows = await connection.select().from(schema.invoices);
    // La factura ambigua no se clasifica; la compra con OC sigue su curso.
    expect(rows.find(row => row.id === id(70))?.destination).toBe("UNCLASSIFIED");
    expect(rows.find(row => row.id === id(70))?.classifiedBy ?? null).toBeNull();
    expect(rows.find(row => row.id === id(71))?.destination).toBe("INVENTORY_PURCHASE");
    expect(applied.applied.count).toBe(1);
    expect(applied.applied.skipped).toBe(1);
  });
});
