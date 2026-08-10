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
  findProductionIngredients,
  findProductionResultsForInstance,
  seedBatch,
  seedProductionTemplate,
  seedRecipe,
  seedRecipeItem,
} from "./support/db";

/**
 * Fase 4 — Consumo FEFO (T17b).
 *
 * Con dos lotes donde el RECIBIDO DESPUÉS caduca ANTES, el consumo de
 * producción toma ese primero. Orden: `expirationDate ASC, createdAt ASC`
 * (asignación FEFO de `allocateFEFO`).
 */

const TAG = "e2e-fefo";
const CLOSING_STEP = "prod-obs";
const PORCION = "5";

let templateId = "";
let instanceId = "";
let itemId = "";
let batchTempranoCaducidad = "";
let batchTardeCaducidad = "";
let recipeId = "";

test.describe("Fase 4 · consumo FEFO", () => {
  test.beforeEach(async () => {
    // Lote A: recibido PRIMERO, caduca DESPUÉS (2026-12-31).
    // Lote B: recibido DESPUÉS, caduca ANTES (2025-06-01).
    [itemId] = await createTestSkus(COMPANY_ID, 1, { unit: "KG" });
    batchTempranoCaducidad = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 10,
      lotNumber: "E2E-FEFO-A",
      expirationDate: "2026-12-31T00:00:00.000Z",
    });
    batchTardeCaducidad = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId,
      quantity: 10,
      lotNumber: "E2E-FEFO-B",
      expirationDate: "2025-06-01T00:00:00.000Z",
    });

    // Receta que usa 1 unidad de este insumo por porción.
    recipeId = await seedRecipe(COMPANY_ID, "Tapa FEFO", { tags: [TAG] });
    await seedRecipeItem({ recipeId, itemId, quantity: 1, unit: "KG" });

    templateId = await seedProductionTemplate(COMPANY_ID, TAG, CLOSING_STEP);
  });

  test.afterEach(async () => {
    if (instanceId) await cleanupProduction(instanceId, templateId);
    await deleteBatch(batchTempranoCaducidad);
    await deleteBatch(batchTardeCaducidad);
    await deleteWasteForItems([itemId]);
    await deleteTestRecipes();
    await deleteTestSkus();
    instanceId = "";
  });

  test("el lote que caduca antes se consume primero aunque se haya recibido después", async ({
    page,
  }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/prod-qty-${recipeId}`,
      { data: { value: PORCION, status: "COMPLETED" } }
    );
    const cierre = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: "cierre fefo", status: "COMPLETED" } }
    );
    expect(cierre.ok(), await cierre.text()).toBeTruthy();

    await expect
      .poll(async () => (await findProductionResultsForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(1);

    const [result] = await findProductionResultsForInstance(instanceId);
    const ingredients = await findProductionIngredients(result.id);

    // El descuento fue sobre el lote B (caduca antes), no el A (recibido antes).
    expect(ingredients[0].batch_id).toBe(batchTardeCaducidad);
    expect(ingredients[0].actual_quantity).toBe(5);

    expect(await findBatchQuantity(batchTardeCaducidad)).toBe(5); // 10 − 5
    expect(await findBatchQuantity(batchTempranoCaducidad)).toBe(10); // intacto

    // Segundo ciclo: ahora sí toca al lote A.
    const creada2 = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada2.ok(), await creada2.text()).toBeTruthy();
    const instance2 = (await creada2.json()).id;

    await page.request.patch(
      `/api/workflows/executions/${instance2}/steps/prod-qty-${recipeId}`,
      { data: { value: PORCION, status: "COMPLETED" } }
    );
    await page.request.patch(
      `/api/workflows/executions/${instance2}/steps/${CLOSING_STEP}`,
      { data: { value: "cierre fefo 2", status: "COMPLETED" } }
    );

    await expect
      .poll(async () => (await findProductionResultsForInstance(instance2)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(1);
    // Segundo ciclo: el lote B (caduca antes) aún tenía 5 — se agota antes de
    // tocar el A. FEFO real: caducidad, no orden de recepción.
    await page.waitForTimeout(2000);

    expect(await findBatchQuantity(batchTardeCaducidad)).toBe(0); // 5 − 5 agotado
    expect(await findBatchQuantity(batchTempranoCaducidad)).toBe(10); // todavía intacto
  });
});