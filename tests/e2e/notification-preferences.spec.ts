import { test, expect } from "@playwright/test";
import { startShiftsBrowserServer } from "../support/shifts-browser-server";

/**
 * C32.3 — la pantalla de preferencias carga lo guardado antes de editar.
 *
 * H09: el estado arrancaba en `true` sin pedir la fila, así que guardar sin
 * tocar nada sobrescribía lo real con defaults. La prueba monta el componente
 * real con `fetch` interceptado: no hay Next, sesión ni Postgres.
 */

const GUARDADO = {
  whatsappEnabled: true,
  emailEnabled: false,
  inAppEnabled: true,
  workflowAssignments: true,
  workflowDueSoon: true,
  workflowOverdue: true,
  incidents: false,
  inventoryAlerts: false,
  shiftReminders: false,
  scheduleChanges: true,
};

let harness: Awaited<ReturnType<typeof startShiftsBrowserServer>>;
test.beforeAll(async () => { harness = await startShiftsBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

test.describe("C32 — Preferencias de notificación (V2 aislada)", () => {
  test("muestra lo guardado, no los defaults", async ({ page }) => {
    await page.route("**/api/notifications/preferences", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, json: GUARDADO });
      }
      return route.fulfill({ status: 200, json: GUARDADO });
    });

    await page.goto(`${harness.url}/notifications`);

    // Los `false` guardados se ven como apagados: si la pantalla inventara
    // defaults, todos estarían encendidos.
    await expect(page.locator("#whatsapp")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#email")).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#incidents")).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#stock-alerts")).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#shift-reminders")).toHaveAttribute("aria-checked", "false");
  });

  test("guardar envía el contrato canónico y conserva lo no tocado", async ({ page }) => {
    let patchBody: Record<string, unknown> | null = null;

    await page.route("**/api/notifications/preferences", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, json: GUARDADO });
      }
      patchBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 200, json: { ...GUARDADO, ...patchBody } });
    });

    await page.goto(`${harness.url}/notifications`);
    await expect(page.locator("#stock-alerts")).toHaveAttribute("aria-checked", "false");

    // El usuario enciende las alertas de stock y guarda.
    await page.locator("#stock-alerts").click();
    await page.getByRole("button", { name: "Guardar Preferencias" }).click();

    await expect(page.getByText("Preferencias guardadas correctamente")).toBeVisible();

    expect(patchBody).not.toBeNull();
    // El campo viaja con el nombre canónico, no con el alias de la pantalla.
    expect(patchBody).not.toHaveProperty("stockAlerts");
    expect(patchBody).toMatchObject({
      inventoryAlerts: true,
      // Lo que el usuario no tocó se conserva tal cual estaba guardado.
      emailEnabled: false,
      incidents: false,
      shiftReminders: false,
    });
  });

  test("un fallo de carga muestra error y no los defaults como si estuvieran guardados", async ({ page }) => {
    await page.route("**/api/notifications/preferences", async (route) => {
      return route.fulfill({ status: 500, json: { error: "boom" } });
    });

    await page.goto(`${harness.url}/notifications`);

    await expect(page.getByText("No se pudieron cargar tus preferencias")).toBeVisible();
    // Sin datos no hay interruptores que parezcan preferencias reales.
    await expect(page.locator("#email")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guardar Preferencias" })).toHaveCount(0);
  });

  test("reintentar recupera la carga", async ({ page }) => {
    let intentos = 0;
    await page.route("**/api/notifications/preferences", async (route) => {
      intentos += 1;
      if (intentos === 1) {
        return route.fulfill({ status: 500, json: { error: "boom" } });
      }
      return route.fulfill({ status: 200, json: GUARDADO });
    });

    await page.goto(`${harness.url}/notifications`);
    await expect(page.getByText("No se pudieron cargar tus preferencias")).toBeVisible();

    await page.getByRole("button", { name: "Reintentar" }).click();

    await expect(page.locator("#email")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("No se pudieron cargar tus preferencias")).toHaveCount(0);
  });
});
