import { test, expect } from "@playwright/test";
import { startPayeeBrowserServer } from "../support/payee-browser-server";
import { payeeFixture, payeeId, branchId, invoiceId } from "../fixtures/payee-finance";
let harness: Awaited<ReturnType<typeof startPayeeBrowserServer>>;
test.beforeAll(async () => { harness = await startPayeeBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

test("consulta historial, asocia factura y conserva una sola obligación", async ({ page }, info) => {
  let associated = false;
  const writes: unknown[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/finance/payees/*/finance**", async route => {
    if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); associated = true; return route.fulfill({ json: { success: true } }); }
    const candidates = [{ id: invoiceId, uuid: "CFDI-DE-PRUEBA-123", folio: "123", date: "2026-11-01" }];
    return route.fulfill({ json: { success: true, data: new URL(route.request().url()).searchParams.has("expenseId") ? { candidates } : payeeFixture(associated) } });
  });
  await page.goto(harness.url);
  await expect(page.getByRole("heading", { name: "Servicios del Centro" })).toBeVisible();
  await page.getByRole("tab", { name: "Movimientos" }).click();
  await page.getByRole("button", { name: "Asociar factura", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmar asociación" })).toBeDisabled();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: /123/ }).click();
  await page.getByRole("button", { name: "Confirmar asociación" }).click();
  await expect(page.getByText("Factura asociada · pago único")).toBeVisible();
  expect(writes).toEqual([{ expenseId: "00000000-0000-4000-8000-000000000006", invoiceId }]);
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();
  await expect(page.getByText("Respalda un gasto · pago único")).toBeVisible();
  await page.getByRole("tab", { name: "Datos y cuentas" }).click();
  await expect(page.getByText(/termina en 1234/)).toBeVisible();
  await page.getByRole("tab", { name: "Pendientes", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("payee-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole("heading", { name: "Servicios del Centro" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("payee-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("recupera un error de carga y preselecciona la contraparte al registrar", async ({ page }) => {
  let fail = true;
  await page.route("**/api/finance/payees/*/finance**", route => fail
    ? route.fulfill({ status: 503, json: { success: false, error: { message: "Servicio no disponible" } } })
    : route.fulfill({ json: { success: true, data: payeeFixture() } }));
  await page.goto(harness.url);
  await expect(page.getByRole("alert")).toContainText("Servicio no disponible");
  fail = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.getByRole("button", { name: "Nuevo Gasto Operativo" }).click();
  await expect(page.locator("#expense-payee")).toContainText("Servicios del Centro");
  await expect(page.locator("#expense-payee")).toBeDisabled();
  await page.locator("#expense-amount").fill("100");
  await page.locator("#expense-desc").fill("Servicio de prueba");
  let body: Record<string, unknown> = {};
  await page.route("**/api/expenses", route => { body = route.request().postDataJSON(); return route.fulfill({ json: { success: true } }); });
  await page.getByRole("button", { name: "Guardar Gasto" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(body).toMatchObject({ payeeId, branchId, amountCents: 10000 });
});
