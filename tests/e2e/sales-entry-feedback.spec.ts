import { test, expect, type Page } from "@playwright/test";
import { startSalesEntryBrowserServer } from "../support/sales-entry-browser-server";
let harness: Awaited<ReturnType<typeof startSalesEntryBrowserServer>>;
test.beforeAll(async () => { harness = await startSalesEntryBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });
const branch = "b1000000-0000-4000-8000-000000000001";
const csv = 'SKU,"Producto, receta",Cantidad\nABC,Plato,2';

test.describe('captura manual: contrato y respuesta visible', () => {
  let manual: Awaited<ReturnType<typeof startSalesEntryBrowserServer>>;
  const recipe = 'd1000000-0000-4000-8000-000000000001';
  test.beforeAll(async () => { manual = await startSalesEntryBrowserServer(undefined, 'manual'); });
  test.afterAll(async () => { await manual?.server.close(); });
  async function prepareManual(page: Page) {
    page.on('pageerror', error => console.error('Manual browser:', error.message));
    await page.route('**/api/inventory/recipes', route => route.fulfill({ json: [{ id: recipe, name: 'Platillo sintético' }] }));
    await page.route('**/api/inventory/reports/variance?**', route => route.fulfill({ json: { report: [] } }));
    await page.goto(manual.url);
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Platillo sintético', exact: true }).click();
  }
  const save = (page: Page) => page.getByRole('button', { name: /Registrar Venta|Guardar total/, exact: true });
  test('guardar una venta sin conteos mantiene captura y muestra varianza sin dato, sin afirmar conformidad', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepareManual(page);
    await page.route('**/api/inventory/reports/variance?**', route => route.fulfill({ json: { report: [{
      itemId: 'synthetic-item', itemName: 'Ingrediente sin conteo', unit: 'KG', theoreticalQty: 10,
      actualQty: null, varianceQty: null, variancePercent: null, status: 'MISSING_DATA',
      actionableNote: 'Falta conteo físico inicial o final en este periodo.',
    }, { itemId: 'synthetic-zero', itemName: 'Ingrediente cero medido', unit: 'KG', theoreticalQty: 0,
      actualQty: 0, varianceQty: 0, variancePercent: 0, status: 'SUCCESS' }] } }));
    await page.route('**/api/inventory/sales-entry', route => route.fulfill({ json: { inserted: 1, updated: 0, skipped: 0, revenueComplete: false } }));
    await save(page).click();
    const row = page.getByRole('row').filter({ hasText: 'Ingrediente sin conteo' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell', { name: '—', exact: true })).toHaveCount(2);
    await expect(row).toContainText('Falta conteo');
    await expect(row).not.toContainText('Conforme');
    await expect(page.getByRole('region', { name: 'Resultado de captura' })).toBeVisible();
    await expect(save(page)).toBeEnabled();
    const zero = page.getByRole('row').filter({ hasText: 'Ingrediente cero medido' });
    await expect(zero.getByRole('cell', { name: '0.00 KG', exact: true })).toHaveCount(3);
    await expect(zero).toContainText('Conforme');
    expect(errors).toEqual([]);
  });
  test('envía pesos sin multiplicarlos y confirma el total sin prometer otro consumo', async ({ page }) => {
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/inventory/sales-entry', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { inserted: 1, updated: 0, skipped: 0, revenueComplete: true } });
    });
    await prepareManual(page);
    await page.locator('input[type=number]').nth(0).fill('8');
    await page.locator('input[type=number]').nth(1).fill('80.25');
    await save(page).click();
    expect(writes[0]).toMatchObject({ branchId: branch, sales: [{ recipeId: recipe, quantitySold: 8, totalRevenue: 80.25 }] });
    expect(writes[0].saleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const result = page.getByRole('region', { name: 'Resultado de captura' });
    await expect(result).toContainText('1 nueva');
    await expect(result).toContainText('Ingreso completo');
    await expect(result).not.toContainText('deconsolidación');
    await expect(page.locator('input[type=number]').nth(0)).toHaveValue('8');
  });
  test('conserva cero explícito y diferencia ingreso no reportado', async ({ page }) => {
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/inventory/sales-entry', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { inserted: 0, updated: 1, skipped: 0, revenueComplete: writes.length === 1 } });
    });
    await prepareManual(page);
    await page.locator('input[type=number]').nth(0).fill('0');
    await page.locator('input[type=number]').nth(1).fill('0');
    await save(page).click();
    expect(writes[0]).toMatchObject({ sales: [{ quantitySold: 0, totalRevenue: 0 }] });
    await expect(page.locator('input[type=number]').nth(1)).toHaveValue('0');
    await page.locator('input[type=number]').nth(0).fill('2');
    await page.locator('input[type=number]').nth(1).fill('');
    await expect(page.getByRole('region', { name: 'Resultado de captura' })).toHaveCount(0);
    await save(page).click();
    expect(writes[1]).toMatchObject({ sales: [{ quantitySold: 2, totalRevenue: null }] });
    await expect(page.getByRole('region', { name: 'Resultado de captura' })).toContainText('Ingreso incompleto');
  });
  test('error recuperable visible, controles bloqueados y reintento sin cambios', async ({ page }) => {
    let release: (() => void) | undefined, calls = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/inventory/sales-entry', async route => {
      calls++;
      if (calls === 1) { await pending; return route.fulfill({ status: 409, json: { error: 'Stock insuficiente', code: 'INSUFFICIENT_STOCK' } }); }
      return route.fulfill({ json: { inserted: 0, updated: 0, skipped: 1, revenueComplete: true } });
    });
    await prepareManual(page);
    await save(page).click();
    await expect(page.locator('input[type=number]').nth(0)).toBeDisabled();
    await expect(page.getByRole('combobox')).toBeDisabled();
    release!();
    await expect(page.getByRole('alert')).toContainText('Stock insuficiente');
    await expect(page.getByRole('combobox')).toContainText('Platillo sintético');
    await save(page).click();
    await expect(page.getByRole('region', { name: 'Resultado de captura' })).toContainText('1 sin cambios');
    expect(calls).toBe(2);
  });
  test('fecha civil, alcance y enlace a CSV canónico en móvil', async ({ page }) => {
    await prepareManual(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Fecha de venta', { exact: true }).fill('2026-11-16');
    await expect(page.getByRole('link', { name: 'Importar CSV de ventas', exact: true })).toHaveAttribute('href', '/dashboard/inventory/sales-entry');
    expect(await page.locator('input[type=file]').count()).toBe(0);
    await page.getByRole('button', { name: 'Seleccionar Norte', exact: true }).click();
    await expect(page.getByRole('combobox')).not.toContainText('Platillo sintético');
    await page.getByRole('button', { name: 'Todas las sucursales', exact: true }).click();
    await expect(save(page)).toBeDisabled();
    await expect(page.getByText('Selecciona una sucursal para capturar ventas.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const help = (await page.locator('#manual-revenue-help').boundingBox())!;
    const button = (await save(page).boundingBox())!;
    expect(button.y - help.y - help.height).toBeGreaterThanOrEqual(12);
    await page.screenshot({ path: '.tmp/manual-sales-mobile.png', fullPage: true });
  });
  test('bloquea precisión excesiva y fecha vacía antes de enviar', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/inventory/sales-entry', route => { calls++; return route.fulfill({ json: {} }); });
    await prepareManual(page);
    const quantity = page.getByLabel('Cantidad', { exact: true });
    const revenue = page.getByLabel('Ingreso Venta ($)', { exact: true });
    await quantity.fill('1.001');
    await save(page).click();
    expect(await quantity.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    await quantity.fill('1');
    await revenue.fill('0.001');
    await save(page).click();
    expect(await revenue.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    await revenue.fill('');
    await page.getByLabel('Fecha de venta', { exact: true }).fill('');
    await expect(save(page)).toBeDisabled();
    expect(calls).toBe(0);
  });
  test('una respuesta tardía no confirma ventas de la sucursal anterior', async ({ page }) => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/inventory/sales-entry', async route => {
      await pending; return route.fulfill({ json: { inserted: 1, updated: 0, skipped: 0, revenueComplete: true } });
    });
    await prepareManual(page);
    await save(page).click();
    await expect(save(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Seleccionar Norte', exact: true }).click();
    const completed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/sales-entry');
    release!();
    await (await completed).finished();
    await page.getByLabel('Cantidad', { exact: true }).fill('3');
    await expect(page.getByRole('region', { name: 'Resultado de captura' })).toHaveCount(0);
    await expect(page.getByRole('combobox')).not.toContainText('Platillo sintético');
    await expect(page.getByLabel('Ingreso Venta ($)', { exact: true })).toHaveValue('');
  });
});
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

test('el importador canónico conserva Receta/Cantidad/Total y ceros del CSV anterior', async ({ page }) => {
  page.on('pageerror', error => console.error('CSV browser:', error.message));
  const text = 'Receta,Cantidad,Total\nPlatillo,0,0', writes: unknown[] = [];
  await page.route('**/api/inventory/sales-entry/bulk', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { inserted: 0, updated: 1, skipped: 0, errors: [], revenueComplete: true } });
  });
  await page.goto(harness.url);
  await page.getByLabel('Sucursal destino').selectOption(branch);
  await page.getByLabel('Archivo CSV', { exact: true }).setInputFiles({ name: 'anterior.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await page.getByLabel('Producto / receta *', { exact: true }).selectOption('Receta');
  await page.getByLabel('Cantidad vendida *', { exact: true }).selectOption('Cantidad');
  await page.getByLabel('Ingreso $ (opcional)', { exact: true }).selectOption('Total');
  await expect(page.getByRole('cell', { name: '$0.00', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Importar/ }).click();
  await expect(page.getByRole('region', { name: 'Resultado de importación' })).toContainText('1 corregida');
  expect(writes).toMatchObject([{ csvText: text, mapping: { recipeRef: 'Receta', quantitySold: 'Cantidad', totalRevenue: 'Total' } }]);
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
