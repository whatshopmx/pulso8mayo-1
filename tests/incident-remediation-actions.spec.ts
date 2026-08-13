import { test, expect } from "@playwright/test";
import { BRANCH_CONDESA, COMPANY_ID } from "./support/constants";
import {
  cleanupIncidentRemediation,
  findRemediationAction,
  findScheduleById,
  seedIncidentWithRemediationAction,
  seedIncidentWithSelfFixProtocol,
} from "./support/db";

/**
 * Acciones de remediación contextuales en el detalle del incidente.
 *
 * Hasta ahora la única puerta de entrada al circuito de remediación externa era
 * la tarjeta del dashboard: un gerente que abría un incidente en
 * `AWAITING_EXTERNAL` veía un wizard pidiéndole evidencia de texto para un paso
 * que en realidad requiere agendar a un proveedor.
 *
 * Corre serial contra la base de dev como el resto de specs; siembra por SQL
 * directo con el tag `[E2E]` y limpia todo en `afterAll`.
 */

/** Fecha futura en formato yyyy-mm-dd para el input `date` del diálogo. */
function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split("T")[0];
}

test.describe.configure({ mode: "serial" });

test.describe("Remediación externa desde el detalle del incidente", () => {
  test.afterAll(async () => {
    await cleanupIncidentRemediation();
  });

  test("un incidente AWAITING_EXTERNAL muestra el panel con CTA de confirmar visita", async ({ page }) => {
    const { incidentId } = await seedIncidentWithRemediationAction({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
    });

    await page.goto(`/dashboard/incidents/${incidentId}`);

    const panel = page.getByText("Acción recomendada");
    await expect(panel).toBeVisible();

    // La recomendación explica su base: sin rationale sería una orden opaca.
    await expect(
      page.getByText(/acción de remediación externa pendiente/i)
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /confirmar visita/i })
    ).toBeVisible();

    // AD-5: el wizard de self-fix NO debe aparecer en AWAITING_EXTERNAL.
    await expect(page.getByText("Protocolo de remediación")).toHaveCount(0);

    await cleanupIncidentRemediation();
  });

  test("confirmar la visita crea el workflowSchedule y el panel pasa a programado", async ({ page }) => {
    const { incidentId, actionId } = await seedIncidentWithRemediationAction({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
    });

    await page.goto(`/dashboard/incidents/${incidentId}`);

    await page.getByRole("button", { name: /confirmar visita/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // El typo "Proveedor Extero" se corrigió al mudar el diálogo a incidents/.
    await expect(dialog.getByText(/Proveedor Externo/i)).toBeVisible();

    await dialog.locator('input[type="date"]').fill(futureDate(7));
    await dialog.locator('input[type="time"]').fill("10:00");
    await dialog
      .getByRole("button", { name: /confirmar y programar workflow/i })
      .click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // La acción quedó CONFIRMED y con su schedule.
    await expect
      .poll(async () => (await findRemediationAction(actionId))?.status, {
        timeout: 15_000,
      })
      .toBe("CONFIRMED");

    const action = await findRemediationAction(actionId);
    expect(action?.scheduleId).toBeTruthy();

    const schedule = await findScheduleById(action!.scheduleId!);
    expect(schedule).not.toBeNull();
    expect(schedule?.frequency).toBe("ONCE");
    expect(schedule?.branchId).toBe(BRANCH_CONDESA);

    // Y el panel ya no pide nada: pasa a informativo.
    await expect(page.getByText(/programada para el/i)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /confirmar visita/i })
    ).toHaveCount(0);

    await cleanupIncidentRemediation();
  });

  test("un incidente con protocolo self-fix sigue mostrando el wizard, no el panel externo", async ({ page }) => {
    const incidentId = await seedIncidentWithSelfFixProtocol({
      branchId: BRANCH_CONDESA,
    });

    await page.goto(`/dashboard/incidents/${incidentId}`);

    // El panel recomienda ejecutar el paso, y el wizard aparece con él.
    await expect(page.getByText("Acción recomendada")).toBeVisible();
    await expect(page.getByText(/Ejecutar: Ajustar el termostato/i)).toBeVisible();
    await expect(page.getByText("Protocolo de remediación")).toBeVisible({
      timeout: 15_000,
    });

    // No hay CTA de servicio externo en un incidente self-fix.
    await expect(
      page.getByRole("button", { name: /confirmar visita/i })
    ).toHaveCount(0);

    await cleanupIncidentRemediation();
  });
});
