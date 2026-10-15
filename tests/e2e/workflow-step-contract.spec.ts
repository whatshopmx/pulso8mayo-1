import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

// C24: Validación de contrato del paso en cliente y servidor, con servidor de prueba aislado.
const EXECUTION_ID = "inst-00000000-0000-4000-8000-000000000024";
const STEP_ID = "paso-temperatura-camara";

const mockExecution = {
  id: EXECUTION_ID,
  companyId: "company-c24",
  branchId: "branch-c24",
  template: {
    id: "tpl-c24",
    name: "Control de Cámaras Frías NOM-251",
    steps: [
      {
        id: STEP_ID,
        type: "NUMBER",
        title: "Temperatura de Cámara Fría",
        description: "Registra la temperatura en grados Celsius (°C). Límite NOM-251: 2°C a 8°C.",
        required: true,
        evidenceRequired: true,
        validation: { min: 2, max: 8 },
      },
      {
        id: "paso-confirmacion",
        type: "TEXT",
        title: "Observaciones del turno",
        description: "Comentarios finales de la inspección.",
        required: false,
      },
    ],
  },
  steps: [
    {
      id: "step-row-1",
      stepId: STEP_ID,
      status: "PENDING",
      value: null,
      evidenceUrl: null,
    },
    {
      id: "step-row-2",
      stepId: "paso-confirmacion",
      status: "PENDING",
      value: null,
      evidenceUrl: null,
    },
  ],
  blindCount: false,
};

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

test.describe("C24 — Contrato de paso y omisión en cliente", () => {
  test("muestra en toast el mensaje de rechazo cuando el servidor devuelve 400 por valor fuera de rango", async ({ page }) => {
    let capturedPatch: any = null;

    await page.addInitScript((exec) => {
      (window as any).__executionPrueba = exec;
    }, mockExecution);

    await page.route(`**/api/workflows/executions/${EXECUTION_ID}/steps/${STEP_ID}`, async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        capturedPatch = request.postDataJSON();
        return route.fulfill({
          status: 400,
          json: {
            error: "El valor numérico no puede ser mayor que 8.",
            code: "VALUE_OUT_OF_BOUNDS",
          },
        });
      }
      return route.fulfill({ status: 200, json: {} });
    });

    await page.goto(`${harness.url}/workflow`);
    await expect(page.getByText("Paso 1 de 2")).toBeVisible();

    // Llenar el input con valor 15.5
    const input = page.locator('input[type="number"]');
    await input.fill("15.5");

    // Click en Siguiente
    await page.getByRole("button", { name: "Siguiente" }).click();

    // Debe mostrarse el error exacto del servidor en el toast
    await expect(page.getByText("El valor numérico no puede ser mayor que 8.")).toBeVisible();
    expect(capturedPatch).toMatchObject({
      status: "COMPLETED",
      value: "15.5",
    });
  });

  test("permite omitir paso con justificación y envía status SKIPPED a la API", async ({ page }) => {
    let capturedPatch: any = null;

    await page.addInitScript((exec) => {
      (window as any).__executionPrueba = exec;
    }, mockExecution);

    await page.route(`**/api/workflows/executions/${EXECUTION_ID}/steps/${STEP_ID}`, async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        capturedPatch = request.postDataJSON();
        return route.fulfill({
          status: 200,
          json: {
            step: { id: "step-row-1", status: "SKIPPED", comment: capturedPatch.comment },
          },
        });
      }
      return route.fulfill({ status: 200, json: {} });
    });

    await page.goto(`${harness.url}/workflow`);
    await expect(page.getByText("Paso 1 de 2")).toBeVisible();

    // Click en Omitir paso
    await page.getByRole("button", { name: "Omitir paso" }).click();

    // Diálogo debe estar visible explicando que es requerido
    await expect(page.getByText("Este paso es obligatorio")).toBeVisible();

    // Llenar la justificación
    const textarea = page.locator("#skip-justification");
    await textarea.fill("Termómetro en calibración técnica anual NOM-251");

    // Confirmar omisión
    await page.getByRole("button", { name: "Confirmar omisión" }).click();

    // Toast de éxito y envío correcto
    await expect(page.getByText("Paso omitido exitosamente")).toBeVisible();
    expect(capturedPatch).toEqual({
      status: "SKIPPED",
      comment: "Termómetro en calibración técnica anual NOM-251",
    });
  });

  test("muestra rechazo 403 si un operador no autorizado intenta omitir paso obligatorio", async ({ page }) => {
    await page.addInitScript((exec) => {
      (window as any).__executionPrueba = exec;
    }, mockExecution);

    await page.route(`**/api/workflows/executions/${EXECUTION_ID}/steps/${STEP_ID}`, async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        return route.fulfill({
          status: 403,
          json: {
            error: "Solo un supervisor o administrador puede omitir un paso obligatorio.",
            code: "UNAUTHORIZED_SKIP",
          },
        });
      }
      return route.fulfill({ status: 200, json: {} });
    });

    await page.goto(`${harness.url}/workflow`);
    await expect(page.getByText("Paso 1 de 2")).toBeVisible();

    // Click en Omitir paso
    await page.getByRole("button", { name: "Omitir paso" }).click();

    // Llenar justificación
    await page.locator("#skip-justification").fill("No tuve tiempo");
    await page.getByRole("button", { name: "Confirmar omisión" }).click();

    // Debe mostrarse el error 403 en toast
    await expect(page.getByText("Solo un supervisor o administrador puede omitir un paso obligatorio.")).toBeVisible();
  });
});
