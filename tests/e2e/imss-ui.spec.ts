import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startImssBrowserServer } from '../support/imss-browser-server';
import { buildSuaFile, calculateSDI } from '../../lib/services/compliance/imss-parser';

let harness: Awaited<ReturnType<typeof startImssBrowserServer>>;
test.beforeAll(async () => { harness = await startImssBrowserServer(); });
test.afterAll(async () => { await harness?.server.close(); });
const branchId = '20000000-0000-4000-8000-000000000001';
const fileId = '30000000-0000-4000-8000-000000000001';
const bytes = 'ARCHIVO DE PRUEBA\r\n';
const sha256 = createHash('sha256').update(bytes).digest('hex');

async function prepare(page: Page, options = { saved: true, canAcknowledge: true, empty: false }) {
    await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));
    const errors: string[] = [];
    const calls: { path: string; method: string; body: Record<string, unknown> | null }[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('IMSS browser error:', error.message); });
    page.on('console', message => { if (message.type() === 'error') console.error('IMSS browser console:', message.text()); });
    const rows = [
        ['ana', 'Ana Lista', 'READY', 'SIN_ALTA', false, []],
        ['beto', 'Beto Vencido', 'READY', 'SIN_ALTA', true, []],
        ['caro', 'Caro Sin Contrato', 'PENDING', 'SIN_ALTA', true, ['SIN_SALARIO_BASE']],
        ['dani', 'Dani En Archivo', 'PENDING', 'EN_ARCHIVO', false, []],
        ['elena', 'Elena Confirmada', 'REGISTERED', 'CONFIRMADO', false, []],
    ].map(([userId, name, status, imssStatus, overdue, blockedReasons]) => ({ userId, name, status, imssStatus, overdue, blockedReasons,
        branchId, branchName: 'Centro', nss: '12345678901', employeeNumber: userId, hireDate: '2026-10-01', daysSinceHire: 16, fileId: null }));
    const file = { id: fileId, fileName: 'IDSE_ALTA_20261024.txt', layout: 'IDSE', layoutVersion: 'IDSE_2025_v1', movementType: 'ALTA',
        fechaMovimiento: '2026-10-24', createdAt: '2026-10-24T12:00:00Z', lineCount: 1, status: 'GENERADO', acuseFolio: null as string | null,
        rejectionReason: null as string | null, downloadAvailable: options.saved, contentSha256: sha256 };
    let generated = false;
    let generatedContent = bytes;
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const method = route.request().method();
        const body = method === 'GET' ? null : route.request().postDataJSON() as Record<string, unknown>;
        calls.push({ path: url.pathname, method, body });
        if (url.pathname === '/api/imss/altas') {
            const summary = { ready: rows.filter(row => row.status === 'READY').length, blocked: 1,
                inFile: rows.filter(row => row.imssStatus === 'EN_ARCHIVO').length, registered: rows.filter(row => row.imssStatus === 'CONFIRMADO').length, overdue: 2 };
            return route.fulfill({ json: { altas: rows, summary, branches: [{ id: branchId, name: 'Centro' }], permissions: { canAdopt: options.canAcknowledge } } });
        }
        if (url.pathname === '/api/imss/bajas') return route.fulfill({ json: { bajas: [{ ...rows[0], userId: 'tomi', name: 'Tomi Baja', imssStatus: 'SIN_BAJA', terminationDate: '2026-10-20', terminationReason: 'VOLUNTARY_RESIGNATION', daysSinceTermination: 4 }],
            summary: { ready: 1, blocked: 0, inFile: 0, registered: 0, overdue: 0 }, branches: [], permissions: { canAdopt: false } } });
        if (url.pathname === '/api/imss/adoption') {
            if (body!.dryRun) return route.fulfill({ json: { adoptedCount: 1, userIds: body!.userIds, previewToken: 'signed-preview-ui' } });
            if (body!.previewToken !== 'signed-preview-ui') return route.fulfill({ status: 409, json: { error: 'Vista previa inválida' } });
            const selected = rows.find(row => row.userId === (body!.userIds as string[])[0])!;
            selected.imssStatus = 'CONFIRMADO'; selected.status = 'REGISTERED';
            return route.fulfill({ json: { adoptedCount: 1 } });
        }
        if (url.pathname === '/api/imss/sua-candidatos') return route.fulfill({ json: { candidates: [
            { userId: 'ana', name: 'Ana Lista', nss: '12345678901', branchName: 'Centro', baseSalaryPesos: 350, sdiPesos: 367.26, contractId: 'contract', yearsOfService: 0, blockedReasons: generated ? ['MOVIMIENTO_EN_ARCHIVO'] : [] },
            { userId: 'caro', name: 'Caro Sin Contrato', nss: '12345678902', branchName: 'Centro', baseSalaryPesos: null, sdiPesos: null, contractId: null, yearsOfService: 0, blockedReasons: ['SIN_SALARIO_BASE'] },
        ], window: { key: '2026-09', start: '2026-09-01', end: '2026-10-31' } } });
        if (url.pathname === '/api/imss/summary') return route.fulfill({ json: { stats: { totalEmployees: 5, requiredMovements: 6, confirmedMovements: 1, complianceRate: 17, pendingAltas: 4, pendingBajas: 1, overdueAltas: 2, overdueBajas: 0 } } });
        if (url.pathname === '/api/imss/files' && method === 'POST') {
            generated = true;
            if (body!.layout === 'SUA') {
                const salary = (body!.newSalaries as Record<string, number>).ana;
                generatedContent = (await buildSuaFile([{ userId: 'ana', name: 'Lopez Perez Ana', nss: '12345678901', curp: 'LOPM850101HDFPRR09', rfc: 'LOPM850101AB1',
                    hireDate: '2026-10-01', effectiveDate: body!.fechaMovimiento as string, movementType: 'MOD_SALARIO', baseSalaryCents: Math.round(salary * 100), sdiCents: Math.round(calculateSDI(salary, 0) * 100) }],
                    { registroPatronal: 'A1234567890', fechaMovimiento: body!.fechaMovimiento as string })).content;
            }
            for (const row of rows) if ((body!.employeeIds as string[]).includes(row.userId)) { row.status = 'PENDING'; row.imssStatus = 'EN_ARCHIVO'; }
            return route.fulfill({ contentType: 'text/plain', body: generatedContent, headers: { 'Content-Disposition': 'attachment; filename="IDSE_ALTA_20261024.txt"', 'X-File-Id': fileId, 'X-Imss-Download-Available': String(options.saved), 'X-Imss-Included-Count': '1', 'X-Imss-Excluded-Count': '0' } });
        }
        if (url.pathname === '/api/imss/files' && method === 'GET') return route.fulfill({ json: { files: options.empty ? [] : [file], pagination: { page: 1, pageSize: 25, total: options.empty ? 0 : 1 },
            stats: { idseCount: options.empty ? 0 : 1, suaCount: 0, acceptedCount: file.status === 'ACEPTADO' ? 1 : 0, rejectedCount: file.status === 'RECHAZADO' ? 1 : 0, acceptanceRate: file.status === 'ACEPTADO' ? 100 : file.status === 'RECHAZADO' ? 0 : null }, permissions: { canAcknowledge: options.canAcknowledge } } });
        if (url.pathname === `/api/imss/files/${fileId}` && method === 'GET') return route.fulfill({ contentType: 'text/plain', body: generatedContent, headers: { 'Content-Disposition': 'attachment; filename="IDSE_ALTA_20261024.txt"' } });
        if (url.pathname === `/api/imss/files/${fileId}` && method === 'PATCH') {
            file.status = body!.accepted ? 'ACEPTADO' : 'RECHAZADO'; file.acuseFolio = body!.acuseFolio as string || null; file.rejectionReason = body!.reason as string || null;
            return route.fulfill({ json: { file } });
        }
        return route.fulfill({ status: 404, json: { error: 'API fuera del escenario aislado' } });
    });
    return { errors, calls };
}

