import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Browser } from '@playwright/test';
import { account, users, companies, branches, recipes, recipeItems, inventoryItems, inventoryBatches,
  inventoryMovements, salesEntries, salesConsumptionRevisions } from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import { startSalesRuntimeNextServer } from './helpers/sales-runtime-next-server';

const enabled = process.env.RUN_SALES_RUNTIME_NEXT_BROWSER === '1';
// All cases use one disposable database; writing scenarios use disjoint tenants.
// Avoid repeatedly contending for the shared source database's template lock.
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
const originalDatabaseUrl = process.env.DATABASE_URL;
beforeAll(async () => {
  if (enabled) {
    fixture = await createSalesRuntimeDatabase({
      ...(process.env.RUN_SALES_FRESH_BASELINE === '1' ? { baseline: '0158' as const } : {}),
      posFiles: process.env.RUN_POS_FILES_RUNTIME_NEXT === '1',
    });
    // Application helpers and their host-process dependencies use the copy,
    // never the shared source database, and load only after it exists.
    process.env.DATABASE_URL = fixture.ownerUrl;
  }
}, 150_000);
afterAll(async () => {
  try { await fixture?.close(); }
  finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}, 90_000);

it.skipIf(!enabled || process.env.RUN_SALES_RUNTIME_POS !== '1')('Next HTTP + R2 + real writer runtime: POS ingestion and evidence', async () => {
  const { verifyPosRuntimeScenario } = await import('./helpers/pos-runtime-scenario');
  await verifyPosRuntimeScenario(fixture!);
}, 300_000);

it.skipIf(!enabled || process.env.RUN_SALES_RUNTIME_POS !== '1')('Next HTTP + R2 + real writer runtime: POS alternate executor', async () => {
  const { verifyPosRuntimeScenario } = await import('./helpers/pos-runtime-scenario');
  await verifyPosRuntimeScenario(fixture!, 'alternate');
}, 300_000);

it.skipIf(!enabled || process.env.RUN_SALES_RUNTIME_POS !== '1')('Next + Chromium + real session: POS library installation and editor persistence', async () => {
  const { verifyPosTemplateInstallation } = await import('./helpers/pos-template-runtime-scenario');
  await verifyPosTemplateInstallation(fixture!);
}, 180_000);

