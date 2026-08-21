import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
import {
  cleanupMerma,
  cleanupProduction,
  cleanupStockCounts,
  createTestSkus,
  deleteBatch,
  deleteStockCountsForItems,
  deleteTestRecipes,
  deleteTestSkus,
  deleteWasteForItems,
  findBatchQuantity,
  findProductionResultsForInstance,
  findStockCountsForInstance,
  findWasteForInstance,
  getMermaThreshold,
  restoreMermaThreshold,
  seedBatch,
  seedCompletedCountInstance,
  seedCompletedMermaInstance,
  seedCompletedProductionInstance,
  seedDynamicCountTemplate,
  seedMermaTemplate,
  seedProductionTemplate,
  seedRecipe,
  seedRecipeItem,
  setMermaThreshold,
} from "./support/db";
import { extractProductionFromInstance } from "../lib/services/production-from-workflow";
import { extractMermaFromInstance } from "../lib/services/merma-from-workflow";
import { extractStockCountFromInstance } from "../lib/services/stock-count-from-workflow";

/**
 * Auditoría A8 — O-4: la idempotencia de tres de los cuatro extractores es un
 * `SELECT ... WHERE notes LIKE '%instance:{id}%'` seguido de un `INSERT`.
 *
 * AD-4 del plan original prohibió exactamente eso y exigió índice único. Se
 * cumplió en `stock_counts` (que hoy hace `onConflictDoUpdate`) pero no en
 * producción, ni en merma manual, ni en la merma por varianza.
 *
 * El defecto no es el marcador en sí, es que **el chequeo y el insert no son
 * atómicos**: entre uno y otro no hay nada que impida a una segunda ejecución
 * leer el mismo "no existe". Dos ejecuciones simultáneas del mismo extractor
 * pasan las dos y escriben las dos.
 *
 * Y simultáneo no es hipotético aquí: tras A2 el que ejecuta es Inngest, que
 * **reintenta** cada `step.run` hasta 4 veces. Un reintento por timeout —no
 * porque el paso fallara, sino porque tardó— corre contra el intento anterior
 * que sigue vivo. El `id` del `inngest.send` deduplica el EVENTO durante 24 h,
 * no los intentos de un mismo run.
 *
 * Cada caso dispara el mismo extractor dos veces sin esperar entre llamadas
 * (`Promise.all`) y afirma el estado que debe quedar: **una sola tanda de
 * filas**. Los tres deben estar ROJOS contra el código actual y verdes tras A9
 * (columna `workflow_instance_id` + único parcial + `onConflictDoNothing`).
 *
 * El caso de producción es el más caro de los tres: `recordProduction` descuenta
 * lotes, así que duplicar no sólo ensucia el histórico — se lleva por delante el
 * inventario. Por eso además de contar filas se afirma el stock del lote.
 */

const TAG_PRODUCCION = "e2e-idem-produccion";
const TAG_MERMA = "e2e-idem-merma";
const TAG_CONTEO = "e2e-idem-conteo";

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];
let batchIds: string[] = [];

