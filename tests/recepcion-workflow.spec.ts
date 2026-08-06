import { test, expect } from "@playwright/test";
import { BRANCH_POLANCO, COMPANY_ID, E2E_TAG, USER_SUPER_ADMIN } from "./support/constants";
import {
  cleanupRecepcion,
  findReceivingReportForInstance,
  firstSupplierName,
  seedRecepcionInstance,
} from "./support/db";

/**
 * Fase 5 — Workflow de recepción ⇒ `receiving_reports`.
 *
 * Escenario del plan: al completar una instancia de `tpl-recepcion-mercancia-v2`
 * con discrepancias, el enganche debe generar el reporte de recepción con el
 * proveedor resuelto, la evidencia y la nota de discrepancia.
 */

const DISCREPANCIA = `${E2E_TAG} Faltan 2 cajas de 10 pedidas; una llegó abierta`;
const ULTIMO_PASO = "paso-12";

let instanceId: string;

test.describe("Fase 5 · recepción desde workflow", () => {
  test.afterEach(async () => {
    if (instanceId) await cleanupRecepcion(instanceId);
  });

  test("al completar el workflow se crea el reporte con la discrepancia", async ({ page }) => {
    const proveedor = await firstSupplierName(COMPANY_ID);
    expect(proveedor, "la base de desarrollo necesita proveedores sembrados").toBeTruthy();

    instanceId = await seedRecepcionInstance({
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      supplierName: proveedor!,
      discrepancia: DISCREPANCIA,
      ultimoPasoPendiente: ULTIMO_PASO,
    });

    // Aún no debe existir reporte.
    expect(await findReceivingReportForInstance(instanceId)).toBeNull();

    // Cerrar el último paso: dispara la ruta de completado del workflow.
    const res = await page.request.patch(
      `/api/workflows/executions/${instanceId}/steps/${ULTIMO_PASO}`,
      { data: { value: "si", status: "COMPLETED" } }
    );
    expect(res.ok(), await res.text()).toBeTruthy();

    // La extracción es fire-and-forget: se espera a que aparezca el reporte.
    await expect
      .poll(async () => (await findReceivingReportForInstance(instanceId)) !== null, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(true);

    const reporte = await findReceivingReportForInstance(instanceId);
    expect(reporte.branch_id).toBe(BRANCH_POLANCO);
    expect(reporte.notes).toContain(`instance:${instanceId}`);
    expect(reporte.notes).toContain("Discrepancias:");
    expect(reporte.notes).toContain(DISCREPANCIA);
    expect(reporte.notes).toContain("Decisión:");

    // Proveedor resuelto por nombre y evidencia recolectada de los pasos foto.
    expect(reporte.supplier_id).toBeTruthy();
    expect(Array.isArray(reporte.photo_urls)).toBe(true);
    expect(reporte.photo_urls.length).toBeGreaterThan(0);
  });

  test("es idempotente: completar de nuevo no duplica el reporte", async ({ page }) => {
    const proveedor = await firstSupplierName(COMPANY_ID);
    instanceId = await seedRecepcionInstance({
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      supplierName: proveedor!,
      discrepancia: DISCREPANCIA,
      ultimoPasoPendiente: ULTIMO_PASO,
    });

    for (let i = 0; i < 2; i++) {
      const res = await page.request.patch(
        `/api/workflows/executions/${instanceId}/steps/${ULTIMO_PASO}`,
        { data: { value: "si", status: "COMPLETED" } }
      );
      expect(res.ok(), await res.text()).toBeTruthy();
      await page.waitForTimeout(2000);
    }

    await expect
      .poll(async () => (await findReceivingReportForInstance(instanceId)) !== null, {
        timeout: 30_000,
      })
      .toBe(true);

    const { sql } = await import("./support/db");
    const rows = await sql`
      SELECT COUNT(*)::int AS n FROM receiving_reports
      WHERE notes LIKE ${`%instance:${instanceId}%`}
    `;
    expect(rows[0].n).toBe(1);
  });
});