it.skipIf(!enabled || process.env.RUN_POS_FILES_RUNTIME_NEXT !== '1')('Next + real POS file runtime: rejects owner configuration without reading or linking cuts', async () => {
  const { chromium } = await import('@playwright/test');
  const { seedCsvRuntimeScenario } = await import('./helpers/csv-runtime-scenario');
  const { dailySalesCuts } = await import('@/lib/db/schema');
  const database = fixture!, scenario = await seedCsvRuntimeScenario(database), cutId = randomUUID();
  expect(database.posFileRuntimeUrl).toBe(database.runtimeUrl);
  const fileUrl = `companies/${scenario.companyId}/branches/${scenario.branchId}/pos/2026-11-22/1_not-uploaded.csv`;
  await database.owner.insert(dailySalesCuts).values({ id: cutId, companyId: scenario.companyId,
    branchId: scenario.branchId, businessDate: '2026-11-22', shift: 'COMPLETO', channel: 'TOTAL',
    totalSales: 12345, source: 'MANUAL_FORM', rawFileUrl: fileUrl });
  const before = await database.owner.select().from(dailySalesCuts).where(eq(dailySalesCuts.id, cutId));
  const stateBefore = await scenario.state();
  const server = await startSalesRuntimeNextServer({ ...database, posFileRuntimeUrl: database.ownerUrl });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL });
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${scenario.actorId}@example.invalid`, password: scenario.password } })).status()).toBe(200);
      for (const response of [await context.request.get(`/api/sales/cuts/${cutId}/pos-file`),
        await context.request.post('/api/workflows/smart-links/upload-pos', { data: {
          branchId: scenario.branchId, businessDate: '2026-11-22', fileUrl,
        } })]) {
        expect(response.status()).toBe(503);
        expect((await response.json()).error.message).toBe('No se pudo habilitar el acceso al archivo POS. Inténtalo de nuevo o contacta al administrador.');
      }
      expect(await database.owner.select().from(dailySalesCuts).where(eq(dailySalesCuts.id, cutId))).toEqual(before);
      expect(await scenario.state()).toEqual(stateBefore);
    } finally { await context.close(); }
  } finally { try { await browser?.close(); } finally { await server.close(); } }
}, 150_000);

it.skipIf(!enabled)('disposable sales database preserves RLS and immutable triggers and cleans up', async () => {
    const count = (await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`)).rows[0];
    expect(Number(count.n)).toBeGreaterThan(190);
    const triggers = (await fixture!.owner.execute(sql`SELECT tgname FROM pg_trigger WHERE tgname IN
      ('sale_consumption_identity_immutable','sale_consumption_revision_immutable') ORDER BY tgname`)).rows;
    expect(triggers.map(row => row.tgname)).toEqual(['sale_consumption_identity_immutable', 'sale_consumption_revision_immutable']);
    expect((await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relrowsecurity AND c.relname IN ('recipes','recipe_items','inventory_items','unit_conversions',
        'inventory_batches','inventory_movements','sales_entries','sales_consumption_identities','sales_consumption_revisions')`)).rows[0].n).toBe(9);
    expect((await fixture!.owner.execute(sql`SELECT
      has_table_privilege(${fixture!.roleName},'public.recipes','SELECT') AS all_recipes,
      has_table_privilege(${fixture!.roleName},'public.recipes','UPDATE') AS update_recipes,
      has_table_privilege(${fixture!.roleName},'public.inventory_batches','DELETE') AS delete_batches,
      has_table_privilege(${fixture!.roleName},'public.sales_entries','DELETE') AS delete_sales,
      has_table_privilege(${fixture!.roleName},'public.inventory_movements','UPDATE') AS update_movements,
      has_column_privilege(${fixture!.roleName},'public.recipes','name','SELECT') AS recipe_name`)).rows[0])
      .toEqual({ all_recipes: false, update_recipes: false, delete_batches: false, delete_sales: false, update_movements: false, recipe_name: true });
}, 90_000);

it.skipIf(!enabled)('production Next starts with separate owner/runtime secrets and shuts down cleanly', async () => {
    const server = await startSalesRuntimeNextServer(fixture!);
    try { expect((await fetch(`${server.baseURL}/api/auth/get-session`)).status).toBe(401); }
    finally { await server.close(); }
}, 150_000);

it.skipIf(!enabled)('Next + Chromium + real runtime: rejects owner fallback, then saves/corrects/repeats/completes/cancels manual sales', async () => {
  const { hashPassword } = await import('better-auth/crypto');
  const { chromium, expect: browserExpect } = await import('@playwright/test');
  const database = fixture!;
  let server: Awaited<ReturnType<typeof startSalesRuntimeNextServer>> | undefined;
  let browser: Browser | undefined;
  const companyId = randomUUID(), branchId = randomUUID(), recipeId = randomUUID(), itemId = randomUUID(), batchId = randomUUID(), actorId = randomUUID();
  const password = `Synthetic-${randomUUID()}`, now = new Date(), hash = await hashPassword(password);
  try {
    await database.owner.transaction(async tx => {
      await tx.insert(companies).values({ id: companyId, name: 'Synthetic Next runtime company' });
      await tx.insert(branches).values({ id: branchId, companyId, name: 'Synthetic Next runtime branch' });
      await tx.insert(inventoryItems).values({ id: itemId, companyId, name: 'Synthetic Next runtime ingredient', unit: 'KG' });
      await tx.insert(recipes).values({ id: recipeId, companyId, name: 'Synthetic Next runtime dish', baseYield: '1', unit: 'PORTION' });
      await tx.insert(recipeItems).values({ recipeId, itemId, quantity: '1', unit: 'KG', yieldPercent: 100 });
      await tx.insert(inventoryBatches).values({ id: batchId, branchId, itemId, initialQuantity: '20', currentQuantity: '20',
        status: 'AVAILABLE', expirationDate: new Date('2099-01-01') });
      await tx.insert(users).values({ id: actorId, companyId, branchId, role: 'ADMIN', email: `${actorId}@example.invalid`,
        name: 'Synthetic Next runtime actor', emailVerified: true, createdAt: now, updatedAt: now });
      await tx.insert(account).values({ id: randomUUID(), userId: actorId, accountId: actorId, providerId: 'credential',
        password: hash, createdAt: now, updatedAt: now });
    });
    const state = () => database.owner.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${companyId}, true), set_config('app.current_branch_id', ${branchId}, true)`);
      return {
        stock: (await tx.select({ quantity: inventoryBatches.currentQuantity }).from(inventoryBatches).where(eq(inventoryBatches.id, batchId)))[0].quantity,
        movements: await tx.select({ id: inventoryMovements.id, quantity: inventoryMovements.quantityChange }).from(inventoryMovements)
          .where(eq(inventoryMovements.branchId, branchId)).orderBy(inventoryMovements.id),
        sales: await tx.select({ quantity: salesEntries.quantitySold, revenue: salesEntries.totalRevenue, updated: salesEntries.updatedAt })
          .from(salesEntries).where(and(eq(salesEntries.companyId, companyId), eq(salesEntries.branchId, branchId))),
        revisions: await tx.select({ id: salesConsumptionRevisions.id, revision: salesConsumptionRevisions.revision,
          quantity: salesConsumptionRevisions.quantitySold, revenue: salesConsumptionRevisions.totalRevenue })
          .from(salesConsumptionRevisions).where(eq(salesConsumptionRevisions.companyId, companyId)).orderBy(salesConsumptionRevisions.revision),
      };
    });
    browser = await chromium.launch({ headless: true });
    server = await startSalesRuntimeNextServer({ ...database, runtimeUrl: database.ownerUrl });
    const rejected = await browser.newContext({ baseURL: server.baseURL });
    try {
      expect((await rejected.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${actorId}@example.invalid`, password } })).status()).toBe(200);
      const before = await state();
      const response = await rejected.request.post('/api/inventory/sales-entry', { data: { branchId, saleDate: '2026-11-19',
        sales: [{ recipeId, quantitySold: 1, totalRevenue: 0 }] } });
      expect(response.status()).toBe(503);
      expect(await response.json()).toEqual({ error: 'No se pudo habilitar el registro de ventas. Inténtalo de nuevo o contacta al administrador.' });
      expect(await state()).toEqual(before);
    } finally { await rejected.close(); }
    await server.close(); server = undefined;

    server = await startSalesRuntimeNextServer(database);
    const context = await browser.newContext({ baseURL: server.baseURL, timezoneId: 'America/Mexico_City', viewport: { width: 1440, height: 1000 } });
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${actorId}@example.invalid`, password } })).status()).toBe(200);
      await context.addCookies([{ name: 'pulso_selected_branch', value: branchId, url: server.baseURL }]);
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/dashboard/inventory/reports', { timeout: 90_000 });
      const form = page.getByRole('region', { name: 'Captura manual de ventas', exact: true });
      await form.getByRole('combobox', { name: 'Receta / Platillo', exact: true }).click();
      await page.getByRole('option', { name: 'Synthetic Next runtime dish', exact: true }).click();
      // Recipe options arrive from the client effect, proving hydration before
      // editing the report's SSR date inputs as well as the capture day.
      await page.getByLabel('Fecha Inicio', { exact: true }).fill('2026-11-19');
      await page.getByLabel('Fecha Fin', { exact: true }).fill('2026-11-19');
      await form.getByLabel('Fecha de venta', { exact: true }).fill('2026-11-19');
      const submit = async (quantity: number, revenue: string, counts: object) => {
        await form.getByLabel('Cantidad', { exact: true }).fill(String(quantity));
        await form.getByLabel('Ingreso Venta ($)', { exact: true }).fill(revenue);
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/sales-entry' && r.request().method() === 'POST', { timeout: 90_000 });
        await form.getByRole('button', { name: 'Guardar total', exact: true }).click();
        const received = await response;
        expect(received.status()).toBe(200);
        const body = await received.json();
        expect(body).toMatchObject(counts);
        try {
          await browserExpect(form.getByRole('region', { name: 'Resultado de captura' })).toContainText('Total manual guardado', { timeout: 20_000 });
        } catch (error) {
          console.info('Synthetic manual diagnostic', { quantity, body, url: page.url(), errors });
          await page.screenshot({ path: '.tmp/manual-sales-runtime-next-failure.png', fullPage: true });
          console.info('Synthetic page content', await page.locator('body').innerText({ timeout: 5000 }));
          throw error;
        }
      };
      await submit(10, '', { inserted: 1, revenueComplete: false });
      expect((await state()).stock).toBe('10.0000');
      await submit(12, '', { updated: 1 });
      expect((await state()).stock).toBe('8.0000');
      await submit(8, '', { updated: 1 });
      const corrected = await state(); expect(corrected.stock).toBe('12.0000');
      await submit(8, '', { skipped: 1 });
      expect(await state()).toEqual(corrected);
      await submit(8, '80.25', { updated: 1, revenueComplete: true });
      const completed = await state();
      expect(completed.movements).toEqual(corrected.movements);
      expect(completed.sales[0]).toMatchObject({ quantity: '8.00', revenue: 8025 });
      await submit(0, '0', { updated: 1, revenueComplete: true });
      const cancelled = await state(); expect(cancelled.stock).toBe('20.0000');
      expect(cancelled.revisions).toHaveLength(5);
      await form.getByLabel('Cantidad', { exact: true }).fill('21');
      const stockFailure = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/sales-entry' && r.request().method() === 'POST', { timeout: 90_000 });
      await form.getByRole('button', { name: 'Guardar total', exact: true }).click();
      const rejectedStock = await stockFailure;
      expect(rejectedStock.status()).toBe(409);
      const stockError = await rejectedStock.json();
      expect(stockError).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      await browserExpect(form.getByRole('alert')).toContainText(stockError.error);
      expect(await state()).toEqual(cancelled);
      await submit(0, '0', { skipped: 1, revenueComplete: true });
      expect(await state()).toEqual(cancelled);
      const variance = page.getByRole('row').filter({ hasText: 'Synthetic Next runtime ingredient' });
      await browserExpect(variance).toContainText('Falta conteo', { timeout: 30_000 });
      await browserExpect(variance.getByRole('cell', { name: '—', exact: true })).toHaveCount(2);
      await browserExpect(variance).not.toContainText('Conforme');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '.tmp/manual-sales-runtime-next-mobile.png', fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const table = page.getByRole('table', { name: 'Variaciones de insumos', exact: true });
      await table.focus();
      const scrollBefore = await table.locator('..').evaluate(element => element.scrollLeft);
      await table.press(scrollBefore > 0 ? 'ArrowLeft' : 'ArrowRight');
      await browserExpect.poll(() => table.locator('..').evaluate(element => element.scrollLeft)).not.toBe(scrollBefore);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  } finally {
    try { await browser?.close(); }
    finally { await server?.close(); }
  }
}, 300_000);

