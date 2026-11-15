import { test, expect, type Page } from "@playwright/test";
import { startSalesEntryBrowserServer } from "../support/sales-entry-browser-server";
let harness: Awaited<ReturnType<typeof startSalesEntryBrowserServer>>;
test.beforeAll(async () => { harness = await startSalesEntryBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });
const branch = "b1000000-0000-4000-8000-000000000001";
const csv = 'SKU,"Producto, receta",Cantidad\nABC,Plato,2';
async function prepare(page: Page, text = csv) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(harness.url);
  await page.getByLabel("Sucursal destino").selectOption(branch);
  await page.getByLabel("Archivo CSV", { exact: true }).setInputFiles({ name: "ventas.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
  await expect(page.getByLabel("Producto / receta *", { exact: true })).toBeVisible();
  await page.getByLabel("Producto / receta *", { exact: true }).selectOption(text === csv ? "Producto, receta" : "Producto");
  await page.getByLabel("Cantidad vendida *", { exact: true }).selectOption("Cantidad");
  return errors;
}
test("distingue altas, correcciones y repetición sin atribuir otra salida de stock", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/api/inventory/sales-entry/bulk", route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { inserted: 1, updated: 2, skipped: 3, errors: [], revenueComplete: true } });
  });
  const errors = await prepare(page);
  await page.getByLabel("Clave del producto (opcional)").selectOption("SKU");
  await page.getByRole("button", { name: /Importar/ }).click();
  const result = page.getByRole("region", { name: "Resultado de importación" });
  await expect(result).toContainText("1 nueva");
  await expect(result).toContainText("2 corregidas");
  await expect(result).toContainText("3 sin cambios");
  await expect(result).not.toContainText("descontaron consumo");
  expect(writes).toMatchObject([{ mapping: { productKey: "SKU", recipeRef: "Producto, receta" } }]);
  expect(errors).toEqual([]);
});
test("muestra ingreso incompleto y filas con error en vez de éxito total", async ({ page }) => {
  await page.route("**/api/inventory/sales-entry/bulk", route => route.fulfill({ json: { inserted: 1, updated: 0, skipped: 0,
    revenueComplete: false, errors: [{ rowNumber: 3, message: "Stock insuficiente" }] } }));
  const errors = await prepare(page);
  await page.getByRole("button", { name: /Importar/ }).click();
  const result = page.getByRole("region", { name: "Resultado de importación" });
  await expect(result).toContainText("Importación con pendientes");
  await expect(result).toContainText("Ingreso incompleto");
  await expect(result).toContainText("Fila 3: Stock insuficiente");
  expect(errors).toEqual([]);
});
test("conserva errores de fila de HTTP 400 y permite corregir/reintentar", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/inventory/sales-entry/bulk", route => route.fulfill(++calls === 1
    ? { status: 400, json: { message: "Ninguna fila válida en el archivo", errors: [{ rowNumber: 2, message: "Cantidad inválida" }] } }
    : { json: { inserted: 0, updated: 0, skipped: 1, errors: [], revenueComplete: true } }));
  const errors = await prepare(page);
  const submit = page.getByRole("button", { name: /Importar/ });
  await submit.click();
  const result = page.getByRole("region", { name: "Resultado de importación" });
  await expect(result).toContainText("Ninguna fila válida en el archivo");
  await expect(result).toContainText("Fila 2: Cantidad inválida");
  await submit.click();
  await expect(result).toContainText("1 sin cambios");
  expect(calls).toBe(2); expect(errors).toEqual([]);
});
test("muestra todos los errores de vista previa y bloquea archivo sin grupos válidos", async ({ page }) => {
  const errors = await prepare(page, "Producto,Cantidad\nPlato,invalid\nOtro,invalid");
  await expect(page.getByText("Fila 2:", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Importar/ })).toBeDisabled();
  expect(errors).toEqual([]);
});
test("el resultado queda ligado al archivo, sucursal y día que lo produjeron", async ({ page }) => {
  await page.route("**/api/inventory/sales-entry/bulk", route => route.fulfill({ json: { inserted: 1, errors: [], revenueComplete: true } }));
  const errors = await prepare(page);
  await page.getByRole("button", { name: /Importar/ }).click();
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toBeVisible();
  await page.getByLabel("Sucursal destino").selectOption("b2000000-0000-4000-8000-000000000002");
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toHaveCount(0);
  await page.getByRole("button", { name: /Importar/ }).click();
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toBeVisible();
  const day = page.getByLabel("Día del corte (si el archivo no trae fecha)");
  const currentDay = await day.inputValue();
  const nextDay = new Date(`${currentDay}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  await day.fill(nextDay.toISOString().slice(0, 10));
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toHaveCount(0);
  await page.getByRole("button", { name: /Importar/ }).click();
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toBeVisible();
  await page.getByLabel("Clave del producto (opcional)").selectOption("SKU");
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("bloquea cambios y duplicación de envío mientras espera al servidor", async ({ page }) => {
  let calls = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/inventory/sales-entry/bulk", async route => {
    calls++; await pending;
    await route.fulfill({ json: { inserted: 1, updated: 0, skipped: 0, errors: [], revenueComplete: true } });
  });
  const errors = await prepare(page);
  await page.getByRole("button", { name: /Importar/ }).click();
  await expect(page.getByRole("button", { name: "Importando…" })).toBeDisabled();
  await expect(page.getByLabel("Sucursal destino")).toBeDisabled();
  await expect(page.getByLabel("Archivo CSV", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Día del corte (si el archivo no trae fecha)")).toBeDisabled();
  await expect(page.getByLabel("Clave del producto (opcional)")).toBeDisabled();
  release();
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toContainText("Importación completada");
  expect(calls).toBe(1); expect(errors).toEqual([]);
});
test("sin indicador de cobertura no afirma ingreso completo", async ({ page }) => {
  await page.route("**/api/inventory/sales-entry/bulk", route => route.fulfill({ json: { inserted: 1, errors: [] } }));
  const errors = await prepare(page);
  await page.getByRole("button", { name: /Importar/ }).click();
  const result = page.getByRole("region", { name: "Resultado de importación" });
  await expect(result).toContainText("Cobertura de ingreso no disponible");
  await expect(result).toContainText("Importación con pendientes");
  expect(errors).toEqual([]);
});
test("errores largos se pueden abrir en móvil sin desbordar la página", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/inventory/sales-entry/bulk", route => route.fulfill({ json: { inserted: 1, errors: Array.from({ length: 23 }, (_, index) => ({ rowNumber: index + 2, message: "Producto sin receta válida para el día seleccionado" })), revenueComplete: false } }));
  const errors = await prepare(page, "Producto,Cantidad\nPlato,2\n" + Array.from({ length: 7 }, (_, index) => `Inválido${index},invalid`).join("\n"));
  const previewTable = page.getByRole("region", { name: "Vista previa de ventas", exact: true });
  await previewTable.focus();
  await previewTable.press("ArrowRight");
  await expect.poll(() => previewTable.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByText("Ver 2 errores más", { exact: true }).click();
  await expect(page.getByText("Fila 9:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Importar/ }).click();
  const result = page.getByRole("region", { name: "Resultado de importación" });
  await result.getByText("Ver 3 errores más", { exact: true }).click();
  await expect(result.getByText("Fila 24:", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test("un archivo nuevo invalida mapeo opcional que ya no existe y borra resultado anterior", async ({ page }) => {
  await page.route("**/api/inventory/sales-entry/bulk", route => route.fulfill({ json: { inserted: 1, errors: [], revenueComplete: true } }));
  const errors = await prepare(page);
  await page.getByLabel("Clave del producto (opcional)").selectOption("SKU");
  await page.getByRole("button", { name: /Importar/ }).click();
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toBeVisible();
  await page.getByLabel("Archivo CSV", { exact: true }).setInputFiles({ name: "nuevo.csv", mimeType: "text/csv", buffer: Buffer.from('"Producto, receta",Cantidad\nPlato,3') });
  await expect(page.getByRole("region", { name: "Resultado de importación" })).toHaveCount(0);
  await expect(page.getByLabel("Clave del producto (opcional)")).toHaveValue("");
  expect(errors).toEqual([]);
});
