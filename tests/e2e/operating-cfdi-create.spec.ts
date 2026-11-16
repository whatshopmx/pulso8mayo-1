import { test, expect, type Page } from "@playwright/test";
import { startPayeeBrowserServer } from "../support/payee-browser-server";
import { branchId, payeeId, expenseId, invoiceId } from "../fixtures/payee-finance";

let harness: Awaited<ReturnType<typeof startPayeeBrowserServer>>;
test.beforeAll(async () => { harness = await startPayeeBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });
const xml = '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Total="116.00" />';
const preview = { uuid: "ABCDEF00-0000-4000-8000-000000000001", fecha: "2026-11-16T12:00:00", currency: "MXN",
  emitter: { name: "Servicios del Centro", rfc: "AAA010101AAA" }, receiver: { name: "Empresa prueba", rfc: "BBB010101BBB" },
  subtotalCents: 10000, taxCents: 1600, withheldTaxCents: 0, totalCents: 11600, taxes: [], concepts: [], branchId };
async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/finance/expense-invoices/**", route => route.fulfill({ status: 409, json: { error: { message: "Solicitud no esperada" } } }));
  await page.goto(harness.url);
  await page.getByRole("button", { name: "Nuevo Gasto Operativo" }).click();
  await page.getByRole("button", { name: "Cargar CFDI", exact: true }).click();
  return errors;
}
async function upload(page: Page) {
  await page.getByLabel("Archivo XML del CFDI").setInputFiles({ name: "servicio.xml", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await page.getByRole("button", { name: "Ver vista previa" }).click();
}
test("vista previa sin deuda, confirmación única con XML original y resultado accesible", async ({ page }, info) => {
  const costCenterId = "00000000-0000-4000-8000-000000000007";
  await page.route("**/api/cost-centers", route => route.fulfill({ json: { costCenters: [{ id: costCenterId, code: "SERV", name: "Servicios" }] } }));
  const errors = await open(page);
  let previews = 0, confirmations = 0;
  await page.route("**/api/finance/expense-invoices/preview", route => { previews++; return route.fulfill({ json: { success: true, data: preview } }); });
  await page.route("**/api/finance/expense-invoices/confirm", async route => {
    confirmations++;
    const body = route.request().postDataBuffer()!.toString();
    expect(body).toContain(xml);
    expect(body).toContain(JSON.stringify({ mode: "CREATE", branchId, payeeId, category: "SERVICIOS", description: "Electricidad noviembre", costCenterId, dueDate: "2026-11-30" }));
    expect(body).not.toContain("amountCents");
    await route.fulfill({ json: { success: true, data: { outcome: "CREATED", invoiceId, expenseId } } });
  });
  await upload(page);
  await expect(page.getByText(preview.uuid)).toBeVisible();
  await expect(page.getByText("$116.00", { exact: true })).toBeVisible();
  expect(confirmations).toBe(0);
  await page.getByLabel("Categoría del gasto").selectOption("SERVICIOS");
  await page.getByLabel("Descripción del gasto").fill("Electricidad noviembre");
  await page.getByLabel("Centro de costo del gasto (opcional)").selectOption(costCenterId);
  await page.getByLabel("Vencimiento (opcional)").fill("2026-11-30");
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("Sucursal del gasto").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`cfdi-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Confirmar gasto con CFDI" }).click();
  await expect(page.getByRole("status")).toContainText("pendiente de aprobación");
  await expect(page.getByRole("link", { name: "Abrir gasto" })).toHaveAttribute("href", `/dashboard/finance/expenses?focus=${expenseId}`);
  expect(previews).toBe(1); expect(confirmations).toBe(1); expect(errors).toEqual([]);
});
test("cancelar descarta XML y no confirma; captura manual sigue disponible", async ({ page }) => {
  await open(page);
  let confirmations = 0;
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill({ json: { success: true, data: preview } }));
  await page.route("**/api/finance/expense-invoices/confirm", route => { confirmations++; return route.abort(); });
  await upload(page);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Nuevo Gasto Operativo" }).click();
  await expect(page.getByLabel("Monto ($ MXN)")).toBeVisible();
  await page.getByRole("button", { name: "Cargar CFDI", exact: true }).click();
  await expect(page.getByText(preview.uuid)).toHaveCount(0);
  expect(confirmations).toBe(0);
});
test("error recuperable y duplicado accesible sin nueva obligación", async ({ page }) => {
  await open(page);
  let fail = true;
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill(fail
    ? { status: 400, json: { error: { message: "El receptor no corresponde a tu empresa" } } }
    : { json: { success: true, data: preview } }));
  await upload(page);
  await expect(page.getByRole("alert")).toContainText("El receptor no corresponde");
  await expect(page.getByRole("button", { name: "Confirmar gasto con CFDI" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await page.getByLabel("Descripción del gasto").fill("Servicio");
  await page.route("**/api/finance/expense-invoices/confirm", route => route.fulfill({ json: { success: true, data: { outcome: "EXISTING", expenseId, invoiceId } } }));
  await page.getByRole("button", { name: "Confirmar gasto con CFDI" }).click();
  await expect(page.getByRole("status")).toContainText("ya estaba registrado");
  await expect(page.getByRole("button", { name: "Confirmar gasto con CFDI" })).toHaveCount(0);
});

test("Gastos respeta sucursal, exige elegir contraparte y permite completar por teclado", async ({ page }) => {
  await page.goto(`${harness.url}/expenses`);
  await page.getByRole("button", { name: "Nuevo Gasto Operativo" }).first().click();
  await page.getByRole("button", { name: "Cargar CFDI", exact: true }).click();
  await expect(page.getByLabel("Sucursal del gasto")).toHaveValue(branchId);
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill({ json: { success: true, data: preview } }));
  await upload(page);
  const confirm = page.getByRole("button", { name: "Confirmar gasto con CFDI" });
  await page.getByLabel("Descripción del gasto").fill("Electricidad");
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Contraparte del gasto").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Contraparte del gasto")).toHaveValue(payeeId);
  await expect(page.getByLabel("Categoría del gasto")).toBeFocused();
  await expect(confirm).toBeEnabled();
});

test("bloquea doble envío y cierre mientras confirma; un error permite reintentar", async ({ page }) => {
  await open(page);
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill({ json: { success: true, data: preview } }));
  await upload(page);
  await page.getByLabel("Descripción del gasto").fill("Servicio");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let confirmations = 0;
  await page.route("**/api/finance/expense-invoices/confirm", async route => {
    confirmations++;
    await pending;
    return route.fulfill({ status: 409, json: { error: { message: "Periodo contable cerrado" } } });
  });
  const confirm = page.getByRole("button", { name: "Confirmar gasto con CFDI" });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText("Periodo contable cerrado");
  await expect(confirm).toBeEnabled();
  expect(confirmations).toBe(1);
});

test("cambiar XML o sucursal invalida la vista previa y bloquea RFC incompatible", async ({ page }) => {
  const secondBranchId = "00000000-0000-4000-8000-000000000008";
  await page.route("**/api/branches", route => route.fulfill({ json: { success: true, data: [{ id: branchId, name: "Centro" }, { id: secondBranchId, name: "Norte" }] } }));
  await open(page);
  await page.route("**/api/finance/expense-invoices/preview", route => route.fulfill({ json: { success: true, data: { ...preview, emitter: { ...preview.emitter, rfc: "CCC010101CCC" } } } }));
  await upload(page);
  await page.getByLabel("Descripción del gasto").fill("Servicio");
  await expect(page.getByRole("alert")).toContainText("CCC010101CCC");
  await expect(page.getByRole("button", { name: "Confirmar gasto con CFDI" })).toBeDisabled();
  await page.getByLabel("Sucursal del gasto").selectOption(secondBranchId);
  await expect(page.getByText(preview.uuid)).toHaveCount(0);
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await expect(page.getByText(preview.uuid)).toBeVisible();
  await page.getByLabel("Archivo XML del CFDI").setInputFiles({ name: "otro.xml", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await expect(page.getByText(preview.uuid)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirmar gasto con CFDI" })).toHaveCount(0);
});
