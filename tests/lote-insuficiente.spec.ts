import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID } from "./support/constants";
import {
  cleanupProduction,
  createTestSkus,
  deleteBatch,
  deleteTestRecipes,
  deleteTestSkus,
  deleteWasteForItems,
  findBatchQuantity,
  findProductionResultsForInstance,
  findWasteForInstance,
  seedBatch,
  seedProductionTemplate,
  seedRecipe,
  seedRecipeItem,
} from "./support/db";

/**
 * Fase 4 — Lote insuficiente → merma, no fallo silencioso (T16/T17b).
 *
 * Antes, `recordProduction` omitía el descuento si el lote no alcanzaba: la
 * señal de auditoría se perdía. Ahora descuenta lo disponible y el extractor
 * convierte el faltante en una fila de `inventory_waste` con
 * `motivo=lote_insuficiente`.
 */

const TAG = "e2e-lote-insuficiente";
const CLOSING_STEP = "prod-obs";

let templateId = "";
let instanceId = "";
let itemId = "";
let batchId = "";
let recipeId = "";

test.describe("Fase 4 · lote insuficiente", () => {
  test.beforeEach(async () => {
    [itemId] = await createTestSkus(COMPANY_ID, 1, { unit: "KG" });
    // Sólo hay 3 kg de harina en el lote.
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 3,
    });

    // La receta pide 4 kg por porción.
    recipeId = await seedRecipe(COMPANY_ID, "Pizza grande", { tags: [TAG] });
    await seedRecipeItem({ recipeId, itemId, quantity: 4, unit: "KG" });

    templateId = await seedProductionTemplate(COMPANY_ID, TAG, CLOSING_STEP);
  });

  test.afterEach(async () => {
    if (instanceId) await cleanupProduction(instanceId, templateId);
    await deleteBatch(batchId);
    await deleteWasteForItems([itemId]);
    await deleteTestRecipes();
    await deleteTestSkus();
    instanceId = "";
  });

  test("producir 1 porción con 3 de 4 kg disponibles genera merma por lote insuficiente", async ({
    page,
  }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/prod-qty-${recipeId}`,
      { data: { value: "1", status: "COMPLETED" } }
    );
    const cierre = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: "cierre insuficiente", status: "COMPLETED" } }
    );
    expect(cierre.ok(), await cierre.text()).toBeTruthy();

    // La producción se registra igual (1 porción), con el descuento parcial.
    await expect
      .poll(async () => (await findProductionResultsForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(1);

    // El lote bajó a 0 (se descontó lo disponible), no se quedó intacto.
    expect(await findBatchQuantity(batchId)).toBe(0);

    // Y el faltante (1 kg) quedó registrado como merma con motivo explícito.
    await expect
      .poll(async () => (await findWasteForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(1);

    const rows = await findWasteForInstance(instanceId);
    expect(rows[0].item_id).toBe(itemId);
    expect(rows[0].reason).toBe("OTHER");
    expect(rows[0].quantity).toBe(1); // 4 pedidos − 3 disponibles
    expect(rows[0].notes).toContain("motivo=lote_insuficiente");
  });
});