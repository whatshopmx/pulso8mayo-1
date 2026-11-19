import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { account, users, companies, branches, recipes, recipeItems, inventoryItems, inventoryBatches,
  inventoryMovements, salesEntries, salesConsumptionRevisions } from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import { startSalesRuntimeNextServer } from './helpers/sales-runtime-next-server';

const enabled = process.env.RUN_SALES_RUNTIME_NEXT_BROWSER === '1';
// All cases use one disposable copy; only the manual scenario writes data.
// Avoid repeatedly contending for the shared source database's template lock.
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
beforeAll(async () => { if (enabled) fixture = await createSalesRuntimeDatabase(); }, 150_000);
afterAll(async () => { await fixture?.close(); }, 90_000);

it.skipIf(!enabled)('disposable sales database copies RLS and immutable triggers and cleans up', async () => {
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
