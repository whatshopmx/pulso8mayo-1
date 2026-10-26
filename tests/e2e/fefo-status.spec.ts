import { test, expect, type Page } from '@playwright/test';
import { startFefoBrowserServer } from '../support/fefo-browser-server';

let harness: Awaited<ReturnType<typeof startFefoBrowserServer>>;
test.beforeAll(async () => { harness = await startFefoBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });

async function open(page: Page, query = '') {
    await page.goto(`${harness.url}/${query}`);
    // Primera carga: Vite debe compilar la página y preparar dependencias.
    await expect(page.getByRole('heading', { name: 'Lotes y Trazabilidad' })).toBeVisible({ timeout: 60_000 });
}

async function prepare(page: Page, status = 'AVAILABLE', failure = false) {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('FEFO browser:', error.message); });
    page.on('requestfailed', request => console.error('FEFO request:', request.url(), request.failure()?.errorText));
    const batch = { id: 'aaaaaaaa-0000-4000-8000-000000000031', itemId: 'aaaaaaaa-0000-4000-8000-000000000021',
        branchId: 'aaaaaaaa-0000-4000-8000-000000000011', branchName: 'Demo aislado', itemName: 'Salsa de prueba',
        itemSku: 'FEFO-UI', itemUnit: 'KG', lotNumber: 'FEFO-UI-01', status,
        initialQuantity: 2, currentQuantity: 1.125, unitCost: 100, expirationDate: '2099-01-01T00:00:00Z' };
    const patches: Record<string, unknown>[] = [];
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/branches') return route.fulfill({ json: { success: true, data: [{ id: batch.branchId, name: batch.branchName }] } });
        if (url.pathname === '/api/inventory/batches') {
            if (request.method() === 'GET') return route.fulfill({ json: { batches: [batch] } });
            const body = request.postDataJSON(); patches.push(body);
            if (failure) return route.fulfill({ status: 409, json: { error: 'El lote cambió; revisa sus condiciones.' } });
            batch.status = body.status;
            return route.fulfill({ json: { success: true, batch } });
        }
        return route.fulfill({ status: 403, json: { error: 'Fuera de la fixture' } });
    });
    return { errors, patches, batch };
}

test('exige motivo, confirma por teclado y devuelve el foco al menú del lote', async ({ page }) => {
    const fixture = await prepare(page);
    await open(page);
    const actions = page.getByRole('button', { name: 'Acciones de lote' });
    await actions.click();
    await page.getByRole('menuitem', { name: 'Poner en Cuarentena' }).click();
    const dialog = page.getByRole('dialog');
    const reason = page.getByRole('textbox', { name: 'Motivo del cambio' });
    await expect(reason).toBeFocused();
    await expect(page.getByRole('button', { name: 'Confirmar cambio' })).toBeDisabled();
    await reason.fill('   ');
    await expect(page.getByRole('button', { name: 'Confirmar cambio' })).toBeDisabled();
    await reason.fill('  Sello dañado  ');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(actions).toBeFocused();
    await expect(page.getByRole('cell', { name: 'Cuarentena', exact: true })).toBeVisible();
    expect(fixture.patches).toEqual([{ batchId: fixture.batch.id, status: 'QUARANTINED', notes: 'Sello dañado' }]);
    expect(fixture.errors).toEqual([]);
});

test('un rechazo conserva el motivo y permite cancelar sin otro envío', async ({ page }) => {
    const fixture = await prepare(page, 'QUARANTINED', true);
    await open(page);
    await page.getByRole('button', { name: 'Acciones de lote' }).click();
    await page.getByRole('menuitem', { name: 'Liberar a Disponible' }).click();
    const reason = page.getByRole('textbox', { name: 'Motivo del cambio' });
    await reason.fill('Inspección del gerente');
    await page.getByRole('button', { name: 'Confirmar cambio' }).click();
    await expect(page.getByRole('alert')).toContainText('El lote cambió');
    await expect(reason).toHaveValue('Inspección del gerente');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(fixture.patches).toHaveLength(1);
    expect(fixture.errors).toEqual([]);
});

for (const [role, status, visible] of [
    ['SUPERVISOR', 'AVAILABLE', true], ['SUPERVISOR', 'QUARANTINED', false],
    ['EMPLEADO', 'AVAILABLE', false], ['READONLY', 'AVAILABLE', false], ['GERENTE', 'EXPIRED', false],
] as const) test(`${role}: acciones para ${status}`, async ({ page }) => {
    const fixture = await prepare(page, status);
    await open(page, `?role=${role}`);
    await page.getByRole('button', { name: 'Acciones de lote' }).click();
    await expect(page.getByRole('menuitem', { name: /Poner en Cuarentena|Liberar a Disponible/ })).toHaveCount(visible ? 1 : 0);
    expect(fixture.errors).toEqual([]);
});

test('el diálogo cabe en móvil y escritorio', async ({ page }, testInfo) => {
    const fixture = await prepare(page);
    await open(page);
    await page.getByRole('button', { name: 'Acciones de lote' }).click();
    await page.getByRole('menuitem', { name: 'Poner en Cuarentena' }).click();
    for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const box = await page.getByRole('dialog').boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await expect(page.getByRole('button', { name: 'Confirmar cambio' })).toBeInViewport();
        if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`dialog-${width}.png`) });
    }
    expect(fixture.errors).toEqual([]);
});
