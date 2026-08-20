import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
import {
  cleanupStockCounts,
  createTestSkus,
  deleteBatch,
  deleteSnapshots,
  deleteStockCountsForItems,
  deleteTestSkus,
  findSnapshotsForBranchDate,
  findStockCountsForInstance,
  seedBatch,
  seedCompletedCountInstance,
  seedDynamicCountTemplate,
} from "./support/db";
import { InventorySnapshotService } from "../lib/services/inventory-snapshot-service";
import { extractStockCountFromInstance } from "../lib/services/stock-count-from-workflow";

/**
 * Auditoría A3 — O-2: la fecha operativa se sella en UTC.
 *
 * En un restaurante mexicano el conteo normal es el de cierre, entre las 18:00
 * y la medianoche local. `America/Mexico_City` es UTC-6 todo el año (México
 * abolió el horario de verano en 2022), así que un cierre a las 18:30 del día D
 * ocurre a las 00:30 UTC de D+1. `countDate` sale de
 * `completedAt.toISOString().slice(0, 10)` → se sella **D+1**.
 *
 * `buildSnapshot` cruza `stock_counts` por `countDate = snapshotDate`, así que
 * el snapshot del día D no encuentra el conteo: `countedStock` NULL y
 * `variance` NULL. **El conteo de cierre —el caso normal— no produce varianza.**
 *
 * Este spec debe estar ROJO contra el código actual y verde tras A4.
 *
 * El borde inverso (00:30 local, mismo día en ambas zonas) va en el segundo
 * caso: sirve para confirmar que el rojo del primero es por el huso y no por
 * cualquier otra cosa del montaje.
 */

const TAG = "e2e-conteo-fecha-local";

/** Zona de la sucursal Polanco (`branches.timezone`). UTC-6 sin verano. */
const OFFSET_HORAS = 6;

/** Día operativo fijo: un test de husos no puede depender de cuándo se corre. */
const DIA_LOCAL = "2026-03-15";
/** Día siguiente en UTC — el que el bug sella por error. */
const DIA_UTC_SIGUIENTE = "2026-03-16";

/** El instante UTC que corresponde a una hora local de la sucursal ese día. */
function instanteLocal(hora: number, minuto: number): Date {
  return new Date(Date.UTC(2026, 2, 15, hora + OFFSET_HORAS, minuto, 0));
}

/** `count_date` es `date`: el driver puede devolver Date o string. */
function comoFecha(valor: unknown): string {
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

let templateId = "";
let instanceId = "";
let batchId = "";
let itemIds: string[] = [];

test.describe("Auditoría A3 · fecha operativa del conteo", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, {
      isHighValue: true,
      unit: "KG",
      tags: [TAG],
    });
    templateId = await seedDynamicCountTemplate(COMPANY_ID, TAG);
    // 10 en lote y 10 contados: sin varianza, para que el conteo no dispare
    // merma automática y el caso quede acotado a la fecha.
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId: itemIds[0],
      quantity: 10,
    });
  });

  test.afterEach(async () => {
    await deleteSnapshots({
      branchId: BRANCH_POLANCO,
      snapshotDate: DIA_LOCAL,
      itemIds,
    });
    await deleteSnapshots({
      branchId: BRANCH_POLANCO,
      snapshotDate: DIA_UTC_SIGUIENTE,
      itemIds,
    });
    if (instanceId) await cleanupStockCounts(instanceId, templateId);
    await deleteStockCountsForItems(itemIds);
    if (batchId) await deleteBatch(batchId);
    await deleteTestSkus();
    instanceId = "";
    batchId = "";
  });

  test("un conteo cerrado a las 18:30 locales pertenece a ESE día, no al siguiente en UTC", async () => {
    // 18:30 en Ciudad de México = 00:30 UTC del día siguiente.
    const cierre = instanteLocal(18, 30);
    expect(cierre.toISOString()).toBe("2026-03-16T00:30:00.000Z");

    instanceId = await seedCompletedCountInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      completedAt: cierre,
      counts: [{ itemId: itemIds[0], quantity: "10" }],
    });

    await extractStockCountFromInstance(instanceId);

    const conteos = await findStockCountsForInstance(instanceId);
    expect(conteos).toHaveLength(1);

    // 1. La fecha del conteo es el día LOCAL del cierre.
    expect(comoFecha(conteos[0].count_date)).toBe(DIA_LOCAL);

    // 2. Y por lo tanto el snapshot de ese día operativo sí lo encuentra.
    await InventorySnapshotService.buildSnapshot(COMPANY_ID, BRANCH_POLANCO, DIA_LOCAL);

    const snapshots = await findSnapshotsForBranchDate(BRANCH_POLANCO, DIA_LOCAL);
    const fila = snapshots.find((s) => s.item_id === itemIds[0]);
    expect(fila, "no hay snapshot para el SKU del test").toBeTruthy();

    // Éste es el corazón de O-2: hoy sale NULL y la varianza se pierde.
    expect(fila!.counted_stock, "el conteo de cierre no llegó al snapshot").not.toBeNull();
    expect(Number(fila!.counted_stock)).toBe(10);
    expect(Number(fila!.calculated_stock)).toBe(10);
    expect(fila!.variance).not.toBeNull();
    expect(Number(fila!.variance)).toBe(0);
  });

  test("borde inverso: un conteo a las 00:30 locales cae el mismo día en ambas zonas y ya funciona hoy", async () => {
    // 00:30 en Ciudad de México = 06:30 UTC del MISMO día: sin discrepancia.
    const cierre = instanteLocal(0, 30);
    expect(cierre.toISOString()).toBe("2026-03-15T06:30:00.000Z");

    instanceId = await seedCompletedCountInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      completedAt: cierre,
      counts: [{ itemId: itemIds[0], quantity: "10" }],
    });

    await extractStockCountFromInstance(instanceId);

    const conteos = await findStockCountsForInstance(instanceId);
    expect(conteos).toHaveLength(1);
    expect(comoFecha(conteos[0].count_date)).toBe(DIA_LOCAL);

    await InventorySnapshotService.buildSnapshot(COMPANY_ID, BRANCH_POLANCO, DIA_LOCAL);

    const snapshots = await findSnapshotsForBranchDate(BRANCH_POLANCO, DIA_LOCAL);
    const fila = snapshots.find((s) => s.item_id === itemIds[0]);
    expect(fila).toBeTruthy();
    expect(fila!.counted_stock).not.toBeNull();
    expect(Number(fila!.counted_stock)).toBe(10);
  });
});
