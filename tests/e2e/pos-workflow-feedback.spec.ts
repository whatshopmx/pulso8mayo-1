import { test, expect, type Page } from '@playwright/test';
import { startSalesEntryBrowserServer } from '../support/sales-entry-browser-server';
let harness: Awaited<ReturnType<typeof startSalesEntryBrowserServer>>;
test.beforeAll(async () => { harness = await startSalesEntryBrowserServer(undefined, 'pos'); });
test.afterAll(async () => { await harness?.server.close(); });
const csv = 'SKU,Producto,Cantidad,Ingreso\nPOS-01,"Platillo, sintético",8,80.25';
const key = 'companies/c1000000-0000-4000-8000-000000000001/branches/b1000000-0000-4000-8000-000000000001/pos/2026-11-19/123_corte.csv';
const sales = { inserted: 0, updated: 1, skipped: 0, revenueComplete: true, errors: [] };
const outcome = { fileUrl: key, durable: true, matchedCount: 1, sales };
const next = (page: Page) => page.getByRole('button', { name: 'Siguiente Paso' });
const save = (page: Page) => page.getByRole('button', { name: 'Guardar archivo POS', exact: true });
const result = (page: Page) => page.getByRole('region', { name: 'Resultado del archivo POS', exact: true });
async function select(page: Page, query = '') {
  await page.goto(harness.url + query);
  await page.getByLabel('Archivo del POS', { exact: true }).setInputFiles({ name: 'corte.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByLabel('Clave del producto', { exact: true })).toHaveValue('SKU');
  await page.getByLabel('Día del corte', { exact: true }).fill('2026-11-19');
}

test('el paso POS ofrece archivo y día, sin permitir completar un requerido vacío', async ({ page }) => {
  await page.goto(harness.url);
  await expect(page.getByLabel('Archivo del POS', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Día del corte', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Siguiente Paso' })).toBeDisabled();
});

test('bloquea envío/avance, invalida al editar y guarda key y resumen antes de avanzar', async ({ page }) => {
  const requests: string[] = [], steps: Record<string, unknown>[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/workflows/smart-links/upload-pos', async route => {
    requests.push(route.request().postDataBuffer()!.toString());
    if (requests.length === 1) await held;
    await route.fulfill({ json: { success: true, data: outcome } });
  });
  await page.route('**/api/workflows/executions/*/steps/pos', route => {
    steps.push(route.request().postDataJSON()); return route.fulfill({ json: {} });
  });
  await select(page); await save(page).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(next(page)).toBeDisabled();
  await expect(page.getByLabel('Archivo del POS', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Guardando archivo…' })).toBeDisabled();
  release();
  await expect(result(page)).toContainText('1 corregidas');
  await expect(result(page)).toContainText('Ingreso completo');
  await expect(next(page)).toBeEnabled();
  expect(requests[0]).toContain(csv); expect(requests[0]).toContain('2026-11-19');
  expect(requests[0]).toContain('b1000000-0000-4000-8000-000000000001');
  expect(requests[0]).toContain('"productKey":"SKU"');
  await page.getByLabel('Día del corte', { exact: true }).fill('2026-11-20');
  await expect(result(page)).toHaveCount(0); await expect(next(page)).toBeDisabled();
  await page.getByLabel('Día del corte', { exact: true }).fill('2026-11-19');
  await save(page).click(); await expect(result(page)).toBeVisible();
  await next(page).click();
  await expect(page.getByText('Revisión final', { exact: true })).toBeVisible();
  expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ evidenceUrl: key, status: 'COMPLETED' });
  expect(JSON.parse(String(steps[0].value))).toMatchObject({ businessDate: '2026-11-19', sales });
});

