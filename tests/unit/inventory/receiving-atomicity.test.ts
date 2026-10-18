import { beforeEach, describe, expect, it, vi } from "vitest";
import { processReceiving } from "@/lib/services/receiving-service";
import { db } from "@/lib/db";
import { receivingReports, receivingReportItems } from "@/lib/db/schema";
import { InventoryService } from "@/lib/services/inventory-service";
import { AuditService } from "@/lib/services/audit-service";
import { StockAlertService } from "@/lib/services/stock-alert-service";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/services/inventory-service", () => ({
  InventoryService: {
    getItem: vi.fn(),
    ensureOpenPeriod: vi.fn(async () => undefined),
    createReceivingBatch: vi.fn(),
    updateItem: vi.fn(),
  },
}));
vi.mock("@/lib/services/audit-service", () => ({ AuditService: { logInventoryAction: vi.fn() } }));
vi.mock("@/lib/services/purchase-order-service", () => ({
  PurchaseOrderService: { recordReceivedQuantity: vi.fn() },
}));
vi.mock("@/lib/services/unit-conversion-service", () => ({
  UnitConversionService: { convert: vi.fn(async () => null) },
}));
vi.mock("@/lib/services/invoice-matching-service", () => ({
  InvoiceMatchingService: { perform3WayMatch: vi.fn() },
}));
vi.mock("@/lib/services/stock-alert-service", () => ({
  StockAlertService: { checkPriceIncrease: vi.fn() },
}));
vi.mock("@/lib/services/supplier-claim-service", () => ({
  SupplierClaimService: { createClaim: vi.fn() },
}));
vi.mock("@/lib/services/notification-dispatcher", () => ({
  NotificationDispatcher: { sendNotification: vi.fn() },
}));

const companyId = "c1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const itemId = "d1000000-0000-4000-8000-000000000001";
const supplierId = "a1000000-0000-4000-8000-000000000001";
const reportId = "f1000000-0000-4000-8000-000000000001";

const actor = { user: { id: "actor", companyId }, branchId };

function thenable(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return { limit: () => promise, then: (f: unknown, r: unknown) => promise.then(f as never, r as never) };
}

let tx: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(InventoryService.getItem).mockResolvedValue({
    id: itemId, name: "Insumo", unit: "KG", storageType: null, lastCost: 100, supplierId: null,
  } as never);
  vi.mocked(InventoryService.createReceivingBatch).mockResolvedValue({
    batch: { id: "batch-1", lotNumber: "L1", expirationDate: null },
    movement: { id: "movement-1" },
  } as never);

  const reportInsert = {
    values: () => ({ returning: async () => [{ id: reportId, receivedAt: new Date() }] }),
  };
  const lineInsert = { values: () => { throw new Error("fallo al guardar la línea"); } };

  tx = {
    execute: vi.fn(async () => undefined),
    insert: (table: unknown) => (table === receivingReports ? reportInsert : lineInsert),
    select: () => ({ from: () => ({ where: () => thenable([]) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  vi.mocked(db.transaction).mockImplementation((async (cb: (t: unknown) => unknown) =>
    cb(tx)) as never);
  vi.mocked(db.select).mockReturnValue({ from: () => ({ where: () => thenable([]) }) } as never);
});

describe("REC-02b: núcleo atómico de la recepción", () => {
  it("un fallo intermedio revierte y no ejecuta efectos derivados ni auditoría", async () => {
    await expect(
      processReceiving(actor, { items: [{ itemId, quantity: 10 }], supplierId })
    ).rejects.toThrow("fallo al guardar la línea");

    // El lote/movimiento se escriben en la MISMA transacción que el reporte.
    expect(InventoryService.createReceivingBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      tx
    );

    // Nada se escribe fuera de la transacción ni se disparan efectos.
    expect(db.insert).not.toHaveBeenCalled();
    expect(StockAlertService.checkPriceIncrease).not.toHaveBeenCalled();
    expect(AuditService.logInventoryAction).not.toHaveBeenCalled();
  });
});
