import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, E2E_TAG } from "./support/constants";
import {
  cleanupForeignTenant,
  createTestSkus,
  deleteBatch,
  deleteMovementsForItems,
  deleteTestSkus,
  deleteWasteForItems,
  findBatchExactQuantity,
  findMovementsForItem,
  findWasteForItem,
  seedBatch,
  seedForeignTenant,
} from "./support/db";

/**
 * T5 (tasks/plan-inventory-waste.md) — `POST /api/inventory/waste` reescrito:
 * decimal-safe (numeric(12,4)) y multi-tenant.
 *
 * - Una merma fraccionaria (0.4 kg) se guarda como 0.4000, descuenta el lote
 *   exacto (2.5 → 2.1000) y escribe el movimiento -0.4000.
 * - Sobre-cantidad → 400 con el código ESTABLE `OVER_QUANTITY` (la UI se apoya
 *   en `error.details.code`, nunca en substrings del mensaje).
 * - Un lote de OTRO tenant → 404 (no 403), para no filtrar existencia.
 */

const TAG = "e2e-waste-api";
const UNIT = "KG";

let itemIds: string[] = [];
let batchId = "";
let foreign: { companyId: string; branchId: string; itemId: string; batchId: string } | null = null;

function postWaste(page: import("@playwright/test").Page, body: Record<string, unknown>) {
  return page.request.post("/api/inventory/waste", { data: body });
}

test.describe("T5 · API de mermas (ruta reescrita)", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: UNIT, tags: [TAG] });
  });

  test.afterEach(async () => {
    await deleteWasteForItems(itemIds);
    await deleteMovementsForItems(itemIds);
    if (batchId) await deleteBatch(batchId);
    await deleteTestSkus();
    if (foreign) {
      await cleanupForeignTenant(foreign);
      foreign = null;
    }
    batchId = "";
    itemIds = [];
  });

  test("una merma fraccionaria se guarda como 0.4000 y descuenta el lote exacto", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 2.5,
      unitCostCents: 1234,
      lotNumber: "E2E-T5-LOTE-01",
    });

    const res = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 0.4,
      unit: UNIT,
      reason: "EXPIRED",
      costPerUnit: 12.34,
    });

    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // La API devuelve la cantidad como número (T4), no "0.4000".
    expect(body.data.waste.quantity).toBe(0.4);
    // totalLoss derivado del costo redondeado a centavos: round(0.4 × 1234) = 494.
    expect(body.data.waste.totalLoss).toBe(494);
    expect(body.data.updatedStock).toBe(2.1);

    // En la DB: quantity = 0.4000, el lote bajó exacto y el movimiento es -0.4000.
    const wasteRows = await findWasteForItem(itemId);
    expect(wasteRows).toHaveLength(1);
    expect(wasteRows[0].quantityRaw).toBe("0.4000");
    expect(wasteRows[0].reason).toBe("EXPIRED");

    expect(await findBatchExactQuantity(batchId)).toBe("2.1000");

    const movements = await findMovementsForItem(itemId);
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe("WASTE");
    expect(movements[0].quantityChangeRaw).toBe("-0.4000");
  });

  test("sobre-cantidad es rechazada con el código estable OVER_QUANTITY", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 1,
      lotNumber: "E2E-T5-LOTE-02",
    });

    const res = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 1.5,
      unit: UNIT,
      reason: "EXPIRED",
    });

    expect(res.status(), await res.text()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    // El contrato para la UI (T6): el código vive en details, no en el mensaje.
    expect(body.error.details.code).toBe("OVER_QUANTITY");
    expect(body.error.details.maxQuantity).toBe("1");

    // Nada se escribió: ni merma, ni movimiento, ni decremento de lote.
    expect(await findWasteForItem(itemId)).toHaveLength(0);
    expect(await findMovementsForItem(itemId)).toHaveLength(0);
    expect(await findBatchExactQuantity(batchId)).toBe("1.0000");
  });

  test("un lote de otro tenant responde 404 (no 403) y no escribe nada", async ({ page }) => {
    const itemId = itemIds[0];
    foreign = await seedForeignTenant();

    const res = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId: foreign.batchId,
      itemId,
      quantity: 0.5,
      unit: UNIT,
      reason: "SPILLAGE",
    });

    expect(res.status(), await res.text()).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.details.code).toBe("BATCH_NOT_FOUND");

    // El tenant legítimo no sufrió efectos colaterales.
    expect(await findWasteForItem(itemId)).toHaveLength(0);
    expect(await findMovementsForItem(itemId)).toHaveLength(0);
    // Y el lote ajeno sigue intacto.
    const foreignQty = await findBatchExactQuantity(foreign.batchId);
    expect(foreignQty).toBe("5.0000");
  });

  test("el historial (GET) llega como envelope con cantidad numérica", async ({ page }) => {
    const itemId = itemIds[0];
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 3,
      lotNumber: "E2E-T5-LOTE-03",
    });

    const created = await postWaste(page, {
      branchId: BRANCH_POLANCO,
      batchId,
      itemId,
      quantity: 0.75,
      unit: UNIT,
      reason: "SPILLAGE",
    });
    expect(created.status(), await created.text()).toBe(200);

    // GET escopeado a la sucursal: envelope + quantity numérica, no "0.7500".
    const res = await page.request.get(
      `/api/inventory/waste?branchId=${BRANCH_POLANCO}`
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const row = body.data.waste.find((w: { waste: { itemId: string } }) => w.waste.itemId === itemId);
    expect(row).toBeTruthy();
    expect(row.waste.quantity).toBe(0.75);
    expect(row.item.unit).toBe(UNIT);
  });
});