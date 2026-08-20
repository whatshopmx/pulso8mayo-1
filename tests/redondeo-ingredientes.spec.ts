import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
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
  seedCompletedProductionInstance,
  seedProductionTemplate,
  seedRecipe,
  seedRecipeItem,
} from "./support/db";
import { extractProductionFromInstance } from "../lib/services/production-from-workflow";

/**
 * Auditoría A7 — O-5: `production_ingredients` guarda cantidades en `integer`.
 *
 * `expected_quantity` y `actual_quantity` son `integer`, mientras el lote
 * (`inventory_batches.current_quantity`) es `numeric(12,4)` desde la migración
 * `0051` y `total_cost` se calcula con la cantidad exacta. En una receta
 * mexicana la mayoría de las líneas son fraccionarias —0.35 kg de queso, 0.02 L
 * de aceite— así que la columna no puede representar lo que de verdad se
 * consumió.
 *
 * ⚠️ **Corrección a O-5 tal como estaba escrita.** El plan asumía que el defecto
 * era silencioso ("todo insumo bajo 0.5 registra 0"). No es así: Postgres NO
 * redondea al insertar, rechaza el valor — `invalid input syntax for type
 * integer: "0.35"`. Como el insert va dentro de la transacción del extractor,
 * **se cae la producción entera**: sin `production_results`, sin descuento de
 * lote y —tras A2— con la corrida de Inngest en FALLIDA tras agotar reintentos.
 *
 * Son TRES columnas `integer` las que reciben fracciones en esta ruta, y el
 * caso 1 las recorre en orden al ir poniéndose verde:
 *   1. `production_results.ingredient_cost` — la suma `unit_cost × cantidad`
 *      exacta (aquí 431.9). Es la primera que revienta.
 *   2. `production_ingredients.total_cost` — el mismo cálculo por fila.
 *   3. `production_ingredients.expected_quantity` — 0.35 tal cual; el que el
 *      plan tenía en la mira. (`actual_quantity` no revienta porque
 *      `production-service.ts:150` ya la redondea a 0 explícitamente: es
 *      exactamente la fila "consumió 0 kg, costó $12.34" que describe O-5.)
 *
 * Las dos primeras son costos en centavos y se resuelven redondeando; la
 * tercera es la que exige migrar a `numeric(12,4)`.
 *
 * Eso reordena la severidad: el daño no es una fila con la cantidad mal, es la
 * pérdida completa del registro de producción. Y explica por qué la firma que
 * A7 mandaba contar (`actual_quantity = 0` con `total_cost > 0`) da cero filas:
 * cuando la cantidad de la receta es fraccionaria el insert nunca llega a
 * ocurrir.
 *
 * El redondeo silencioso sí existe, pero por otra vía: el caso 2. Si la receta
 * pide una cantidad entera y FEFO la reparte en fracciones entre dos lotes,
 * `expected_quantity` viaja entero, `Math.round` (`production-service.ts:150`)
 * ajusta cada `actual_quantity` y el insert pasa — con las cantidades mal.
 *
 * Ambos casos deben estar ROJOS contra el código actual y verdes tras A7b
 * (`numeric(12,4)` + retirar el `Math.round`).
 *
 * Se llama al extractor directo, como `conteo-fecha-local.spec.ts`: lo que se
 * mide es lo que el extractor ESCRIBE, así que no hacen falta ni el servidor ni
 * el dev server de Inngest.
 */

const TAG = "e2e-redondeo";

/** Receta fraccionaria del caso 1: 0.35 kg por porción. */
const CANTIDAD_FRACCIONARIA = 0.35;
/** Centavos por kg del lote del caso 1 ($12.34). */
const COSTO_KG = 1234;
/**
 * 1234 × 0.35 = 431.9 centavos → 432. `total_cost` es `integer` y **se queda
 * así**: el centavo es la unidad mínima real y no hay medio centavo que guardar.
 * Se fija aquí porque A7b tiene que redondear el costo al mismo tiempo que deja
 * de redondear la cantidad; si sólo migra las columnas de cantidad, el insert
 * vuelve a caerse por el costo fraccionario.
 */
const COSTO_ESPERADO = 432;
const STOCK_CASO_1 = 10;

/** Caso 2: la receta pide 2 kg enteros… */
const CANTIDAD_ENTERA = 2;
/** …pero el lote más viejo sólo tiene medio kg, así que FEFO parte 0.5 + 1.5. */
const STOCK_LOTE_VIEJO = 0.5;
const STOCK_LOTE_NUEVO = 10;
const COSTO_KG_CASO_2 = 100;

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];
let batchIds: string[] = [];

