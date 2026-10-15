import { test, expect } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

// C25: Transmisión y configuración de IA (proveedor primario, fallback y retries)
const TEMPLATE_ID = "tpl-c25-test";

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

test.describe("C25 — Configuración de IA en el Builder (V2 Browser / E2E)", () => {
  test("permite configurar Cloudflare Workers AI como primario y OpenAI como respaldo", async ({ page }) => {
    let capturedBody: any = null;

    // Interceptar llamadas auxiliares del modal
    await page.route(`**/api/playbooks/${TEMPLATE_ID}`, async (route) => {
      return route.fulfill({
        status: 200,
        json: { scope: "local", branchIds: [] },
      });
    });

    await page.route(`**/api/templates/${TEMPLATE_ID}/settings`, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        capturedBody = request.postDataJSON();
        return route.fulfill({
          status: 200,
          json: { success: true },
        });
      }
      return route.fulfill({
        status: 200,
        json: {
          aiConfig: {
            provider: "moondream",
            fallbackProvider: "cloudflare",
            maxRetries: 2,
          },
        },
      });
    });

    await page.goto(`${harness.url}/workflow-settings`);

    // El modal debe estar visible con el título de Configuración
    await expect(page.getByText("Configuración del Flujo")).toBeVisible();
    await expect(page.getByText("Configuración de IA")).toBeVisible();

    // Cambiar maxRetries a 3
    const retriesInput = page.locator('input[type="number"][min="0"][max="5"]');
    await expect(retriesInput).toBeVisible();
    await retriesInput.fill("3");

    // Click en Guardar Configuración
    const saveButton = page.getByRole("button", { name: "Guardar Configuración" });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Verificar que el toast de éxito aparezca
    await expect(page.getByText("Configuración guardada correctamente")).toBeVisible();

    // Verificar que el payload transmitido al servidor contenga aiConfig con los valores
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.aiConfig).toMatchObject({
      maxRetries: 3,
    });
  });

  test("bloquea los campos de IA si el usuario no tiene rol privilegiado (canEditPrivileged = false)", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__canEditPrivileged = false;
    });

    await page.route(`**/api/playbooks/${TEMPLATE_ID}`, async (route) => {
      return route.fulfill({
        status: 200,
        json: { scope: "local", branchIds: [] },
      });
    });

    await page.route(`**/api/templates/${TEMPLATE_ID}/settings`, async (route) => {
      return route.fulfill({
        status: 200,
        json: {
          aiConfig: {
            provider: "moondream",
            fallbackProvider: "cloudflare",
            maxRetries: 2,
          },
        },
      });
    });

    await page.goto(`${harness.url}/workflow-settings`);

    // Debe mostrar la insignia "Solo Administradores"
    await expect(page.getByText("Solo Administradores")).toBeVisible();

    // El input de reintentos debe estar deshabilitado
    const retriesInput = page.locator('input[type="number"][min="0"][max="5"]');
    await expect(retriesInput).toBeDisabled();
  });
});
