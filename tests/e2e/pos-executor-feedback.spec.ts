import { test, expect, type Page } from '@playwright/test';
import { startSalesEntryBrowserServer } from '../support/sales-entry-browser-server';
let harness: Awaited<ReturnType<typeof startSalesEntryBrowserServer>>;
test.beforeAll(async () => { harness = await startSalesEntryBrowserServer(undefined, 'pos'); });
test.afterAll(async () => { await harness?.server.close(); });
const csv = 'SKU,Producto,Cantidad,Ingreso\nPOS-01,"Platillo, sintético",8,80.25';
const key = 'companies/c1000000-0000-4000-8000-000000000001/branches/b1000000-0000-4000-8000-000000000001/pos/2026-11-19/123_corte.csv';
const sales = { inserted: 0, updated: 1, skipped: 0, revenueComplete: true, errors: [] };
const outcome = { fileUrl: key, durable: true, matchedCount: 1, sales };
const next = (page: Page) => page.getByRole('button', { name: 'Siguiente', exact: true });
const save = (page: Page) => page.getByRole('button', { name: 'Guardar archivo POS', exact: true });
const result = (page: Page) => page.getByRole('region', { name: 'Resultado del archivo POS', exact: true });
async function select(page: Page, query = '') {
  await page.goto(harness.url + '?executor' + query);
  await page.getByLabel('Archivo del POS', { exact: true }).setInputFiles({ name: 'corte.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByLabel('Clave del producto', { exact: true })).toHaveValue('SKU');
  await page.getByLabel('Día del corte', { exact: true }).fill('2026-11-19');
}

test('executor muestra POS requerido y bloquea avance vacío', async ({ page }) => {
  await page.goto(harness.url + '?executor');
  await expect(page.getByLabel('Archivo del POS', { exact: true })).toBeVisible();
  await expect(next(page)).toBeDisabled();
});

test('executor bloquea navegación pendiente y persiste key/resumen sin otra ingestión', async ({ page }) => {
  const uploads: string[] = [], steps: Record<string, unknown>[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/workflows/smart-links/upload-pos', async route => {
    uploads.push(route.request().postDataBuffer()!.toString()); await held;
    await route.fulfill({ json: { success: true, data: outcome } });
  });
  await page.route('**/api/workflows/executions/*/steps/pos', route => {
    steps.push(route.request().postDataJSON()); return route.fulfill({ json: {} });
  });
  await select(page);
  await expect(page.getByRole('button', { name: /Revisión final/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Omitir paso', exact: true })).toBeDisabled();
  await save(page).click(); await expect.poll(() => uploads.length).toBe(1);
  await expect(next(page)).toBeDisabled();
  await expect(page.getByLabel('Archivo del POS', { exact: true })).toBeDisabled();
  release(); await expect(result(page)).toContainText('1 corregidas');
  await expect(next(page)).toBeEnabled();
  await page.getByLabel('Día del corte', { exact: true }).fill('2026-11-20');
  await expect(next(page)).toBeDisabled();
  await page.getByLabel('Día del corte', { exact: true }).fill('2026-11-19');
  await save(page).click(); await expect(result(page)).toBeVisible();
  await next(page).click(); await expect(page.getByText('Paso 2 de 2', { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(2); expect(uploads[0]).toContain('"productKey":"SKU"');
  expect(uploads[0]).toContain('b1000000-0000-4000-8000-000000000001');
  expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ status: 'COMPLETED', evidenceUrl: key });
  expect(JSON.parse(String(steps[0].value))).toMatchObject({ businessDate: '2026-11-19', sales });
  await page.getByRole('button', { name: /Subir archivo del POS/ }).click();
  await expect(page.getByText('Archivo POS previamente registrado.')).toBeVisible();
  await expect(next(page)).toBeEnabled();
});

for (const code of [401, 403, 500]) test(`executor conserva archivo y permite reintentar HTTP ${code}`, async ({ page }) => {
  let calls = 0;
  await page.route('**/api/workflows/smart-links/upload-pos', route => ++calls === 1
    ? route.fulfill({ status: code, json: { error: { message: 'Error sintético de carga' } } })
    : route.fulfill({ json: { data: outcome } }));
  await select(page, '&legacy'); await save(page).click();
  await expect(page.getByRole('alert')).toContainText(code === 401 ? 'Tu sesión expiró' : 'Error sintético');
  await expect(next(page)).toBeDisabled();
  await expect(page.getByLabel('Clave del producto', { exact: true })).toHaveValue('SKU');
  await save(page).click(); await expect(result(page)).toContainText('Ingreso completo');
  await expect(next(page)).toBeEnabled(); expect(calls).toBe(2);
});

test('executor exige durabilidad y distingue errores de ventas', async ({ page }) => {
  let durable = false;
  await page.route('**/api/workflows/smart-links/upload-pos', route => route.fulfill({ json: { data: {
    ...outcome, durable, sales: { ...sales, revenueComplete: false, errors: [{ rowNumber: 4, message: 'Stock insuficiente' }] }, warning: 'Revisa ventas pendientes',
  } } }));
  await select(page); await save(page).click(); await expect(result(page)).toContainText('sin almacenamiento durable');
  await expect(next(page)).toBeDisabled(); durable = true;
  await save(page).click(); await expect(result(page)).toContainText('Archivo guardado con pendientes');
  await expect(result(page)).toContainText('Fila 4: Stock insuficiente'); await expect(next(page)).toBeEnabled();
});

test('executor restaura JSONB, invalida evidencia al editar y exige sucursal', async ({ page }) => {
  await page.goto(harness.url + '?executor&saved');
  await expect(page.getByLabel('Día del corte', { exact: true })).toHaveValue('2026-11-19');
  await expect(next(page)).toBeEnabled();
  await page.getByLabel('Día del corte', { exact: true }).fill('2026-11-20');
  await expect(next(page)).toBeDisabled();
  await page.goto(harness.url + '?executor&noBranch');
  await expect(page.getByRole('alert')).toContainText('no tiene una sucursal');
  await expect(page.getByLabel('Archivo del POS', { exact: true })).toBeDisabled();
});

test('executor muestra fallo de guardado del paso y reintenta sin subir otra vez', async ({ page }) => {
  let uploads = 0, saves = 0;
  await page.route('**/api/workflows/smart-links/upload-pos', route => {
    uploads++; return route.fulfill({ json: { data: outcome } });
  });
  await page.route('**/api/workflows/executions/*/steps/pos', route => ++saves === 1
    ? route.fulfill({ status: 503, json: { error: 'No se pudo guardar el paso. Reintenta.' } })
    : route.fulfill({ json: {} }));
  await select(page); await save(page).click(); await expect(result(page)).toBeVisible();
  await next(page).click(); await expect(page.getByRole('alert')).toContainText('No se pudo guardar el paso');
  await expect(result(page)).toContainText('Ingreso completo');
  await next(page).click(); await expect(page.getByText('Paso 2 de 2', { exact: true })).toBeVisible();
  expect(uploads).toBe(1); expect(saves).toBe(2);
});

test('executor POS móvil permite teclado y no desborda', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 358, height: 844 });
  await page.route('**/api/workflows/smart-links/upload-pos', route => route.fulfill({ json: { data: outcome } }));
  await select(page);
  await page.getByLabel('Clave del producto', { exact: true }).focus(); await page.keyboard.press('Tab');
  await expect(page.getByLabel('Ingreso', { exact: true })).toBeFocused();
  await save(page).click(); await expect(result(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await next(page).evaluate(button => {
    const card = button.closest('[data-slot="card"]')!;
    return button.getBoundingClientRect().right <= card.getBoundingClientRect().right;
  })).toBe(true);
  await page.screenshot({ path: '.tmp/pos-executor-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.tmp/pos-executor-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
