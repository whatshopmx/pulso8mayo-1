import { test, expect, type Page } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID } from "./support/constants";
import {
  cleanupMerma,
  cleanupStockCounts,
  createTestSkus,
  deleteBatch,
  deleteStockCountsForItems,
  deleteTestSkus,
  deleteWasteForItems,
  findStockCountsForInstance,
  findCountStepsForInstance,
  findWasteForInstance,
  seedBatch,
  seedDynamicCountTemplate,
  setMermaThreshold,
  getMermaThreshold,
  restoreMermaThreshold,
} from "./support/db";

/**
 * Fase 3 — Merma automática por varianza de conteo (T12/T13).
 *
 * Al completar un conteo, el extractor compara lo contado contra lo calculado:
 * si el FALTANTE supera el umbral del tenant (default 5%), crea una fila en
 * `inventory_waste` con reason OTHER y origen `diferencia_conteo`. El sobrante
 * nunca genera merma, y la varianza dentro de tolerancia tampoco.
 *
 * El umbral vive en `tenant_operating_config.merma_variance_threshold_pct`
 * (T11): subirlo hace que la misma diferencia deje de disparar.
 */

const TAG = "e2e-merma-auto";
/** El conteo clásico cierra este paso con value "yes". */
const CLOSING_STEP = "confirmar";

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];
let batchIds: string[] = [];
let thresholdCambiado = false;
let thresholdPrevio: string | null = null;

function itemIdOf(stepId: string): string {
  return stepId.slice(-36);
}

test.describe("Fase 3 · merma automática por varianza", () => {
  test.beforeEach(async () => {
    // 3 SKUs de alto valor, cada uno con un lote de 10 unidades (calculado=10).
    itemIds = await createTestSkus(COMPANY_ID, 3, { isHighValue: true, unit: "KG", tags: [TAG] });
    for (const id of itemIds) {
      batchIds.push(
        await seedBatch({ companyId: COMPANY_ID, branchId: BRANCH_POLANCO, itemId: id, quantity: 10 })
      );
    }
    templateId = await seedDynamicCountTemplate(COMPANY_ID, TAG, CLOSING_STEP);
  });

  test.afterEach(async () => {
    if (instanceId) await cleanupStockCounts(instanceId, templateId);
    await cleanupMerma(instanceId);
    for (const b of batchIds) await deleteBatch(b);
    await deleteStockCountsForItems(itemIds);
    await deleteWasteForItems(itemIds);
    await deleteTestSkus();
    if (thresholdCambiado) {
      await restoreMermaThreshold(COMPANY_ID, thresholdPrevio);
      thresholdCambiado = false;
      thresholdPrevio = null;
    }
    instanceId = "";
    batchIds = [];
  });

  async function probarConteo(page: Page, cantidades: Record<string, string>) {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    const subPasos = await findCountStepsForInstance(instanceId);
    for (const paso of subPasos) {
      const itemId = itemIdOf(paso.step_id);
      const cantidad = cantidades[itemId];
      expect(cantidad, `falta cantidad para ${itemId}`).toBeTruthy();
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${paso.step_id}`,
        { data: { value: cantidad, status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    const cierre = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: "yes", status: "COMPLETED" } }
    );
    expect(cierre.ok(), await cierre.text()).toBeTruthy();

    await expect
      .poll(async () => (await findStockCountsForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(itemIds.length);
  }

  test("el faltante sobre el umbral genera merma; el sobrante y el exacto no", async ({ page }) => {
    // item0: contado 8 de 10 → −20% → merma. item1: 10 de 10 → 0%. item2: 13 → sobrante.
    const cantidades: Record<string, string> = {
      [itemIds[0]]: "8",
      [itemIds[1]]: "10",
      [itemIds[2]]: "13",
    };

    await probarConteo(page, cantidades);

    await expect
      .poll(async () => (await findWasteForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(1);

    const rows = await findWasteForInstance(instanceId);
    expect(rows[0].item_id).toBe(itemIds[0]);
    expect(rows[0].reason).toBe("OTHER");
    expect(rows[0].quantity).toBe(2); // 10 − 8
    expect(rows[0].notes).toContain("origen=diferencia_conteo");
    expect(rows[0].company_id).toBe(COMPANY_ID);

    // Idempotencia: reprocesar la instancia no duplica la merma.
    await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: "yes", status: "COMPLETED" } }
    );
    await page.waitForTimeout(2500);
    expect(await findWasteForInstance(instanceId)).toHaveLength(1);
  });

  test("la misma varianza deja de generar merma si se sube el umbral", async ({ page }) => {
    // Captura el valor previo para restaurarlo en afterEach (base compartida).
    thresholdPrevio = await getMermaThreshold(COMPANY_ID);
    thresholdCambiado = true;
    // Umbral al 50%: el −20% queda dentro de tolerancia.
    await setMermaThreshold(COMPANY_ID, 50);

    const cantidades: Record<string, string> = {
      [itemIds[0]]: "8",
      [itemIds[1]]: "10",
      [itemIds[2]]: "13",
    };

    await probarConteo(page, cantidades);

    // Se deja un margen para que el extractor (fire-and-forget) hubiera tenido
    // oportunidad de insertar si el umbral no se respetara.
    await page.waitForTimeout(4000);
    expect(await findWasteForInstance(instanceId)).toHaveLength(0);
  });
});