import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, E2E_TAG } from "./support/constants";
import {
  cleanupStockCounts,
  createTestSkus,
  deleteStockCountsForItems,
  deleteTestSkus,
  findCountStepsForInstance,
  findStockCountsForInstance,
  seedDynamicCountTemplate,
} from "./support/db";

/**
 * Fase 1 — Conteo dinámico ⇒ `stock_counts`.
 *
 * Cubre las tres afirmaciones del plan (T6):
 *   1. Un paso con `metadata.dynamicSource` se expande a N sub-pasos, uno por
 *      SKU de alto valor con la etiqueta pedida.
 *   2. Al completar la instancia hay N filas en `stock_counts`, con la cantidad
 *      SIN truncar (contar 2.5 kg guarda 2.5000, no 2).
 *   3. Completar dos veces no duplica filas.
 */

const TAG = "e2e-conteo-dinamico";
const CLOSING_STEP = "confirmar";
/** Una cantidad fraccionaria: es lo que el bug de `parseInt` truncaba. */
const CANTIDADES = ["2.5", "7", "0.25"];

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];

/** Extrae el itemId del sufijo UUID del `stepId` (`count-{itemId}`). */
function itemIdOf(stepId: string): string {
  return stepId.slice(-36);
}

test.describe("Fase 1 · conteo dinámico", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, CANTIDADES.length, {
      isHighValue: true,
      unit: "KG",
      tags: [TAG],
    });
    templateId = await seedDynamicCountTemplate(COMPANY_ID, TAG, CLOSING_STEP);
  });

  test.afterEach(async () => {
    if (instanceId) await cleanupStockCounts(instanceId, templateId);
    await deleteStockCountsForItems(itemIds);
    await deleteTestSkus();
    instanceId = "";
  });

  test("el paso dinámico genera un sub-paso por SKU y persiste los conteos sin truncar", async ({
    page,
  }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;
    expect(instanceId).toBeTruthy();

    // 1. N sub-pasos, uno por SKU de alto valor etiquetado.
    const subPasos = await findCountStepsForInstance(instanceId);
    expect(subPasos).toHaveLength(itemIds.length);
    expect(new Set(subPasos.map((s) => itemIdOf(s.step_id)))).toEqual(new Set(itemIds));

    // Ningún conteo antes de completar.
    expect(await findStockCountsForInstance(instanceId)).toHaveLength(0);

    // 2. Capturar cada sub-paso; la cantidad se asigna por posición del ítem.
    const esperado = new Map<string, string>();
    for (const paso of subPasos) {
      const itemId = itemIdOf(paso.step_id);
      const cantidad = CANTIDADES[itemIds.indexOf(itemId)];
      esperado.set(itemId, cantidad);

      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${paso.step_id}`,
        { data: { value: cantidad, status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    // Cerrar el último paso: dispara el completado de la instancia.
    const cierre = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: `${E2E_TAG} sin novedades`, status: "COMPLETED" } }
    );
    expect(cierre.ok(), await cierre.text()).toBeTruthy();

    // La extracción es fire-and-forget.
    await expect
      .poll(async () => (await findStockCountsForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(itemIds.length);

    const conteos = await findStockCountsForInstance(instanceId);
    for (const fila of conteos) {
      expect(fila.company_id).toBe(COMPANY_ID);
      expect(fila.branch_id).toBe(BRANCH_POLANCO);
      // numeric(12,4): 2.5 se guarda como "2.5000", nunca como 2.
      expect(Number(fila.counted_quantity)).toBeCloseTo(
        Number(esperado.get(fila.item_id)),
        4
      );
      // SKUs recién creados, sin lotes: el sistema creía tener 0.
      expect(Number(fila.system_quantity)).toBe(0);
      expect(fila.count_date).toBeTruthy();
    }

    // El caso que motivó T5: 2.5 no puede haberse guardado como 2.
    const fraccionario = conteos.find((f) => f.item_id === itemIds[0]);
    expect(Number(fraccionario?.counted_quantity)).toBe(2.5);
  });

  test("completar dos veces no duplica los conteos", async ({ page }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    const subPasos = await findCountStepsForInstance(instanceId);
    for (const paso of subPasos) {
      const cantidad = CANTIDADES[itemIds.indexOf(itemIdOf(paso.step_id))];
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${paso.step_id}`,
        { data: { value: cantidad, status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    // Cerrar dos veces el mismo paso final: la instancia se completa dos veces.
    for (let i = 0; i < 2; i++) {
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
        { data: { value: `${E2E_TAG} cierre ${i}`, status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
      await page.waitForTimeout(2000);
    }

    await expect
      .poll(async () => (await findStockCountsForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(itemIds.length);

    // Y sigue siendo N pasados unos segundos más: el único parcial actualiza,
    // no inserta una segunda fila por ítem.
    await page.waitForTimeout(3000);
    expect(await findStockCountsForInstance(instanceId)).toHaveLength(itemIds.length);
  });
});
