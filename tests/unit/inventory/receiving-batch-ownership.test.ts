import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryService } from "@/lib/services/inventory-service";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn() } }));

const itemId = "d1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";

/**
 * REC-01: el lote nace en cero y el movimiento es el único dueño del
 * incremento. Si el lote naciera con la cantidad y el movimiento volviera a
 * sumarla, recibir 10 dejaría 20.
 */
describe("REC-01: alta de lote recibido", () => {
  let insertedBatchValue: Record<string, unknown> | undefined;
  let movementSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedBatchValue = undefined;

    const tx = {
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          insertedBatchValue = value;
          return { returning: async () => [{ id: "batch-1", ...value }] };
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "batch-1", currentQuantity: "10" }],
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    };

    vi.mocked(db.transaction).mockImplementation((async (cb: (tx: unknown) => unknown) =>
      cb(tx)) as never);

    movementSpy = vi
      .spyOn(InventoryService, "recordMovement")
      .mockResolvedValue({ id: "movement-1" } as never);
  });

  it("recibir 10 deja saldo 10 con un solo movimiento de +10", async () => {
    const result = await InventoryService.createReceivingBatch(
      { itemId, branchId, initialQuantity: "10" },
      { branchId, itemId, type: "RECEIVING", quantityChange: 10, performedBy: "actor" }
    );

    // El lote se inserta en cero: el saldo lo aporta el movimiento.
    expect(insertedBatchValue?.currentQuantity).toBe("0");
    expect(insertedBatchValue?.initialQuantity).toBe("10");

    // Un único movimiento de entrada, atado al lote y en la misma transacción.
    expect(movementSpy).toHaveBeenCalledTimes(1);
    expect(movementSpy).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "batch-1", quantityChange: 10 }),
      expect.anything()
    );

    // Se devuelve el saldo ya aplicado, no el cero del INSERT.
    expect(result.batch.currentQuantity).toBe("10");
    expect(result.movement).toEqual({ id: "movement-1" });
  });

  it("cuarentena conserva su estado y no se convierte en disponible al recibir", async () => {
    await InventoryService.createReceivingBatch(
      { itemId, branchId, initialQuantity: "5", status: "QUARANTINED" },
      { branchId, itemId, type: "RECEIVING", quantityChange: 5, performedBy: "actor" }
    );

    expect(insertedBatchValue?.status).toBe("QUARANTINED");
    expect(insertedBatchValue?.currentQuantity).toBe("0");
  });
});