test('altas: listo y vencido seleccionables; bloqueado y confirmado protegidos; descarga guardada', async ({ page }) => {
    const fixture = await prepare(page);
    await page.goto(`${harness.url}/altas`);
    await expect(page.getByLabel('Seleccionar Ana Lista', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Seleccionar Beto Vencido', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Seleccionar Caro Sin Contrato', { exact: true })).toBeDisabled();
    await expect(page.getByText('Elena Confirmada', { exact: true })).toHaveCount(0);
    await page.getByText('Mostrar confirmados', { exact: true }).click();
    await expect(page.getByLabel('Seleccionar Elena Confirmada', { exact: true })).toBeDisabled();
    await page.getByLabel('Seleccionar Beto Vencido', { exact: true }).check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Generar IDSE (1)', exact: true }).click()]);
    expect(createHash('sha256').update(readFileSync((await download.path())!)).digest('hex')).toBe(sha256);
    await expect(page.getByLabel('Seleccionar Beto Vencido', { exact: true })).toBeDisabled();
    expect(fixture.calls.some(call => call.path === `/api/imss/files/${fileId}` && call.method === 'GET')).toBe(true);
    expect(fixture.errors).toEqual([]);
});

test('adopción histórica exige preview; cambiar nota vuelve a bloquear la confirmación', async ({ page }) => {
    const fixture = await prepare(page);
    await page.goto(`${harness.url}/altas`);
    await page.getByRole('button', { name: 'Incorporar plantilla histórica' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Incorporar Ana Lista', { exact: true }).check();
    await dialog.getByLabel('Nota y evidencia del registro previo').fill('Consta en IDSE');
    await expect(dialog.getByRole('button', { name: 'Confirmar incorporación' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Previsualizar incorporación' }).click();
    await expect(dialog.getByRole('button', { name: 'Confirmar incorporación' })).toBeEnabled();
    await dialog.getByLabel('Nota y evidencia del registro previo').fill('Consta en IDSE, revisado');
    await expect(dialog.getByRole('button', { name: 'Confirmar incorporación' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Previsualizar incorporación' }).click();
    await dialog.getByRole('button', { name: 'Confirmar incorporación' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Ana Lista', { exact: true })).toHaveCount(0);
    expect(fixture.calls.filter(call => call.path.endsWith('/adoption') && call.body?.dryRun === false)).toHaveLength(1);
    expect(fixture.errors).toEqual([]);
});

test('SUA muestra salario y SDI reales; sin contrato está bloqueado; envía el importe visible', async ({ page }) => {
    const fixture = await prepare(page);
    await page.goto(`${harness.url}/sua`);
    await expect(page.getByTestId('sdi-ana')).toHaveText('$367.26');
    await expect(page.getByLabel('Salario diario de Caro Sin Contrato')).toBeDisabled();
    await expect(page.getByLabel('Seleccionar Caro Sin Contrato', { exact: true })).toBeDisabled();
    await expect(page.getByTestId('sdi-caro')).toHaveText('—');
    await page.getByLabel('Salario diario de Ana Lista').fill('400');
    await expect(page.getByTestId('sdi-ana')).toHaveText('$419.73');
    await page.getByLabel('Seleccionar Ana Lista', { exact: true }).check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Generar SUA (1)' }).click()]);
    expect(Number(readFileSync((await download.path())!, 'utf8').slice(11, 18)) / 100).toBe(419.73);
    expect(fixture.calls.find(call => call.path === '/api/imss/files' && call.method === 'POST')?.body).toMatchObject({ layout: 'SUA', newSalaries: { ana: 400 }, bimestre: '2026-09' });
    expect(fixture.calls.some(call => call.path === '/api/employees')).toBe(false);
    expect(fixture.errors).toEqual([]);
});

test('reportes consulta archivos reales y exige motivo para registrar un rechazo', async ({ page }) => {
    const fixture = await prepare(page);
    await page.goto(`${harness.url}/reports`);
    await expect(page.getByText('IDSE_ALTA_20261024.txt', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Registrar acuse' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Guardar acuse' })).toBeDisabled();
    await dialog.getByLabel('Resultado del acuse').selectOption('rejected');
    await expect(dialog.getByRole('button', { name: 'Guardar acuse' })).toBeDisabled();
    await dialog.getByLabel('Motivo del rechazo').fill('Corregir identidad');
    await dialog.getByRole('button', { name: 'Guardar acuse' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Corregir identidad', { exact: true })).toBeVisible();
    expect(fixture.calls.some(call => /altas|bajas|employees/.test(call.path))).toBe(false);
    expect(fixture.errors).toEqual([]);
});

test('mismo porcentaje y denominador en resumen y pestaña IMSS', async ({ page }) => {
    const fixture = await prepare(page);
    await page.goto(`${harness.url}/overview`);
    await expect(page.getByText('17%', { exact: true })).toBeVisible();
    await expect(page.getByText('1 de 6 movimientos requeridos', { exact: true })).toBeVisible();
    await page.goto(`${harness.url}/compliance`);
    await page.getByRole('tab', { name: /IMSS/ }).click();
    await expect(page.getByText('17%', { exact: true })).toBeVisible();
    await expect(page.getByText('1 de 6 movimientos requeridos', { exact: true })).toBeVisible();
    expect(fixture.errors).toEqual([]);
});

test('baja con fecha y motivo reales; legible en móvil y teclado operativo', async ({ page }) => {
    const fixture = await prepare(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${harness.url}/bajas`);
    await expect(page.getByText('Renuncia voluntaria', { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Tomi Baja' })).toContainText('20/10/2026');
    const box = page.getByLabel('Seleccionar Tomi Baja', { exact: true });
    await box.focus(); await page.keyboard.press('Space'); await expect(box).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(fixture.errors).toEqual([]);
});

test('historial vacío muestra — y los permisos ocultan el registro de acuses', async ({ page }) => {
    await prepare(page, { saved: false, canAcknowledge: false, empty: true });
    await page.goto(`${harness.url}/reports`);
    await expect(page.getByText('Sin archivos generados en este alcance.', { exact: false })).toBeVisible();
    await expect(page.getByText('0%', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Registrar acuse' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Descargar', exact: true })).toHaveCount(0);
});

test('pantallas contenidas a 320, 768, 1024 y 1440 píxeles', async ({ page }, testInfo) => {
    const fixture = await prepare(page);
    for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ['/altas', '/sua', '/reports']) {
            await page.goto(`${harness.url}${route}`);
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await expect(page.getByRole('table')).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-${width}.png`), fullPage: true });
        }
    }
    expect(fixture.errors).toEqual([]);
});
