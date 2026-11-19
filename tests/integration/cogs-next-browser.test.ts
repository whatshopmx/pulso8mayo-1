import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import { parse } from 'dotenv';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type APIRequestContext, type Browser } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';
import { account, users, sessions, companies, branches, recipes, salesEntries, salesConsumptionIdentities } from '@/lib/db/schema';

// Opt in: starts a complete Next production server and commits only synthetic fixtures
// to the isolated integration database. No auth, Next, API or SQL mocks.
const enabled = process.env.RUN_COGS_NEXT_BROWSER === '1';
// Explicit diagnostic mode; normal acceptance runs the freshly verified build.
const development = process.env.REPORT_BROWSER_DEV === '1';
const companyId = randomUUID(), foreignCompanyId = randomUUID();
const branchId = randomUUID(), siblingBranchId = randomUUID(), foreignBranchId = randomUUID();
const recipeId = randomUUID(), actorId = randomUUID();
const readerId = randomUUID(), actorIds = [actorId, readerId];
const password = `Synthetic-${randomUUID()}`;
let child: ChildProcess | undefined, browser: Browser | undefined, baseURL: string;
let seeded = false;

// Production sign-in limits are kept enabled. Wait for their short window
// instead of disabling auth protections for a suite that opens several sessions.
async function signIn(request: APIRequestContext, userId = actorId) {
  const send = () => request.post('/api/auth/sign-in/email', {
    timeout: 90_000, headers: { origin: baseURL }, data: { email: `${userId}@example.invalid`, password },
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await send();
    if (response.status() !== 429) return response;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return send();
}

beforeAll(async () => {
  if (!enabled) return;
  expect(hasPermission('SUPERVISOR', 'inventory', 'manage')).toBe(false);
  mkdirSync('.tmp', { recursive: true });
  if (!development) expect(existsSync('.next/BUILD_ID'), 'Build the current source before this opt-in test').toBe(true);
  // Webpack resolves paths from this temporary config's directory.
  writeFileSync('.tmp/report-browser-tsconfig.json', JSON.stringify({ extends: '../tsconfig.json', compilerOptions: { paths: { '@/*': ['../*'] } } }));
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  // Next acquires its native exclusive lock and exits if another server owns it.
  // File existence alone is not a liveness check after taskkill on Windows.
  const portProbe = createServer();
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const address = portProbe.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const port = address.port;
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  baseURL = `http://127.0.0.1:${port}`;
  const now = new Date(), hash = await hashPassword(password);
  await db.transaction(async tx => {
    await tx.insert(companies).values([companyId, foreignCompanyId].map(id => ({ id, name: 'Synthetic Next COGS company' })));
    await tx.insert(branches).values([{ id: branchId, companyId, name: 'Synthetic Next COGS branch' },
      { id: siblingBranchId, companyId, name: 'Synthetic sibling branch' },
      { id: foreignBranchId, companyId: foreignCompanyId, name: 'Synthetic foreign branch' }]);
    await tx.insert(recipes).values({ id: recipeId, companyId, name: 'Synthetic legacy dish', baseYield: '1', unit: 'PORTION' });
    await tx.insert(salesEntries).values({ companyId, branchId, recipeId, quantitySold: '3', totalRevenue: 1200,
      saleDate: new Date('2026-11-16T00:00:00Z') });
    await tx.insert(users).values([
      { id: actorId, companyId, branchId, role: 'ADMIN', email: `${actorId}@example.invalid`, name: 'Synthetic COGS actor', emailVerified: true, createdAt: now, updatedAt: now },
      { id: readerId, companyId, branchId, role: 'SUPERVISOR', email: `${readerId}@example.invalid`, name: 'Synthetic sales reader', emailVerified: true, createdAt: now, updatedAt: now },
    ]);
    await tx.insert(account).values(actorIds.map(id => ({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential',
      password: hash, createdAt: now, updatedAt: now })));
  });
  seeded = true;
  writeFileSync('.tmp/report-browser-fixture.json', JSON.stringify({ companyId, foreignCompanyId,
    branchId, siblingBranchId, foreignBranchId, recipeId, actorId, readerId }));
  const serverLog = openSync('.tmp/cogs-next-server.log', 'w');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...(development ? ['dev', '--webpack'] : ['start']), '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, NODE_ENV: development ? 'development' : 'production', DATABASE_URL: process.env.TEST_DATABASE_URL!, PULSO_REPORT_BROWSER_TEST: development ? '1' : '',
      BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: randomUUID(), NEXT_PUBLIC_APP_URL: baseURL,
      // Avoid external integrations configured in the developer's .env.
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', RESEND_API_KEY: '',
      WASENDER_API_KEY: '', INNGEST_DEV: '1', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', serverLog, serverLog], windowsHide: true,
  });
  closeSync(serverLog);
  console.info(`Synthetic report server PID ${child.pid}, ${baseURL}; log .tmp/cogs-next-server.log`);
  child.on('error', () => {});
  const deadline = Date.now() + 180_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited (${child.exitCode})`);
    let status: number | undefined;
    try {
      // The product's session route returns 401 for an anonymous caller.
      status = (await fetch(`${baseURL}/api/auth/get-session`, { signal: AbortSignal.timeout(5000) })).status;
    } catch { /* Next is still compiling. */ }
    ready = status === 401;
    if (ready) break;
    if (status && status >= 500) throw new Error('Next session probe failed; inspect .tmp/cogs-next-server.log');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Next did not become ready within 180 seconds');
  browser = await chromium.launch({ headless: true });
}, 240_000);

for (const report of [
  { name: 'executive', path: '/dashboard/inventory/reports/executive', api: '/api/inventory/reports/executive', refresh: 'Actualizar reporte' },
  { name: 'menu', path: '/dashboard/inventory/menu-engineering', api: '/api/inventory/menu-engineering', refresh: 'Actualizar matriz' },
]) {
  it.skipIf(!enabled)(`Next + Chromium + Better Auth: ${report.name} partial/empty, session failure and recovery`, async () => {
    const context = await browser!.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    try {
      const endpoint = `${report.api}?branchId=${branchId}&startDate=2026-11-16&endDate=2026-11-16`;
      expect((await context.request.get(endpoint, { timeout: 90_000 })).status()).toBe(401);
      const login = async () => {
        expect((await signIn(context.request)).status()).toBe(200);
      };
      await login();
      expect((await context.request.get(endpoint.replace(branchId, foreignBranchId))).status())
        .toBe(report.name === 'executive' ? 400 : 403);
      expect((await context.request.get(endpoint, { headers: { 'x-pulso-tenant-id': foreignCompanyId } })).status()).toBe(403);
      await context.addCookies([{ name: 'pulso_selected_branch', value: branchId, url: baseURL }]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      // Cold real-DB reads can outlast Playwright's 30s input action limit.
      // Verify the initial HTTP read before editing disabled date controls.
      const initialReport = page.waitForResponse(r => new URL(r.url()).pathname === report.api && r.request().method() === 'GET', { timeout: 90_000 });
      await page.goto(report.path, { timeout: 180_000 });
      expect((await initialReport).status()).toBe(200);
      await page.getByLabel('Fecha de inicio', { exact: true }).fill('2026-11-16');
      await page.getByLabel('Fecha de fin', { exact: true }).fill('2026-11-16');
      const refresh = async (status = 200) => {
        const start = await page.getByLabel('Fecha de inicio', { exact: true }).inputValue();
        const end = await page.getByLabel('Fecha de fin', { exact: true }).inputValue();
        const response = page.waitForResponse(r => r.url().includes(report.api) && r.request().method() === 'GET');
        await page.getByRole('button', { name: report.refresh, exact: true }).click();
        const received = await response;
        expect(received.status()).toBe(status);
        if (status === 200) expect((await received.json()).period).toEqual({
          start: new Date(start).toISOString(), end: new Date(end).toISOString(),
        });
      };
      await refresh();
      if (report.name === 'executive') {
        await page.getByRole('combobox', { name: 'Vista de indicadores' }).click();
        await page.getByRole('option', { name: 'CEO / Propietario', exact: true }).click();
        const revenue = page.locator('[data-slot="card"]').filter({ has: page.getByText('Ingresos (Ventas)', { exact: true }) });
        const foodCost = page.locator('[data-slot="card"]').filter({ has: page.getByText('Food Cost', { exact: true }) }).first();
        await browserExpect(revenue).toContainText('Cobertura Parcial · reportado $12.00');
        await browserExpect(revenue.getByText('—', { exact: true })).toBeVisible();
        await browserExpect(foodCost.getByText('—', { exact: true })).toBeVisible();
        await page.getByRole('combobox', { name: 'Sucursal del reporte' }).click();
        await page.getByRole('option', { name: 'Synthetic Next COGS branch', exact: true }).click();
        await refresh();
        await page.getByRole('combobox', { name: 'Sucursal del reporte' }).click();
        await page.getByRole('option', { name: 'Todas las sucursales', exact: true }).click();
        await refresh();
        await browserExpect(page.getByRole('row').filter({ hasText: 'Synthetic sibling branch' })).toContainText('Sin datos');
      } else {
        await browserExpect(page.getByText('Sin rentabilidad medida: la cobertura de ingreso es incompleta', { exact: true })).toBeVisible();
        const row = page.getByRole('row').filter({ hasText: 'Synthetic legacy dish' });
        await browserExpect(row).toContainText('Sin dato');
        await browserExpect(row.getByRole('cell', { name: 'N/D', exact: true })).toHaveCount(2);
        await browserExpect(row).toContainText('Parcial');
      }
      await page.screenshot({ path: `.tmp/${report.name}-next-partial.png`, fullPage: true });
      await page.getByLabel('Fecha de inicio', { exact: true }).fill('2026-11-17');
      await page.getByLabel('Fecha de fin', { exact: true }).fill('2026-11-18');
      if (report.name === 'executive') await browserExpect(page.getByText('Período: 2026-11-16 → 2026-11-16', { exact: true })).toBeVisible();
      await refresh();
      if (report.name === 'executive') await browserExpect(page.getByText('Cobertura Sin datos · reportado $0.00', { exact: true })).toBeVisible();
      else await browserExpect(page.getByText('No hay datos de ventas en el período seleccionado', { exact: true })).toBeVisible();
      await page.getByLabel('Fecha de inicio', { exact: true }).fill('2026-11-20');
      await refresh(400);
      await browserExpect(page.getByRole('alert').filter({ hasText: 'No se pudo cargar' })).toBeVisible();
      if (report.name === 'executive') {
        // A failed report must leave the authorized branch selector usable.
        await browserExpect(page.getByRole('combobox', { name: 'Sucursal del reporte' })).toBeVisible();
        await page.getByRole('combobox', { name: 'Sucursal del reporte' }).click();
        await page.getByRole('option', { name: 'Synthetic Next COGS branch', exact: true }).click();
        await page.screenshot({ path: '.tmp/executive-next-query-error.png', fullPage: true });
      }
      await page.getByLabel('Fecha de inicio', { exact: true }).fill('2026-11-17');
      await refresh();
      await browserExpect(page.getByRole('alert').filter({ hasText: 'No se pudo cargar' })).toHaveCount(0);
      expect((await context.request.post('/api/auth/sign-out', { headers: { origin: baseURL }, data: {} })).status()).toBe(200);
      await refresh(401);
      // A failed read must not continue presenting the old response as current.
      if (report.name === 'executive') await browserExpect(page.getByText('Cobertura Sin datos · reportado $0.00', { exact: true })).toHaveCount(0);
      else await browserExpect(page.getByText('No hay datos de ventas en el período seleccionado', { exact: true })).toHaveCount(0);
      await browserExpect(page.getByRole('alert').filter({ hasText: 'No se pudo cargar' })).toBeVisible();
      if (report.name === 'executive')
        await browserExpect(page.getByRole('combobox', { name: 'Sucursal del reporte' })).toHaveCount(0);
      await login();
      await refresh();
      await browserExpect(page.getByRole('alert').filter({ hasText: 'No se pudo cargar' })).toHaveCount(0);
      if (report.name === 'executive')
        await browserExpect(page.getByRole('combobox', { name: 'Sucursal del reporte' })).toBeVisible();
      expect(errors).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await browserExpect(page.getByLabel('Fecha de inicio', { exact: true })).toBeVisible();
      await browserExpect(page.getByRole('button', { name: 'Sucursal: Synthetic Next COGS branch', exact: true })).toBeVisible();
      await browserExpect(page.getByRole('button', { name: 'Fecha: Todo el período', exact: true })).toBeVisible();
      await page.screenshot({ path: `.tmp/${report.name}-next-mobile.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const tabTo = async (target: ReturnType<typeof page.getByLabel>) => {
        // Native date inputs expose several segments as separate Tab stops.
        for (let step = 0; step < 6; step++) {
          if (await target.evaluate(element => document.activeElement === element)) return;
          await page.keyboard.press('Tab');
        }
        await browserExpect(target).toBeFocused();
      };
      await page.getByLabel('Fecha de inicio', { exact: true }).focus();
      await tabTo(page.getByLabel('Fecha de fin', { exact: true }));
      await tabTo(page.getByRole('button', { name: report.refresh, exact: true }));
      await page.getByRole('button', { name: 'Fecha: Todo el período', exact: true }).focus();
      await page.keyboard.press('Enter');
      await browserExpect(page.getByRole('menuitem', { name: 'Todo el período', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      expect(errors).toEqual([]);
      await page.getByRole('button', { name: 'Sucursal: Synthetic Next COGS branch', exact: true }).focus();
      await page.keyboard.press('Enter');
      await browserExpect(page.getByRole('menuitem', { name: 'Synthetic sibling branch', exact: true })).toBeVisible();
      await browserExpect(page.getByRole('menuitem', { name: 'Synthetic foreign branch', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
    } finally { await context.close(); }
  }, 240_000);
}

afterAll(async () => {
  if (!enabled) return;
  try { await browser?.close(); }
  finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        console.info('Stopping synthetic report server');
        // Next CLI owns a worker; target only this test's process tree and
        // bound the helper so a stalled taskkill cannot skip fixture cleanup.
        if (process.platform === 'win32') {
          const stop = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true, stdio: 'ignore', timeout: 15_000, killSignal: 'SIGKILL',
          });
          const [code] = await once(stop, 'exit');
          // A signal-terminated child keeps exitCode=null. Wait for its exit
          // event before deciding whether a nonzero helper result is a failure.
          if (child.exitCode === null && child.signalCode === null) {
            try { await once(child, 'exit', { signal: AbortSignal.timeout(15_000) }); }
            catch { throw new Error(`Synthetic report server still running after taskkill (${code})`); }
          }
        } else { child.kill('SIGTERM'); await once(child, 'exit'); }
      }
      if (baseURL) {
        // A fresh TCP probe avoids reusing fetch's stale keep-alive socket.
        const address = new URL(baseURL);
        const closedBy = Date.now() + 5000;
        while (true) {
          const listening = await new Promise<boolean>((resolve, reject) => {
            const socket = createConnection({ host: address.hostname, port: Number(address.port) });
            socket.setTimeout(1500);
            socket.once('connect', () => { socket.destroy(); resolve(true); });
            socket.once('timeout', () => { socket.destroy(); reject(new Error('Could not verify synthetic server shutdown')); });
            socket.once('error', error => {
              socket.destroy();
              if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false);
              else reject(error);
            });
          });
          if (!listening) break;
          if (Date.now() >= closedBy) throw new Error('Synthetic report server still accepts connections');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } finally { if (seeded) {
      console.info('Removing synthetic report fixtures');
      await db.transaction(async tx => {
        await tx.delete(sessions).where(inArray(sessions.userId, actorIds));
        await tx.delete(account).where(inArray(account.userId, actorIds));
        await tx.delete(users).where(inArray(users.id, actorIds));
        await tx.delete(salesEntries).where(eq(salesEntries.companyId, companyId));
        await tx.delete(recipes).where(eq(recipes.id, recipeId));
        for (const id of [branchId, siblingBranchId, foreignBranchId]) await tx.delete(branches).where(eq(branches.id, id));
        for (const id of [companyId, foreignCompanyId]) await tx.delete(companies).where(eq(companies.id, id));
      });
      for (const id of [companyId, foreignCompanyId])
        expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
      expect(await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.userId, actorIds))).toEqual([]);
      console.info('Synthetic report fixtures removed and verified');
    } }
  }
}, 180_000);

