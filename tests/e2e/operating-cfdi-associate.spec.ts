import { test, expect, type Page } from "@playwright/test";
import { startPayeeBrowserServer } from "../support/payee-browser-server";
import { branchId, payeeId, expenseId, invoiceId, payeeFixture } from "../fixtures/payee-finance";

let harness: Awaited<ReturnType<typeof startPayeeBrowserServer>>;
test.beforeAll(async () => { harness = await startPayeeBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });
const xml = '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Total="4500.00" />';
const preview = { uuid: "ABCDEF00-0000-4000-8000-000000000001", fecha: "2026-11-16T12:00:00", currency: "MXN",
  emitter: { name: "Servicios del Centro", rfc: "AAA010101AAA" }, receiver: { name: "Empresa prueba", rfc: "BBB010101BBB" },
  subtotalCents: 450000, taxCents: 0, withheldTaxCents: 0, totalCents: 450000, taxes: [], concepts: [] };
async function open(page: Page) {
  await page.goto(harness.url);
  await page.getByRole("tab", { name: "Movimientos", exact: true }).click();
  await page.getByRole("button", { name: "Asociar factura", exact: true }).click();
  await page.getByRole("button", { name: "Cargar XML", exact: true }).click();
}
async function upload(page: Page) {
  await page.getByLabel("Archivo XML del CFDI").setInputFiles({ name: "servicio.xml", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await page.getByRole("button", { name: "Ver vista previa" }).click();
}
test("XML se asocia al gasto elegido y recarga su historial sin otra obligación", async ({ page }, info) => {
  let associated = false, confirmations = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/finance/payees/*/finance**", route => route.fulfill({ json: { success: true,
    data: new URL(route.request().url()).searchParams.has("expenseId") ? { candidates: [] } : payeeFixture(associated) } }));
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill({ json: { success: true, data: preview } }));
  await page.route("**/api/finance/expense-invoices/confirm", route => {
    confirmations++;
    const body = route.request().postDataBuffer()!.toString();
    expect(body).toContain(xml);
    expect(body).toContain(JSON.stringify({ mode: "ASSOCIATE", branchId, payeeId, expenseId }));
    expect(body).not.toContain('"mode":"CREATE"');
    associated = true;
    return route.fulfill({ json: { success: true, data: { outcome: "ASSOCIATED", invoiceId, expenseId } } });
  });
  await open(page); await upload(page);
  await expect(page.getByLabel("Sucursal del gasto")).toBeDisabled();
  await expect(page.getByLabel("Categoría del gasto")).toHaveCount(0);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByLabel("Sucursal del gasto").scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`associate-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Confirmar factura del gasto" }).click();
  await expect(page.getByRole("status")).toContainText("Factura vinculada al gasto existente");
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await expect(page.getByText("Factura asociada · pago único")).toBeVisible();
  await expect(page.getByRole("link", { name: "Descargar XML" })).toHaveAttribute("href", `/api/finance/expense-invoices/${invoiceId}/xml`);
  await page.getByRole("tab", { name: "Pendientes", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  expect(confirmations).toBe(1); expect(errors).toEqual([]);
});
test("muestra diferencia de importe y error de periodo sin modificar el gasto", async ({ page }) => {
  let matches = false, confirmations = 0;
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill({ json: { success: true, data: { ...preview, totalCents: matches ? 450000 : 11600 } } }));
  await page.route("**/api/finance/expense-invoices/confirm", route => { confirmations++; return route.fulfill({ status: 409, json: { error: { message: "No se pueden asociar documentos de un periodo cerrado." } } }); });
  await open(page); await upload(page);
  await expect(page.getByRole("alert")).toContainText("Deben coincidir");
  const confirm = page.getByRole("button", { name: "Confirmar factura del gasto" });
  await expect(confirm).toBeDisabled();
  matches = true; await page.getByRole("button", { name: "Ver vista previa" }).click();
  await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByRole("alert")).toContainText("periodo cerrado");
  await expect(confirm).toBeEnabled();
  expect(confirmations).toBe(1);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("duplicado accesible conserva el vínculo y permite abrir el gasto", async ({ page }) => {
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill({ json: { success: true, data: preview } }));
  await page.route("**/api/finance/expense-invoices/confirm", route => route.fulfill({ json: { success: true, data: { outcome: "EXISTING", invoiceId, expenseId } } }));
  await open(page); await upload(page);
  await page.getByRole("button", { name: "Confirmar factura del gasto" }).click();
  await expect(page.getByRole("status")).toContainText("ya estaba registrado");
  await expect(page.getByRole("link", { name: "Abrir gasto" })).toHaveAttribute("href", `/dashboard/finance/expenses?focus=${expenseId}`);
});

test("Gastos permite elegir factura existente y actualiza el comprobante en la fila", async ({ page }) => {
  let linked = false, confirmations = 0;
  await page.route("**/api/expenses?**", route => route.fulfill({ json: { success: true, data: {
    items: [{ ...payeeFixture().expenses[0], payeeId, payeeName: "Servicios del Centro", payeeTaxId: "AAA010101AAA",
      invoiceId: linked ? invoiceId : null, category: "SERVICIOS", requestedByName: "Capturista" }],
    scope: { kind: "BRANCH", branchId, branchName: "Centro" }, truncated: false,
  } } }));
  await page.route("**/api/finance/payees/*/finance**", route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ expenseId, invoiceId });
      linked = true; confirmations++;
      return route.fulfill({ json: { success: true, data: { expenseId, invoiceId } } });
    }
    return route.fulfill({ json: { success: true, data: { candidates: [{ id: invoiceId, uuid: preview.uuid, folio: "123", date: "2026-11-16" }] } } });
  });
  await page.goto(`${harness.url}/expenses?focus=${expenseId}`);
  await page.getByRole("button", { name: "Asociar factura", exact: true }).click();
  await page.getByLabel("Factura", { exact: true }).click();
  await page.getByRole("option", { name: /123/ }).click();
  await page.getByRole("button", { name: "Confirmar asociación", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Factura asociada · pago único")).toBeVisible();
  const xmlUrl = `/api/finance/expense-invoices/${invoiceId}/xml`;
  await expect(page.getByRole("link", { name: "Descargar XML" })).toHaveAttribute("href", xmlUrl);
  await page.route(`**${xmlUrl}`, route => route.fulfill({ body: xml,
    headers: { "Content-Type": "application/xml", "Content-Disposition": `attachment; filename="cfdi-${invoiceId}.xml"` } }));
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar XML" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(`cfdi-${invoiceId}.xml`);
  expect(confirmations).toBe(1);
});
