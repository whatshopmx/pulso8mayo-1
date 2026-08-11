import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, E2E_TAG } from "./support/constants";
import {
  cleanupMerma,
  createTestSkus,
  deleteTestSkus,
  deleteWasteForItems,
  findWasteForInstance,
  getInstanceData,
  seedMermaTemplate,
} from "./support/db";

/**
 * Fase 3 — Merma manual desde workflow (T13).
 *
 * Un template de merma exige motivo + foto por SKU; la instancia NO se
 * completa mientras quede un paso obligatorio (foto) pendiente. Al cerrar,
 * el extractor crea una fila en `inventory_waste` por SKU con el motivo
 * mapeado (OQ-1: `cortesia` → COURTESY) y la traza `instance:{id}`.
 */

const TAG = "e2e-merma-manual";
const CLOSING_STEP = "merma-obs";

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];

/** Extrae el itemId del sufijo UUID del `stepId` (`{parent}-{itemId}`). */
function itemIdOf(stepId: string): string {
  return stepId.slice(-36);
}

const CANTIDADES = ["1", "0.5", "2"];

test.describe("Fase 3 · merma manual", () => {
  test.beforeEach(async () => {
    itemIds = await createTestSkus(COMPANY_ID, CANTIDADES.length, {
      isHighValue: true,
      unit: "KG",
      tags: [TAG],
    });
    templateId = await seedMermaTemplate(COMPANY_ID, TAG, CLOSING_STEP);
  });

  test.afterEach(async () => {
    if (instanceId) await cleanupMerma(instanceId, templateId);
    await deleteWasteForItems(itemIds);
    await deleteTestSkus();
    instanceId = "";
  });

  test("motivo y foto son obligatorios: sin la foto la instancia no cierra; al cerrar se persiste la merma", async ({
    page,
  }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    // 1. Cantidad + motivo por SKU, pero SIN la foto de evidencia.
    const subPasos = await page.request
      .get(`/api/workflows/executions/${instanceId}`)
      .then(async (r) => (await r.json()).steps as { step_id?: string; stepId?: string; status: string }[]);

    const qtySteps = subPasos.filter((s) => s.stepId?.startsWith("merma-qty-"));
    const reasonSteps = subPasos.filter((s) => s.stepId?.startsWith("merma-reason-"));

    expect(qtySteps).toHaveLength(itemIds.length);
    expect(reasonSteps).toHaveLength(itemIds.length);

    for (const paso of qtySteps) {
      const itemId = itemIdOf(paso.stepId as string);
      const cantidad = CANTIDADES[itemIds.indexOf(itemId)];
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${paso.stepId}`,
        { data: { value: cantidad, status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    for (const paso of reasonSteps) {
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${paso.stepId}`,
        { data: { value: "caducidad", status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    // La foto de evidencia sigue pendiente → el flujo no puede cerrar.
    const pending = (await page.request.get(`/api/workflows/executions/${instanceId}`).then((r) => r.json()))
      .steps as { stepId: string; status: string }[];
    expect(pending.some((s) => s.stepId?.startsWith("merma-evidence-") && s.status === "PENDING")).toBe(true);

    // Intentar cerrar el paso final de todos modos no completa la instancia.
    const cierre = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`,
      { data: { value: `${E2E_TAG} sin foto`, status: "COMPLETED" } }
    );
    expect(cierre.ok(), await cierre.text()).toBeTruthy();
    const data = await getInstanceData(instanceId);
    expect(data.status).toBe("IN_PROGRESS");

    // 2. Con la foto, sí cierra y persiste la merma.
    const evidenceSteps = pending.filter((s) => s.stepId?.startsWith("merma-evidence-"));
    for (const paso of evidenceSteps) {
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${paso.stepId}`,
        { data: { value: "https://example.test/e2e/merma.jpg", status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    await expect
      .poll(async () => (await getInstanceData(instanceId))?.status, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe("COMPLETED");

    // 3. Una fila de merma por SKU, con motivo mapeado y traza de la instancia.
    await expect
      .poll(async () => (await findWasteForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(itemIds.length);

    const rows = await findWasteForInstance(instanceId);
    const reasonByItem = new Map(rows.map((r) => [r.item_id, r.reason]));
    for (const itemId of itemIds) {
      expect(reasonByItem.get(itemId)).toBe("EXPIRED"); // caducidad → EXPIRED
    }
    for (const row of rows) {
      expect(row.company_id).toBe(COMPANY_ID);
      expect(row.branch_id).toBe(BRANCH_POLANCO);
      expect(row.notes).toContain(`instance:${instanceId}`);
      expect(row.recorded_by).toBeTruthy();
    }
  });

  test("cortesía se registra como COURTESY (consumo, no merma)", async ({ page }) => {
    const creada = await page.request.post("/api/workflows/execute", {
      data: { templateId, branchId: BRANCH_POLANCO },
    });
    expect(creada.ok(), await creada.text()).toBeTruthy();
    instanceId = (await creada.json()).id;

    // Completa TODO: cantidad, motivo=cortesia en el primer SKU y foto.
    const instance = await page.request
      .get(`/api/workflows/executions/${instanceId}`)
      .then((r) => r.json());
    const steps = instance.steps as { stepId: string; status: string }[];

    const qtySteps = steps.filter((s) => s.stepId?.startsWith("merma-qty-"));
    const evidenceSteps = steps.filter((s) => s.stepId?.startsWith("merma-evidence-"));

    // Los pasos se devuelven ordenados por `completedAt, id` (UUID aleatorio),
    // así que NO se puede asumir que el índice de la lista coincida con
    // `itemIds`. Se parchea por stepId explícito (`merma-*-{itemId}`).
    for (const itemId of itemIds) {
      const qtyIdx = itemIds.indexOf(itemId);
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/merma-qty-${itemId}`,
        { data: { value: CANTIDADES[qtyIdx] ?? "1", status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    for (const itemId of itemIds) {
      // El primer SKU es cortesía; el resto caducidad.
      const reason = itemId === itemIds[0] ? "cortesia" : "caducidad";
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/merma-reason-${itemId}`,
        { data: { value: reason, status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    for (const paso of evidenceSteps) {
      await page.request.patch(`/api/workflows/executions/${instanceId}/steps/${paso.stepId}`, {
        data: { value: "https://example.test/e2e/merma.jpg", status: "COMPLETED" },
      });
    }
    await page.request.patch(`/api/workflows/executions/${instanceId}/steps/${CLOSING_STEP}`, {
      data: { value: `${E2E_TAG} cortesía`, status: "COMPLETED" },
    });

    await expect
      .poll(async () => (await findWasteForInstance(instanceId)).length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(itemIds.length);

    const rows = await findWasteForInstance(instanceId);
    const reasonByItem = new Map(rows.map((r) => [r.item_id, r.reason]));
    // El primer item (orden de steps = orden de items por nombre; el map
    // respeta el orden de inserción de los ítems creados) es el de cortesía.
    expect(reasonByItem.get(itemIds[0])).toBe("COURTESY");
  });
});