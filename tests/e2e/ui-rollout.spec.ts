import { test, expect } from "@playwright/test";
import { startUiRolloutBrowserServer } from "../support/ui-rollout-browser-server";
let harness: Awaited<ReturnType<typeof startUiRolloutBrowserServer>>;
test.beforeAll(async () => { harness = await startUiRolloutBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.error("UI fixture pageerror:", error.message));
  page.on("console", message => { if (message.type() === "error") console.error("UI fixture console:", message.text()); });
});

test("el grupo activo abre y los demás se recorren con teclado sin perder destinos", async ({ page }) => {
  await page.goto(`${harness.url}/?surface=nav`);
  await expect(page.getByRole("link", { name: "Órdenes", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Órdenes", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Conteo", exact: true })).not.toBeVisible();
  const summary = page.locator("summary").filter({ hasText: "Operar" });
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Conteo", exact: true })).toBeVisible();
  expect(await page.locator('a[href^="/dashboard/inventory"]').count()).toBe(5);
});

test("un error de programación permite reintentar y conserva la sucursal", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/operations/scheduled?**", route => {
    expect(new URL(route.request().url()).searchParams.get("branchId")).toBe("synthetic-branch");
    return route.fulfill(++calls === 1 ? { status: 503, json: {} } : { json: { data: [] } });
  });
  await page.goto(`${harness.url}/?surface=scheduled`);
  await expect(page.getByRole("alert")).toContainText("No se pudo cargar");
  await expect(page.getByText("Sin tareas programadas")).not.toBeVisible();
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("Sin tareas programadas")).toBeVisible();
  expect(calls).toBe(2);
});

test("sin lecturas no representa cumplimiento perfecto", async ({ page }) => {
  await page.route("**/api/analytics/temperature-monitoring?**", route => route.fulfill({ json: {
    summary: { totalReadings: 0, complianceRate: 100, violationsToday: 0 }, trend: [], recentViolations: [],
  } }));
  await page.goto(`${harness.url}/?surface=temperature`);
  await expect(page.getByText(/Sin lecturas de temperatura/)).toBeVisible();
  await expect(page.getByText("100.0%", { exact: true })).not.toBeVisible();
});

test("la bandeja distingue fallo de carga de ausencia de avisos y se recupera", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/notifications?**", route => route.fulfill(++calls === 1
    ? { status: 503, json: {} } : { json: { data: [], unreadCount: 0 } }));
  await page.goto(`${harness.url}/?surface=notifications`);
  await expect(page.getByRole("alert")).toContainText("No se pudieron actualizar");
  await expect(page.getByText("Sin avisos en esta categoría")).not.toBeVisible();
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("Sin avisos en esta categoría")).toBeVisible();
});

test("programación se mantiene dentro del ancho de un teléfono", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/operations/scheduled?**", route => route.fulfill({ json: { data: [{
    id: "synthetic-task", templateName: "Revisión de apertura de sucursal con nombre extenso", status: "PENDING", priority: "HIGH", dueDate: "2026-11-14T18:00:00Z", branchName: "Sucursal Centro", assigneeName: "Responsable del turno",
  }] } }));
  await page.goto(`${harness.url}/?surface=scheduled`);
  await expect(page.getByText("Sucursal Centro", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