test.describe("Auditoría A7 · cantidades fraccionarias de insumo", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: "KG", tags: [] });
    templateId = await seedProductionTemplate(COMPANY_ID, TAG);
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

  test("una receta de 0.35 kg registra 0.35, no 0 ni un error de la base", async () => {
    const recipeId = await seedRecipe(COMPANY_ID, "Salsa fraccionaria", {
      unit: "PORTION",
      tags: [TAG],
    });
    await seedRecipeItem({
      recipeId,
      itemId: itemIds[0],
      quantity: CANTIDAD_FRACCIONARIA,
      unit: "KG",
    });

    batchIds.push(
      await seedBatch({
        companyId: COMPANY_ID,
        branchId: BRANCH_POLANCO,
        itemId: itemIds[0],
        quantity: STOCK_CASO_1,
        unitCostCents: COSTO_KG,
      })
    );

    instanceId = await seedCompletedProductionInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      portions: [{ recipeId, quantity: 1 }],
    });

    // Hoy esta llamada LANZA —hoy por `ingredient_cost` = 431.9, y al arreglar
    // los costos por `expected_quantity` = 0.35— y no llega a escribir nada:
    // ése es el rojo.
    await extractProductionFromInstance(instanceId);

    const resultados = await findProductionResultsForInstance(instanceId);
    expect(resultados, "la producción no se registró").toHaveLength(1);

    const ingredientes = await findProductionIngredients(resultados[0].id);
    expect(ingredientes).toHaveLength(1);

    const fila = ingredientes[0];
    expect(Number(fila.expected_quantity), "expected_quantity perdió la fracción").toBe(
      CANTIDAD_FRACCIONARIA
    );
    expect(Number(fila.actual_quantity), "actual_quantity perdió la fracción").toBe(
      CANTIDAD_FRACCIONARIA
    );

    // El costo ya se calculaba con el valor exacto: es la incoherencia que
    // deja la fila diciendo "consumió 0 kg, costó $12.34".
    expect(Number(fila.total_cost)).toBe(COSTO_ESPERADO);

    // Y el lote se descuenta exacto desde la migración `0051`.
    expect(await findBatchQuantity(batchIds[0])).toBeCloseTo(
      STOCK_CASO_1 - CANTIDAD_FRACCIONARIA,
      4
    );
  });

  test("una receta entera repartida por FEFO entre dos lotes no infla lo consumido", async () => {
    const recipeId = await seedRecipe(COMPANY_ID, "Guiso entero", {
      unit: "PORTION",
      tags: [TAG],
    });
    await seedRecipeItem({
      recipeId,
      itemId: itemIds[0],
      quantity: CANTIDAD_ENTERA,
      unit: "KG",
    });

    // El lote que caduca antes es el de medio kg: FEFO lo agota primero.
    batchIds.push(
      await seedBatch({
        companyId: COMPANY_ID,
        branchId: BRANCH_POLANCO,
        itemId: itemIds[0],
        quantity: STOCK_LOTE_VIEJO,
        unitCostCents: COSTO_KG_CASO_2,
        expirationDate: "2026-01-01",
      }),
      await seedBatch({
        companyId: COMPANY_ID,
        branchId: BRANCH_POLANCO,
        itemId: itemIds[0],
        quantity: STOCK_LOTE_NUEVO,
        unitCostCents: COSTO_KG_CASO_2,
        expirationDate: "2026-12-31",
      })
    );

    instanceId = await seedCompletedProductionInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      portions: [{ recipeId, quantity: 1 }],
    });

    // Aquí el insert SÍ pasa: `expected_quantity` es entero y los costos caen
    // en centavos exactos. Lo que queda mal escrito son las cantidades.
    await extractProductionFromInstance(instanceId);

    const resultados = await findProductionResultsForInstance(instanceId);
    expect(resultados).toHaveLength(1);

    const ingredientes = await findProductionIngredients(resultados[0].id);
    expect(ingredientes, "un registro por lote asignado").toHaveLength(2);

    const porLote = new Map(ingredientes.map((i) => [i.batch_id, i]));
    expect(Number(porLote.get(batchIds[0])?.actual_quantity), "el lote viejo aportó 0.5").toBe(
      STOCK_LOTE_VIEJO
    );
    expect(Number(porLote.get(batchIds[1])?.actual_quantity), "el lote nuevo aportó 1.5").toBe(
      CANTIDAD_ENTERA - STOCK_LOTE_VIEJO
    );

    // La suma de lo registrado tiene que ser lo que la receta pidió. Con
    // `Math.round` hoy da 3 (1 + 2) para un consumo real de 2: la producción
    // aparenta haber gastado 50 % más insumo del que salió del inventario.
    const registrado = ingredientes.reduce((s, i) => s + Number(i.actual_quantity), 0);
    expect(registrado, "lo registrado no cuadra con lo que se descontó").toBe(CANTIDAD_ENTERA);

    // Los lotes sí bajaron exacto: 0.5 → 0 y 10 → 8.5.
    expect(await findBatchQuantity(batchIds[0])).toBeCloseTo(0, 4);
    expect(await findBatchQuantity(batchIds[1])).toBeCloseTo(
      STOCK_LOTE_NUEVO - (CANTIDAD_ENTERA - STOCK_LOTE_VIEJO),
      4
    );

    // `expected_quantity` es la necesidad de la RECETA, repetida en cada fila
    // de lote — no se reparte. Se fija tal cual para que A7b no lo cambie de
    // paso: rediseñar esa semántica está fuera del alcance de la auditoría.
    for (const fila of ingredientes) {
      expect(Number(fila.expected_quantity)).toBe(CANTIDAD_ENTERA);
    }
  });
});
