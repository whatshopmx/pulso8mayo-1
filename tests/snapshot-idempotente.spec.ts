import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID } from "./support/constants";
import {
  createTestSkus,
  deleteBatch,
  deleteSnapshots,
  deleteStockCount,
  deleteTestSkus,
  findSnapshotsForBranchDate,
  seedBatch,
  seedStockCount,
  today,
} from "./support/db";
import { InventorySnapshotService } from "../lib/services/inventory-snapshot-service";

/**
 * Fase 2 — Snapshots de stock idempotentes (T10).
 *
 * `buildSnapshot` corre en producción desde un cron nocturno; si la misma
 * sucursal se procesa dos veces (retry de Inngest, overlap) no debe duplicar
 * filas (AD-4). También verifica el cruce con el último conteo del día y que
 * la varianza (columna generada) sea contado − calculado.
 */

const fecha = today();

let itemIds: string[] = [];
let batchId = "";
let countId = "";

test.describe("Fase 2 · snapshot idempotente", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, { isHighValue: true, unit: "KG" });
    // Lote con 10 unidades → stock calculado = 10.
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId: itemIds[0],
      quantity: 10,
    });
    // Conteo físico del día: contamos 8 → faltan 2.
    countId = await seedStockCount({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId: itemIds[0],
      countedQuantity: "8",
      systemQuantity: "10",
      countDate: fecha,
    });
  });

  test.afterEach(async () => {
    await deleteSnapshots({ branchId: BRANCH_POLANCO, snapshotDate: fecha, itemIds });
    if (countId) await deleteStockCount(countId);
    if (batchId) await deleteBatch(batchId);
    await deleteTestSkus();
    itemIds = [];
  });

  test("correr buildSnapshot dos veces el mismo día no duplica filas y actualiza el stock calculado", async () => {
    const n1 = await InventorySnapshotService.buildSnapshot(COMPANY_ID, BRANCH_POLANCO, fecha);

    expect(n1).toBe(1);
    let filas = await findSnapshotsForBranchDate(BRANCH_POLANCO, fecha);
    expect(filas).toHaveLength(1);

    const fila = filas[0];
    expect(fila.item_id).toBe(itemIds[0]);
    // numeric devuelve string: "10.0000" / "8.0000".
    expect(Number(fila.calculated_stock)).toBe(10);
    expect(Number(fila.counted_stock)).toBe(8);
    // Columna generada: contado − calculado = −2.
    expect(Number(fila.variance)).toBe(-2);

    // Segundo run: mismo día → ON CONFLICT actualiza, no inserta.
    const n2 = await InventorySnapshotService.buildSnapshot(COMPANY_ID, BRANCH_POLANCO, fecha);
    expect(n2).toBe(1);
    filas = await findSnapshotsForBranchDate(BRANCH_POLANCO, fecha);
    expect(filas).toHaveLength(1);
  });

  test("el snapshot refleja el estado actualizado de los lotes tras una segunda corrida", async () => {
    await InventorySnapshotService.buildSnapshot(COMPANY_ID, BRANCH_POLANCO, fecha);

    // El stock calculado cambia: llegó otro lote con 5 más.
    const batch2 = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId: itemIds[0],
      quantity: 5,
    });

    try {
      await InventorySnapshotService.buildSnapshot(COMPANY_ID, BRANCH_POLANCO, fecha);
      const filas = await findSnapshotsForBranchDate(BRANCH_POLANCO, fecha);
      expect(filas).toHaveLength(1);
      // 15 calculado, 8 contado → varianza −7.
      expect(Number(filas[0].calculated_stock)).toBe(15);
      expect(Number(filas[0].variance)).toBe(-7);
    } finally {
      await deleteBatch(batch2);
    }
  });
});