test.describe("Auditoría A8 · idempotencia de los extractores", () => {
  test.afterEach(async () => {
    if (instanceId) {
      await cleanupProduction(instanceId, templateId);
      await cleanupMerma(instanceId);
      await cleanupStockCounts(instanceId);
    }
    for (const b of batchIds) await deleteBatch(b);
    await deleteStockCountsForItems(itemIds);
    await deleteWasteForItems(itemIds);
    await deleteTestRecipes();
    await deleteTestSkus();
    instanceId = "";
    templateId = "";
    itemIds = [];
    batchIds = [];
  });

  test("producción: dos extracciones simultáneas no duplican el resultado ni el descuento del lote", async () => {
    const STOCK = 100;
    const POR_PORCION = 2;
    const PORCIONES = 3;
    const CONSUMO = POR_PORCION * PORCIONES;

    itemIds = await createTestSkus(COMPANY_ID, 1, { unit: "KG", tags: [] });
    batchIds.push(
      await seedBatch({
        companyId: COMPANY_ID,
        branchId: BRANCH_POLANCO,
        itemId: itemIds[0],
        quantity: STOCK,
      })
    );

    const recipeId = await seedRecipe(COMPANY_ID, "Guiso idempotente", {
      unit: "PORTION",
      tags: [TAG_PRODUCCION],
    });
    await seedRecipeItem({
      recipeId,
      itemId: itemIds[0],
      quantity: POR_PORCION,
      unit: "KG",
    });

    templateId = await seedProductionTemplate(COMPANY_ID, TAG_PRODUCCION);
    instanceId = await seedCompletedProductionInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      portions: [{ recipeId, quantity: PORCIONES }],
    });

    // Sin `await` entre una y otra: las dos leen el histórico antes de que
    // ninguna haya escrito, que es justo el hueco del check-then-insert.
    await Promise.all([
      extractProductionFromInstance(instanceId),
      extractProductionFromInstance(instanceId),
    ]);

    // La consecuencia cara va primero: duplicar aquí no sólo ensucia el
    // histórico, se lleva por delante el inventario. Sólo puede fallar si hubo
    // una segunda escritura, así que como señal es más fuerte que contar filas.
    expect(
      await findBatchQuantity(batchIds[0]),
      "el lote se descontó más de una vez"
    ).toBeCloseTo(STOCK - CONSUMO, 4);

    const resultados = await findProductionResultsForInstance(instanceId);
    expect(resultados, "la instancia produjo más de un resultado").toHaveLength(1);
  });

  test("merma manual: dos extracciones simultáneas no duplican las filas de merma", async () => {
    const CANTIDADES = [1, 0.5, 2];

    itemIds = await createTestSkus(COMPANY_ID, CANTIDADES.length, {
      isHighValue: true,
      unit: "KG",
      tags: [TAG_MERMA],
    });

    templateId = await seedMermaTemplate(COMPANY_ID, TAG_MERMA);
    instanceId = await seedCompletedMermaInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      items: itemIds.map((itemId, i) => ({
        itemId,
        quantity: CANTIDADES[i],
        reason: "caducidad",
      })),
    });

    await Promise.all([
      extractMermaFromInstance(instanceId),
      extractMermaFromInstance(instanceId),
    ]);

    const mermas = await findWasteForInstance(instanceId);
    expect(mermas, "una fila de merma por SKU, no dos").toHaveLength(itemIds.length);

    // Y la cantidad total dada de baja es la capturada, no el doble.
    const total = mermas.reduce((s, m) => s + Number(m.quantity), 0);
    expect(total).toBeCloseTo(
      CANTIDADES.reduce((s, q) => s + q, 0),
      4
    );
  });

  test("merma por varianza: dos extracciones simultáneas del conteo no duplican la merma", async () => {
    const STOCK = 10;
    const CONTADO = 1;
    /** Faltante del 90 %: muy por encima del umbral, que se fija explícito. */
    const UMBRAL = 5;

    const umbralPrevio = await getMermaThreshold(COMPANY_ID);
    await setMermaThreshold(COMPANY_ID, UMBRAL);

    try {
      itemIds = await createTestSkus(COMPANY_ID, 2, {
        isHighValue: true,
        unit: "KG",
        tags: [TAG_CONTEO],
      });
      for (const id of itemIds) {
        batchIds.push(
          await seedBatch({
            companyId: COMPANY_ID,
            branchId: BRANCH_POLANCO,
            itemId: id,
            quantity: STOCK,
          })
        );
      }

      templateId = await seedDynamicCountTemplate(COMPANY_ID, TAG_CONTEO);
      instanceId = await seedCompletedCountInstance({
        templateId,
        branchId: BRANCH_POLANCO,
        assigneeId: USER_SUPER_ADMIN,
        completedAt: new Date(),
        counts: itemIds.map((itemId) => ({ itemId, quantity: String(CONTADO) })),
      });

      await Promise.all([
        extractStockCountFromInstance(instanceId),
        extractStockCountFromInstance(instanceId),
      ]);

      // El conteo en sí ya está protegido por índice único + upsert desde el
      // plan original: sirve de contraste, no de defecto.
      const conteos = await findStockCountsForInstance(instanceId);
      expect(conteos, "el conteo sí aguanta la doble extracción").toHaveLength(itemIds.length);

      // La merma por varianza que ese mismo conteo dispara, en cambio, va por
      // el `notes LIKE`.
      const mermas = await findWasteForInstance(instanceId);
      expect(mermas, "una merma por varianza por SKU, no dos").toHaveLength(itemIds.length);

      const total = mermas.reduce((s, m) => s + Number(m.quantity), 0);
      expect(total, "el faltante se registró dos veces").toBeCloseTo(
        (STOCK - CONTADO) * itemIds.length,
        4
      );
    } finally {
      await restoreMermaThreshold(COMPANY_ID, umbralPrevio);
    }
  });
});
