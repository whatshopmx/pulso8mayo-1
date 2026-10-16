import { test, expect, type Page } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

const ID = "00000000-0000-4000-8000-000000000028";
const execution = (status: string | null, canRetry = true) => ({
  id: ID, status: "COMPLETED", currentStepId: null, score: 100,
  completionEffectsStatus: status, canRetryCompletionEffects: canRetry,
  template: { name: "Cierre de turno", description: null, steps: [
    { id: "cierre", title: "Confirmar cierre", type: "TEXT", required: true },
  ] },
  steps: [{ id: "row-28", stepId: "cierre", status: "COMPLETED", value: "Listo" }],
});

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

async function open(page: Page) {
  await page.addInitScript(id => { (window as any).__paramsPrueba = { id }; }, ID);
  await page.goto(`${harness.url}/workflow-completion`);
}

test("pasos completos conservan el estado pendiente y el refresco muestra el resultado", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let finished = false;
  await page.route(`**/api/workflows/executions/${ID}`, route => {
    return route.fulfill({ json: execution(finished ? "completed" : "pending") });
  });
  await open(page);
  await expect(page.getByRole("heading", { name: "Workflow Completado", exact: true })).toBeVisible();
  await expect(page.getByText("Procesamiento pendiente", { exact: true })).toBeVisible();
  finished = true;
  await expect(page.getByText("Procesamiento completado", { exact: true })).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole("button", { name: "Reintentar procesamiento" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("recarga conserva fallo; recuperación autorizada evita doble clic y muestra pendiente", async ({ page }) => {
  let recovered = false;
  let posts = 0;
  await page.route(`**/api/workflows/executions/${ID}`, route => route.fulfill({ json: execution(recovered ? "pending" : "failed") }));
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/workflow-test/retry", async route => {
    posts++;
    expect(route.request().postDataJSON()).toEqual({ instanceId: ID });
    await gate;
    recovered = true;
    await route.fulfill({ json: { queued: true } });
  });
  await open(page);
  await expect(page.getByText("El procesamiento falló", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Reintentar procesamiento" }).click();
  await expect(page.getByRole("button", { name: "Programando recuperación…" })).toBeDisabled();
  finish();
  await expect(page.getByText("Procesamiento pendiente", { exact: true })).toBeVisible();
  expect(posts).toBe(1);
});

test("rechazo de recuperación conserva fallo, muestra motivo y permite reintentar", async ({ page }) => {
  await page.route(`**/api/workflows/executions/${ID}`, route => route.fulfill({ json: execution("failed") }));
  await page.route("**/api/workflow-test/retry", route => route.fulfill({ status: 403, json: { error: "No puedes operar otra sucursal." } }));
  await open(page);
  await page.getByRole("button", { name: "Reintentar procesamiento" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No puedes operar otra sucursal." })).toBeVisible();
  await expect(page.getByText("El procesamiento falló", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar procesamiento" })).toBeEnabled();
});

test("solo lectura ve el fallo y el motivo sin ofrecer recuperación", async ({ page }) => {
  await page.route(`**/api/workflows/executions/${ID}`, route => route.fulfill({ json: execution("failed", false) }));
  await open(page);
  await expect(page.getByText("El procesamiento falló", { exact: true })).toBeVisible();
  await expect(page.getByText(/Solicita la recuperación/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar procesamiento" })).toHaveCount(0);
});

test("ejecución histórica no presenta un éxito sin evidencia", async ({ page }) => {
  await page.route(`**/api/workflows/executions/${ID}`, route => route.fulfill({ json: execution(null) }));
  await open(page);
  await expect(page.getByText("Procesamiento sin seguimiento", { exact: true })).toBeVisible();
  await expect(page.getByText(/Su estado no está confirmado/)).toBeVisible();
});

test("último paso permanece en la página para mostrar el procesamiento", async ({ page }) => {
  let completed = false;
  await page.route(`**/api/workflows/executions/${ID}`, route => route.fulfill({ json: completed ? execution("pending") : {
    ...execution(null), status: "IN_PROGRESS", steps: [{ id: "row-28", stepId: "cierre", status: "PENDING", value: "" }],
  } }));
  await page.route(`**/api/workflows/executions/${ID}/steps/cierre`, async route => {
    completed = true;
    await route.fulfill({ json: { step: { status: "COMPLETED" } } });
  });
  await open(page);
  await page.locator("textarea").fill("Turno cerrado");
  await page.getByRole("button", { name: "Completar", exact: true }).click();
  await expect(page.getByText("Procesamiento pendiente", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/workflow-completion/);
});
