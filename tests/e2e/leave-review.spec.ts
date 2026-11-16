import { test, expect, type Page } from '@playwright/test';
import { startLeaveBrowserServer } from '../support/leave-browser-server';

let harness: Awaited<ReturnType<typeof startLeaveBrowserServer>>;
test.beforeAll(async () => { test.setTimeout(180000); harness = await startLeaveBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

const pending = { id: 'pending', userId: 'ana', userName: 'Ana Martínez López', branchId: 'centro', branchName: 'Centro',
  leaveTypeId: 'type', leaveTypeName: 'Vacaciones', startDate: '2026-11-15T06:00:00Z', endDate: '2026-11-17T06:00:00Z',
  totalDays: 3, reason: 'Viaje familiar programado', status: 'PENDING', requestedAt: '2026-11-10T12:00:00Z', rejectionReason: null };
const approved = { ...pending, id: 'approved', userId: 'beto', userName: 'Ana Martínez González', status: 'APPROVED', startDate: '2026-10-30T06:00:00Z', endDate: '2026-12-01T06:00:00Z' };
const third = { ...approved, id: 'third', userId: 'caro', userName: 'Carolina del Río Fernández' };
const balance = { id: 'balance', leaveTypeId: 'd1000000-0000-4000-8000-000000000001', leaveTypeName: 'Vacaciones', year: 2026, totalEntitlement: 12, used: 2, pending: 0, balance: 10, isPaid: true };

async function prepare(page: Page, role = 'GERENTE') {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
  await page.goto(`${harness.url}/?role=${role}`);
  return errors;
}

test('gerente entra a pendientes, ve total completo y coincidencias de su sucursal antes de aprobar', async ({ page }, testInfo) => {
  let done = false;
  const writes: string[] = [];
  await page.route('**/api/leave/balances?**', route => route.fulfill({ json: { balances: [] } }));
  await page.route('**/api/leave/requests?**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PATCH') { writes.push(url.searchParams.get('id')!); done = true; return route.fulfill({ json: {} }); }
    if (url.searchParams.get('limit') === '1') return route.fulfill({ json: { pagination: { total: done ? 0 : 23 } } });
    if (url.searchParams.get('status') === 'PENDING') return route.fulfill({ json: { requests: done ? [] : [pending], pagination: { totalPages: 1 } } });
    return route.fulfill({ json: { requests: [pending, approved, { ...third, branchId: 'norte', branchName: 'Norte' }], pagination: { totalPages: 1 } } });
  });
  const errors = await prepare(page);
  const tab = page.getByRole('tab', { name: /Por aprobar/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toContainText('23');
  await expect(page.getByText('Tus saldos de 2026')).not.toBeVisible();
  await expect(page.getByText('Centro', { exact: true })).toBeVisible();
  await page.getByText('1 permiso coincidente en esta sucursal').click();
  await expect(page.getByText('Ana Martínez González', { exact: true })).toBeVisible();
  await expect(page.getByText('Carolina del Río Fernández', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('leave-approvals.png'), fullPage: true });
  await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(page.getByText('No hay solicitudes de permiso pendientes')).toBeVisible();
  await expect(tab).toContainText('0');
  expect(writes).toEqual(['pending']);
  expect(errors).toEqual([]);
});

test('fallo de saldos permite reintentar, vacío explica responsable y puede recuperarse', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/leave/balances?**', route => route.fulfill(++calls === 1
    ? { status: 503, json: { error: 'offline' } }
    : { json: { balances: calls === 2 ? [] : [balance] } }));
  const errors = await prepare(page, 'EMPLEADO');
  await expect(page.getByRole('tab', { name: 'Solicitar permiso' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('alert')).toContainText('No pudimos consultar tus saldos');
  await expect(page.getByText('Necesitas saldos para solicitar un permiso')).not.toBeVisible();
  await page.getByRole('button', { name: 'Reintentar saldos' }).click();
  await expect(page.getByText(/Pide a tu gerente/)).toBeVisible();
  await page.getByRole('button', { name: 'Volver a consultar saldos' }).click();
  await expect(page.getByRole('combobox')).toBeVisible();
  expect(calls).toBe(3);
  expect(errors).toEqual([]);
});

test('calendario recuperable, todas las páginas, estados y detalle accesible en escritorio y móvil', async ({ page }, testInfo) => {
  let failed = false;
  const pages: string[] = [];
  await page.route('**/api/leave/balances?**', route => route.fulfill({ json: { balances: [] } }));
  await page.route('**/api/leave/requests?**', route => {
    const url = new URL(route.request().url());
    if (!failed) { failed = true; return route.fulfill({ status: 503, json: {} }); }
    pages.push(url.searchParams.get('page')!);
    return route.fulfill({ json: { requests: url.searchParams.get('page') === '1' ? [pending, approved] : [third, { ...third, id: 'cancelled', userName: 'Cancelado', status: 'CANCELLED' }], pagination: { totalPages: 2 } } });
  });
  const errors = await prepare(page, 'EMPLEADO');
  await page.getByRole('tab', { name: 'Calendario del equipo' }).click();
  await expect(page.getByRole('alert')).toContainText('No pudimos cargar el calendario');
  await page.getByRole('button', { name: 'Reintentar calendario' }).click();
  const day = () => page.getByRole('button', { name: '15 de noviembre: 3 permisos. Ver detalle', exact: true }).filter({ visible: true });
  await day().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Ana Martínez López');
  await expect(dialog).toContainText('Ana Martínez González');
  await expect(dialog).toContainText('Carolina del Río Fernández');
  await expect(dialog).toContainText('Pendiente');
  await expect(dialog).toContainText('Aprobada');
  await expect(dialog).not.toContainText('Cancelado');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(day()).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('leave-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await day().click();
  await expect(dialog).toContainText('Carolina del Río Fernández');
  await page.screenshot({ path: testInfo.outputPath('leave-mobile.png') });
  await page.keyboard.press('Escape');
  const tabList = page.getByRole('tablist');
  const panel = page.getByRole('tabpanel');
  const tabsBox = (await tabList.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pages).toContain('2');
  expect(errors).toEqual([]);
});

test('fallo de coincidencias se declara y puede reintentarse sin perder la cola', async ({ page }) => {
  let contextCalls = 0;
  await page.route('**/api/leave/balances?**', route => route.fulfill({ json: { balances: [] } }));
  await page.route('**/api/leave/requests?**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('limit') === '1') return route.fulfill({ json: { pagination: { total: 1 } } });
    if (url.searchParams.has('status')) return route.fulfill({ json: { requests: [pending] } });
    return route.fulfill(++contextCalls === 1 ? { status: 503, json: {} } : { json: { requests: [pending, approved] } });
  });
  const errors = await prepare(page);
  await expect(page.getByRole('alert')).toContainText('No pudimos consultar las ausencias coincidentes');
  await expect(page.getByText('Ana Martínez López', { exact: true })).toBeVisible();
  await expect(page.getByText(/Sin otros permisos coincidentes/)).not.toBeVisible();
  await page.getByRole('button', { name: 'Reintentar coincidencias' }).click();
  await expect(page.getByText('1 permiso coincidente en esta sucursal')).toBeVisible();
  await page.getByRole('tab', { name: 'Solicitar permiso' }).click();
  await expect(page.getByText(/Coordina con la persona responsable/)).toBeVisible();
  expect(errors).toEqual([]);
});