it.skipIf(!enabled)('Next + Chromium + Better Auth: partial and empty COGS, tenant boundaries and logout', async () => {
  const context = await browser!.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const endpoint = `/api/inventory/reports/cogs?branchId=${branchId}&startDate=2026-11-16&endDate=2026-11-16`;
    expect((await context.request.get(endpoint)).status()).toBe(401);
    const login = await signIn(context.request);
    expect(login.status()).toBe(200);
    // Browser context receives the signed cookie from the real login response.
    const report = await context.request.get(endpoint);
    expect(report.status()).toBe(200);
    expect((await report.json()).report).toMatchObject({ reportedRevenueCents: 1200, revenueCents: null,
      foodCostPercent: null, revenueCoverage: { status: 'PARTIAL', totalEntries: 1 } });
    expect((await context.request.get(endpoint.replace(branchId, foreignBranchId))).status()).toBe(403);
    expect((await context.request.get(endpoint, { headers: { 'x-pulso-tenant-id': foreignCompanyId } })).status()).toBe(403);
    await context.addCookies([{ name: 'pulso_selected_branch', value: branchId, url: baseURL }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // The initial client effect is a hydration signal; an SSR tab can be
    // visible before its click handler is attached on a cold dev compilation.
    const hydrated = page.waitForRequest(r => new URL(r.url()).pathname === '/api/inventory/reports/usage', { timeout: 90_000 });
    await page.goto('/dashboard/inventory/reports/operational', { timeout: 180_000 });
    await hydrated;
    await page.getByRole('tab', { name: 'COGS', exact: true }).click();
    await browserExpect(page.getByRole('tab', { name: 'COGS', exact: true })).toHaveAttribute('data-state', 'active');
    await page.getByLabel('Fecha Inicio').fill('2026-11-16');
    await page.getByLabel('Fecha Fin').fill('2026-11-16');
    await browserExpect(page.getByRole('status').filter({ hasText: 'Ingresos incompletos' })).toContainText('$12.00', { timeout: 30_000 });
    for (const label of ['Ventas del periodo', 'Food Cost %'])
      await browserExpect(page.getByText(label, { exact: true }).locator('..').locator('p').last()).toHaveText('—');
    await page.screenshot({ path: '.tmp/cogs-next-partial.png', fullPage: true });
    await page.getByLabel('Fecha Inicio').fill('2026-11-17');
    await page.getByLabel('Fecha Fin').fill('2026-11-18');
    await browserExpect(page.getByRole('status').filter({ hasText: 'Sin ventas registradas' })).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
    expect((await context.request.post('/api/auth/sign-out', { headers: { origin: baseURL }, data: {} })).status()).toBe(200);
    expect((await context.request.get(endpoint)).status()).toBe(401);
  } finally { await context.close(); }
}, 240_000);

it.skipIf(!enabled)('Next + Chromium + Better Auth: manual sales amounts, denied writes, logout and recovery', async () => {
  // A read-capable supervisor cannot manage inventory. This independently
  // prevents append-only writes, even if a broken UI submits the wrong day.
  const context = await browser!.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const login = async () => {
      const response = await signIn(context.request, readerId);
      expect(response.status()).toBe(200);
    };
    await login();
    await context.addCookies([{ name: 'pulso_selected_branch', value: branchId, url: baseURL }]);
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const before = await db.select().from(salesEntries).where(eq(salesEntries.companyId, companyId));
    await page.goto('/dashboard/inventory/reports', { timeout: 180_000 });
    const form = page.getByRole('region', { name: 'Captura manual de ventas', exact: true });
    await form.getByRole('combobox', { name: 'Receta / Platillo', exact: true }).click();
    await page.getByRole('option', { name: 'Synthetic legacy dish', exact: true }).click();
    await form.getByLabel('Fecha de venta', { exact: true }).fill('2026-11-16');
    await form.getByLabel('Cantidad', { exact: true }).fill('8');
    await form.getByLabel('Ingreso Venta ($)', { exact: true }).fill('80.25');
    const submit = async (status: number, amount: number | null) => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/sales-entry' && r.request().method() === 'POST');
      await form.getByRole('button', { name: 'Guardar total', exact: true }).click();
      const received = await response;
      expect(received.status()).toBe(status);
      expect(received.request().postDataJSON()).toMatchObject({ branchId, saleDate: '2026-11-16',
        sales: [{ recipeId, totalRevenue: amount }] });
      await browserExpect(form.getByRole('alert')).toContainText((await received.json()).error);
      await browserExpect(form.getByRole('region', { name: 'Resultado de captura' })).toHaveCount(0);
    };
    await submit(403, 80.25);
    await form.getByLabel('Ingreso Venta ($)', { exact: true }).fill('0');
    await form.getByLabel('Cantidad', { exact: true }).fill('0');
    await submit(403, 0);
    await browserExpect(form.getByLabel('Ingreso Venta ($)', { exact: true })).toHaveValue('0');
    await form.getByLabel('Ingreso Venta ($)', { exact: true }).fill('');
    expect((await context.request.post('/api/auth/sign-out', { headers: { origin: baseURL }, data: {} })).status()).toBe(200);
    await submit(401, null);
    await login();
    await submit(403, null);
    expect(await db.select().from(salesEntries).where(eq(salesEntries.companyId, companyId))).toEqual(before);
    expect(await db.select({ id: salesConsumptionIdentities.id }).from(salesConsumptionIdentities)
      .where(eq(salesConsumptionIdentities.companyId, companyId))).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await browserExpect(form.getByRole('alert')).toBeVisible();
    await browserExpect(page.getByRole('link', { name: 'Importar CSV de ventas', exact: true })).toHaveAttribute('href', '/dashboard/inventory/sales-entry');
    expect(await page.locator('input[type=file]').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await form.getByLabel('Cantidad', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await browserExpect(form.getByLabel('Ingreso Venta ($)', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await browserExpect(form.getByRole('button', { name: 'Guardar total', exact: true })).toBeFocused();
    await page.screenshot({ path: '.tmp/manual-sales-next-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}, 240_000);