it.skipIf(!enabled)('Next + Chromium + real runtime: CSV SKU survives rename, correction and revenue completion', async () => {
  const { chromium, expect: browserExpect } = await import('@playwright/test');
  const { seedCsvRuntimeScenario } = await import('./helpers/csv-runtime-scenario');
  const database = fixture!, scenario = await seedCsvRuntimeScenario(database);
  let server: Awaited<ReturnType<typeof startSalesRuntimeNextServer>> | undefined, browser: Browser | undefined;
  try {
    server = await startSalesRuntimeNextServer(database);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ baseURL: server.baseURL, timezoneId: 'America/Mexico_City', viewport: { width: 1440, height: 1000 } });
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
    let closing = false;
    await context.route('**/_next/static/**/*.js', async route => {
      await scriptsReady;
      if (closing) { await route.abort().catch(() => {}); return; }
      await route.continue();
    });
    try {
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${scenario.actorId}@example.invalid`, password: scenario.password } })).status()).toBe(200);
      await context.addCookies([{ name: 'pulso_selected_branch', value: scenario.branchId, url: server.baseURL }]);
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/dashboard/inventory/sales-entry', { timeout: 90_000, waitUntil: 'commit' });
      const fileInput = page.getByLabel('Archivo CSV', { exact: true });
      await browserExpect(fileInput).toBeVisible({ timeout: 90_000 });
      writeFileSync('.tmp/csv-sales-ssr-readiness.json', JSON.stringify(await fileInput.evaluate(element => ({
        disabled: element.matches(':disabled'), reactProps: Object.keys(element).some(key => key.startsWith('__reactProps$')),
      }))));
      await page.screenshot({ path: '.tmp/csv-sales-runtime-next-ssr.png', fullPage: true });
      await browserExpect(fileInput).toBeDisabled();
      releaseScripts();
      await browserExpect(fileInput).toBeEnabled({ timeout: 90_000 });
      await browserExpect(page.getByLabel('Sucursal destino')).toHaveCount(0);
      const row = (key: string, recipe: string, quantity: number | string, revenue = '') =>
        [key, recipe, quantity, revenue].map(value => `"${String(value).replaceAll('"', '""')}"`).join(',');
      const csv = (quantity: number, revenue = '') => `SKU,"Producto, receta",Cantidad,Ingreso\n${row('POS-01', scenario.recipeNames[0], quantity, revenue)}`;
      let uploaded = '';
      const upload = async (text: string, name: string, first = false) => {
        uploaded = text;
        await page.getByLabel('Archivo CSV', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
        try { await browserExpect(page.getByText(`Seleccionado: ${name}`, { exact: true })).toBeVisible(); }
        catch (error) {
          await page.screenshot({ path: '.tmp/csv-sales-runtime-selection-failure.png', fullPage: true });
          const observed = await page.getByLabel('Archivo CSV', { exact: true }).evaluate(element => ({
            state: document.readyState, files: Array.from((element as HTMLInputElement).files ?? []).map(file => file.name),
            reactProps: Object.keys(element).some(key => key.startsWith('__reactProps$')), body: document.body.innerText.slice(0, 3500),
          }));
          writeFileSync('.tmp/csv-sales-runtime-selection-failure.json', JSON.stringify({ observed, errors }, null, 2));
          throw error;
        }
        await browserExpect(page.getByLabel('Producto / receta *', { exact: true })).toBeVisible();
        if (first) {
          await page.getByLabel('Producto / receta *', { exact: true }).selectOption('Producto, receta');
          await page.getByLabel('Cantidad vendida *', { exact: true }).selectOption('Cantidad');
          await page.getByLabel('Ingreso $ (opcional)', { exact: true }).selectOption('Ingreso');
          await page.getByLabel('Clave del producto (opcional)', { exact: true }).selectOption('SKU');
        }
        await page.getByLabel(/Día del corte/).fill('2026-11-19');
        await browserExpect(page.getByLabel('Clave del producto (opcional)', { exact: true })).toHaveValue('SKU');
        await browserExpect(page.getByRole('region', { name: 'Vista previa de ventas', exact: true })).toBeVisible();
        await browserExpect(page.getByRole('region', { name: 'Resultado de importación', exact: true })).toHaveCount(0);
      };
      const submit = async (counts: object, status = 200) => {
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inventory/sales-entry/bulk' && r.request().method() === 'POST', { timeout: 90_000 });
        await page.getByRole('button', { name: /^Importar / }).click();
        const received = await response;
        expect(received.status()).toBe(status);
        expect(received.request().postDataJSON()).toMatchObject({ branchId: scenario.branchId, csvText: uploaded,
          defaultDay: '2026-11-19', mapping: { productKey: 'SKU', recipeRef: 'Producto, receta', quantitySold: 'Cantidad', totalRevenue: 'Ingreso' } });
        const body = await received.json(); expect(body).toMatchObject(counts);
        const result = page.getByRole('region', { name: 'Resultado de importación', exact: true });
        await browserExpect(result).toBeVisible();
        if (status !== 200) {
          await browserExpect(result).toContainText('Importación no completada');
          return body;
        }
        if (body.skipped) await browserExpect(result).toContainText(`${body.skipped} sin cambios`);
        if (body.updated) await browserExpect(result).toContainText(`${body.updated} corregida`);
        if (body.inserted) await browserExpect(result).toContainText(`${body.inserted} nueva`);
        await browserExpect(result).toContainText(body.revenueComplete ? 'Importación completada' : 'Ingreso incompleto');
        return body;
      };
      const stock = async () => (await scenario.state()).batches.find(batch => batch.id === scenario.batchIds[0])!.quantity;
      await upload(csv(10), 'inicial.csv', true);
      await submit({ inserted: 1, updated: 0, skipped: 0, revenueComplete: false, errors: [] });
      expect(await stock()).toBe('10.0000');
      const initial = await scenario.state();
      expect(initial.identities).toHaveLength(1);
      expect(initial.identities[0]).toMatchObject({ source: 'pos:import', productKey: 'POS-01', day: '2026-11-19' });
      expect(initial.revisions[0].revenue).toBe(null);
      await upload(csv(10), 'archivo-renombrado.csv');
      await submit({ inserted: 0, updated: 0, skipped: 1, revenueComplete: false, errors: [] });
      expect(await scenario.state()).toEqual(initial);
      await upload(csv(12), 'correccion.csv');
      await submit({ updated: 1, revenueComplete: false, errors: [] }); expect(await stock()).toBe('8.0000');
      await upload(csv(8), 'reduccion.csv');
      await submit({ updated: 1, revenueComplete: false, errors: [] }); expect(await stock()).toBe('12.0000');
      const beforeRevenue = await scenario.state();
      await upload(csv(8, '80.25'), 'ingreso.csv');
      await submit({ updated: 1, revenueComplete: true, errors: [] });
      const completed = await scenario.state();
      expect(completed.movements).toEqual(beforeRevenue.movements);
      expect(completed.sales).toHaveLength(1);
      expect(completed.sales[0]).toMatchObject({ recipeId: scenario.recipeIds[0], quantity: '8.00', revenue: 8025 });
      expect(completed.revisions).toHaveLength(4);
      expect((await context.request.post('/api/auth/sign-out', { headers: { origin: server.baseURL }, data: {} })).status()).toBe(200);
      await submit({}, 401);
      expect(await scenario.state()).toEqual(completed);
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${scenario.actorId}@example.invalid`, password: scenario.password } })).status()).toBe(200);
      await submit({ inserted: 0, updated: 0, skipped: 1, revenueComplete: true, errors: [] });
      expect(await scenario.state()).toEqual(completed);
      await upload(['SKU,"Producto, receta",Cantidad,Ingreso',
        row('POS-01', scenario.recipeNames[0], 8, '80.25'),
        row('POS-02', scenario.recipeNames[0], 1, '10'),
        row('POS-02', scenario.recipeNames[0], 'invalid', '10'),
        row('POS-03', scenario.recipeNames[1], 21, '210'),
        row('POS-04', scenario.recipeNames[0], 1, '10')].join('\n'), 'grupos.csv');
      const mixed = await submit({ inserted: 1, updated: 0, skipped: 1, revenueComplete: false });
      expect(mixed.errors.map((error: { rowNumber: number }) => error.rowNumber).sort()).toEqual([3, 4, 5]);
      const result = page.getByRole('region', { name: 'Resultado de importación', exact: true });
      for (const n of [3, 4, 5]) await browserExpect(result).toContainText(`Fila ${n}`);
      const grouped = await scenario.state();
      expect(await stock()).toBe('11.0000');
      expect(grouped.batches.find(batch => batch.id === scenario.batchIds[1])!.quantity).toBe('20.0000');
      expect(grouped.identities.map(identity => identity.productKey)).toEqual(['POS-01', 'POS-04']);
      expect(grouped.revisions).toHaveLength(5);
      expect(grouped.sales).toHaveLength(1);
      expect(grouped.sales[0]).toMatchObject({ recipeId: scenario.recipeIds[0], quantity: '9.00', revenue: 9025 });
      await upload(['SKU,"Producto, receta",Cantidad,Ingreso',
        row('POS-01', scenario.recipeNames[0], 0, '0'),
        row('POS-04', scenario.recipeNames[0], 0, '0')].join('\n'), 'cancelacion.csv');
      await submit({ inserted: 0, updated: 2, skipped: 0, revenueComplete: true, errors: [] });
      const cancelled = await scenario.state();
      expect(cancelled.batches.map(batch => batch.quantity)).toEqual(['20.0000', '20.0000']);
      expect(cancelled.sales[0]).toMatchObject({ quantity: '0.00', revenue: 0 });
      expect(cancelled.identities).toHaveLength(2);
      expect(cancelled.revisions).toHaveLength(7);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const preview = page.getByRole('region', { name: 'Vista previa de ventas', exact: true });
      await preview.focus();
      const scrollBefore = await preview.evaluate(element => element.scrollLeft);
      await preview.press(scrollBefore > 0 ? 'ArrowLeft' : 'ArrowRight');
      await browserExpect.poll(() => preview.evaluate(element => element.scrollLeft)).not.toBe(scrollBefore);
      await page.screenshot({ path: '.tmp/csv-sales-runtime-next-mobile.png', fullPage: true });
      expect(errors).toEqual([]);
    } finally { closing = true; releaseScripts(); await context.close(); }
  } finally { try { await browser?.close(); } finally { await server?.close(); } }
}, 300_000);
