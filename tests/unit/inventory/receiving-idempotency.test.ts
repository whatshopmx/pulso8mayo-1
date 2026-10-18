import { beforeEach, describe, expect, it, vi } from "vitest";
import { processReceiving } from "@/lib/services/receiving-service";
import { db } from "@/lib/db";

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
const otherBranchId = "b2000000-0000-4000-8000-000000000002";
const reportId = "f1000000-0000-4000-8000-000000000001";

const actor = { user: { id: "actor", companyId }, branchId };
const key = "wf-receiving:instance-1";

let selectQueue: unknown[][] = [];
const returning = vi.fn();

function thenable(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return {
    limit: () => promise,
    then: (onFulfilled: unknown, onRejected: unknown) =>
      promise.then(onFulfilled as never, onRejected as never),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  returning.mockResolvedValue([{ id: reportId }]);
  vi.mocked(db.insert).mockReturnValue({ values: () => ({ returning }) } as never);
  const tx = { insert: () => ({ values: () => ({ returning }) }) };
  vi.mocked(db.transaction).mockImplementation((async (cb: (t: unknown) => unknown) =>
    cb(tx)) as never);
  vi.mocked(db.select).mockImplementation(() => {
    const rows = selectQueue.shift() ?? [];
    const node = { from: () => node, where: () => thenable(rows) };
    return node as never;
  });
});

describe("REC-02a: idempotencia de recepción", () => {
  it("reenviar con la misma clave devuelve la recepción existente sin escribir", async () => {
    selectQueue = [
      [{ id: reportId, companyId, branchId, purchaseOrderId: null, invoiceNumber: "F-1", notes: null }],
      [{ itemId: "i-1", receivedQuantity: 10, unitCost: 500, lineTotal: 5000, discrepancyType: "NONE" }],
    ];

    const result = await processReceiving(actor, { items: [], idempotencyKey: key });

    expect(result.id).toBe(reportId);
    expect(result.totalItems).toBe(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("una carrera con la misma clave recupera la fila ganadora", async () => {
    returning.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    selectQueue = [
      [], // primer lookup: todavía no existe
      [{ id: reportId, companyId, branchId }], // lookup tras el choque
      [],
    ];

    const result = await processReceiving(actor, { items: [], idempotencyKey: key });

    expect(result.id).toBe(reportId);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("rechaza con 409 una clave ya usada en otra sucursal", async () => {
    selectQueue = [[{ id: reportId, companyId, branchId: otherBranchId }]];

    await expect(
      processReceiving(actor, { items: [], idempotencyKey: key })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
