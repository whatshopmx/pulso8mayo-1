import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, E2E_TAG } from "./support/constants";
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
  getInstanceData,
  seedBatch,
  seedProductionTemplate,
  seedRecipe,
  seedRecipeItem,
} from "./support/db";

/**
 * Fase 4 — Producción diaria desde workflow (T17a).
 *
 * Producir una receta descuenta los insumos según `recipe_items`, escribe
 * `production_results` + `production_ingredients` (un registro por par
 * item/lote) y las porciones capturadas se registran como producidas.
 * Completar dos veces no duplica resultados (AD-4).
 */

const TAG = "e2e-produccion";
const CLOSING_STEP = "prod-obs";

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];
let batchIds: string[] = [];
let recipeId = "";

test.describe("Fase 4 · producción diaria", () => {
  test.beforeEach(async () => {
    // Insumos: queso (10 en lote) y salsa (5 en lote).
    itemIds = await createTestSkus(COMPANY_ID, 2, { unit: "KG", tags: [] });
    batchIds.push(
      await seedBatch({ companyId: COMPANY_ID, branchId: BRANCH_POLANCO, itemId: itemIds[0], quantity: 10 }),
      await seedBatch({ companyId: COMPANY_ID, branchId: BRANCH_POLANCO, itemId: itemIds[1], quantity: 5 })
    );
    // Quesadilla: 2 de queso + 1 de salsa por porción.
    recipeId = await seedRecipe(COMPANY_ID, "Quesadilla de prueba", {
      unit: "PORTION",
      tags: [TAG],
    });
    await seedRecipeItem({ recipeId, itemId: itemIds[0], quantity: 2, unit: "KG" });
    await seedRecipeItem({ recipeId, itemId: itemIds[1], quantity: 1, unit: "KG" });

    templateId = await seedProductionTemplate(COMPANY_ID, TAG, CLOSING_STEP);
  });

  test.afterEach(async () => {
    if (instanceId) await cleanupProduction(instanceId, templateId);
    for (const b of batchIds) await deleteBatch(b);
    await deleteWasteForItems(itemIds);
    await deleteTestRecipes();
    await deleteTestSkus();
    instanceId = "";
    batchIds = [];
  });

  test("producir 3 porciones descuenta 2×3 queso y 1×3 salsa y escribe el resultado", async ({
    page,
  }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    // El paso dinámico expande SÓLO la receta etiquetada.
    const steps = await page.request
      .get(`/api/workflows/executions/${instanceId}`)
      .then((r) => r.json())
      .then((j) => j.steps as { stepId: string; status: string }[]);

    const prodSteps = steps.filter((s) => s.stepId?.startsWith("prod-qty-"));
    expect(prodSteps).toHaveLength(1);
    expect(prodSteps[0].stepId).toBe(`prod-qty-${recipeId}`);

    const res = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/prod-qty-${recipeId}`,
      { data: { value: "3", status: "COMPLETED" } }
    );
    expect(res.ok(), await res.text()).toBeTruthy();

    const cierre = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: `${E2E_TAG} 3 porciones`, status: "COMPLETED" } }
    );
    expect(cierre.ok(), await cierre.text()).toBeTruthy();

    await expect
      .poll(async () => (await findProductionResultsForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(1);

    const results = await findProductionResultsForInstance(instanceId);
    expect(results[0].recipe_id).toBe(recipeId);
    expect(results[0].produced_quantity).toBe(3);

    const ingredients = await findProductionIngredients(results[0].id);
    const byItem = new Map(ingredients.map((i) => [i.item_id, i]));
    expect(byItem.get(itemIds[0])?.actual_quantity).toBe(6); // 2 × 3
    expect(byItem.get(itemIds[1])?.actual_quantity).toBe(3); // 1 × 3
    expect(byItem.get(itemIds[0])?.batch_id).toBeTruthy();

    // Los lotes bajaron: queso 10−6=4, salsa 5−3=2.
    expect(await findBatchQuantity(batchIds[0])).toBe(4);
    expect(await findBatchQuantity(batchIds[1])).toBe(2);
  });

  test("completar dos veces no duplica los resultados de producción", async ({ page }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/prod-qty-${recipeId}`,
      { data: { value: "1", status: "COMPLETED" } }
    );

    for (let i = 0; i < 2; i++) {
      await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
        { data: { value: `${E2E_TAG} cierre ${i}`, status: "COMPLETED" } }
      );
      await page.waitForTimeout(2000);
    }

    await expect
      .poll(async () => (await getInstanceData(instanceId))?.status, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe("COMPLETED");

    await page.waitForTimeout(3000);
    expect(await findProductionResultsForInstance(instanceId)).toHaveLength(1);
  });
});