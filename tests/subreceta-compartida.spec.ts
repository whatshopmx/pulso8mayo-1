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
  seedBatch,
  seedProductionTemplate,
  seedRecipe,
  seedRecipeItem,
} from "./support/db";

/**
 * Auditoría A5 — O-3: el cache de `expandRecipeLeaves` guarda hojas YA escaladas.
 *
 * El cache es `Map<recipeId, LeafRequirement[]>` y se llena con las hojas
 * multiplicadas por el `quantityNeeded` de la PRIMERA expansión. La clave no
 * incluye la cantidad, así que la segunda receta que use la misma sub-receta
 * recibe las cantidades de la primera.
 *
 * El montaje es el mínimo que lo expone y que los specs existentes no tienen,
 * porque todos producen una sola receta:
 *
 *   Base (sub-receta)   → 1 de HARINA por unidad
 *   Guiso   = 2 × Base  → producir 1 Guiso consume 2 de harina
 *   Sopa    = 5 × Base  → producir 1 Sopa  consume 5 de harina
 *
 * Producir 1 de cada una en la misma instancia debe consumir **7**. Con el
 * defecto consume 4 (si Guiso se expande primero) o 10 (si es Sopa): la
 * aserción sobre el total atrapa los dos órdenes, que es justo lo que pide el
 * criterio "el orden de las recetas no debe cambiar el resultado".
 *
 * Las cantidades son enteras a propósito: así el redondeo de O-5
 * (`production_ingredients.actual_quantity` es `integer`) no se mezcla con lo
 * que este spec mide.
 *
 * Debe estar ROJO contra el código actual y verde tras A6.
 */

const TAG = "e2e-subreceta";
const CLOSING_STEP = "prod-obs";

/** Stock inicial de harina: de sobra, para que FEFO nunca sea el limitante. */
const STOCK_HARINA = 100;
/** 1 Guiso (2 × Base) + 1 Sopa (5 × Base), con Base = 1 de harina. */
const CONSUMO_ESPERADO = 7;

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];
let batchId = "";
let recetaGuiso = "";
let recetaSopa = "";
let subrecetaBase = "";

test.describe("Auditoría A5 · sub-receta compartida", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: "KG", tags: [] });
    batchId = await seedBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      itemId: itemIds[0],
      quantity: STOCK_HARINA,
    });

    // Sub-receta SIN tag: no debe aparecer como paso propio del template.
    subrecetaBase = await seedRecipe(COMPANY_ID, "Base de prueba", { unit: "KG" });
    await seedRecipeItem({ recipeId: subrecetaBase, itemId: itemIds[0], quantity: 1, unit: "KG" });

    // Las dos recetas de arriba usan la MISMA sub-receta con cantidades distintas.
    recetaGuiso = await seedRecipe(COMPANY_ID, "Guiso de prueba", {
      unit: "PORTION",
      tags: [TAG],
    });
    await seedRecipeItem({
      recipeId: recetaGuiso,
      itemId: subrecetaBase,
      quantity: 2,
      unit: "KG",
      isSubRecipe: true,
    });

    recetaSopa = await seedRecipe(COMPANY_ID, "Sopa de prueba", {
      unit: "PORTION",
      tags: [TAG],
    });
    await seedRecipeItem({
      recipeId: recetaSopa,
      itemId: subrecetaBase,
      quantity: 5,
      unit: "KG",
      isSubRecipe: true,
    });

    templateId = await seedProductionTemplate(COMPANY_ID, TAG, CLOSING_STEP);
  });

  test.afterEach(async () => {
    if (instanceId) await cleanupProduction(instanceId, templateId);
    if (batchId) await deleteBatch(batchId);
    await deleteWasteForItems(itemIds);
    await deleteTestRecipes();
    await deleteTestSkus();
    instanceId = "";
    batchId = "";
  });

  test("dos recetas que comparten una sub-receta con cantidades distintas consumen cada una lo suyo", async ({
    page,
  }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    const steps = await page.request
      .get(`/api/workflows/executions/${instanceId}`)
      .then((r) => r.json())
      .then((j) => j.steps as { stepId: string; status: string }[]);

    const prodSteps = steps.filter((s) => s.stepId?.startsWith("prod-qty-"));
    // Sólo las dos recetas etiquetadas: la sub-receta no es un paso.
    expect(prodSteps.map((s) => s.stepId).sort()).toEqual(
      [`prod-qty-${recetaGuiso}`, `prod-qty-${recetaSopa}`].sort()
    );

    for (const recipeId of [recetaGuiso, recetaSopa]) {
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/prod-qty-${recipeId}`,
        { data: { value: "1", status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    const cierre = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: `${E2E_TAG} guiso y sopa`, status: "COMPLETED" } }
    );
    expect(cierre.ok(), await cierre.text()).toBeTruthy();

    await expect
      .poll(async () => (await findProductionResultsForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(2);

    const resultados = await findProductionResultsForInstance(instanceId);

    // 1. Cada receta consume lo que dice SU propia línea de sub-receta.
    const consumoPorReceta = new Map<string, number>();
    for (const r of resultados) {
      const ingredientes = await findProductionIngredients(r.id);
      const total = ingredientes
        .filter((i) => i.item_id === itemIds[0])
        .reduce((s, i) => s + Number(i.actual_quantity), 0);
      consumoPorReceta.set(r.recipe_id, total);
    }

    expect(consumoPorReceta.get(recetaGuiso), "Guiso = 2 × Base").toBe(2);
    expect(consumoPorReceta.get(recetaSopa), "Sopa = 5 × Base").toBe(5);

    // 2. Y el lote refleja el consumo real. Esta aserción no depende del orden
    //    en que se expandieron las recetas: con el cache envenenado el total es
    //    4 o 10 según cuál ganó, nunca 7.
    const restante = await findBatchQuantity(batchId);
    expect(
      STOCK_HARINA - restante,
      "el consumo total de harina no corresponde a 2 + 5"
    ).toBe(CONSUMO_ESPERADO);
  });
});