for (const failure of ['sesión', 'permiso', 'red'] as const) test(`recupera error de ${failure} conservando archivo y mapping`, async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/workflows/smart-links/upload-pos', route => {
    if (attempts++) return route.fulfill({ json: { success: true, data: outcome } });
    if (failure === 'red') return route.abort('failed');
    return route.fulfill({ status: failure === 'sesión' ? 401 : 403, json: { success: false, error: { message: 'No tienes permisos para registrar ventas.' } } });
  });
  await select(page); await save(page).click();
  await expect(page.getByRole('alert')).toContainText(failure === 'sesión' ? 'Tu sesión expiró' : failure === 'permiso' ? 'No tienes permisos' : 'Revisa tu conexión');
  await expect(next(page)).toBeDisabled();
  if (failure === 'sesión') await expect(page.getByRole('link', { name: 'Iniciar sesión en otra pestaña' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByLabel('Clave del producto', { exact: true })).toHaveValue('SKU');
  await save(page).click(); await expect(result(page)).toContainText('Ingreso completo');
  await expect(next(page)).toBeEnabled(); expect(attempts).toBe(2);
});

test('conserva evidencia con errores por fila e ingreso incompleto sin afirmar éxito total', async ({ page }) => {
  await page.route('**/api/workflows/smart-links/upload-pos', route => route.fulfill({ json: { success: true, data: {
    ...outcome, sales: { ...sales, revenueComplete: false, errors: [{ rowNumber: 4, message: 'Stock insuficiente' }] }, warning: '1 fila(s) omitida por errores.',
  } } }));
  await select(page); await save(page).click();
  await expect(result(page)).toContainText('Archivo guardado con pendientes');
  await expect(result(page)).toContainText('Fila 4: Stock insuficiente');
  await expect(result(page)).toContainText('Ingreso incompleto'); await expect(next(page)).toBeEnabled();
});

test('sin durabilidad no permite completar; sin resumen no inventa ventas', async ({ page }) => {
  await page.route('**/api/workflows/smart-links/upload-pos', route => route.fulfill({ json: { success: true, data: {
    fileUrl: 'local://pos-uploads/test', durable: false, matchedCount: 0, warning: 'No se pudo procesar el archivo como ventas.',
  } } }));
  await select(page); await save(page).click();
  await expect(result(page)).toContainText('Archivo sin almacenamiento durable');
  await expect(result(page)).toContainText('No se confirmó la generación de ventas');
  await expect(result(page)).toContainText('No se encontraron cortes'); await expect(next(page)).toBeDisabled();
});

test('reconoce el target legacy del cierre y conserva cero y repetición en la respuesta', async ({ page }) => {
  await page.route('**/api/workflows/smart-links/upload-pos', route => route.fulfill({ json: { success: true, data: {
    ...outcome, sales: { ...sales, updated: 0, skipped: 1 },
  } } }));
  await select(page, '?legacy'); await save(page).click();
  await expect(result(page)).toContainText('0 nuevas · 0 corregidas · 1 sin cambios'); await expect(next(page)).toBeEnabled();
});

test('preview permite recorrer sin escribir; ejecución sin sucursal no permite subir', async ({ page }) => {
  let writes = 0;
  page.on('request', request => { if (request.method() !== 'GET') writes++; });
  await page.goto(harness.url + '?preview');
  await expect(page.getByLabel('Archivo del POS', { exact: true })).toBeDisabled();
  await next(page).click(); await expect(page.getByText('Revisión final', { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await page.goto(harness.url + '?noBranch');
  await expect(page.getByRole('alert')).toContainText('no tiene una sucursal');
  await expect(page.getByLabel('Archivo del POS', { exact: true })).toBeDisabled();
});

test('móvil mantiene campos y feedback dentro del documento y permite usar teclado', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/workflows/smart-links/upload-pos', route => route.fulfill({ json: { success: true, data: outcome } }));
  await select(page);
  const sku = page.getByLabel('Clave del producto', { exact: true }); await sku.focus(); await page.keyboard.press('Tab');
  await expect(page.getByLabel('Ingreso', { exact: true })).toBeFocused();
  await save(page).click(); await expect(result(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/pos-workflow-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.tmp/pos-workflow-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
