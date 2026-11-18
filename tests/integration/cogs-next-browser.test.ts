import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { parse } from 'dotenv';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { account, users, sessions, companies, branches, recipes, salesEntries } from '@/lib/db/schema';

// Opt in: starts a complete Next dev server and commits only synthetic fixtures
// to the isolated integration database. No auth, Next, API or SQL mocks.
const enabled = process.env.RUN_COGS_NEXT_BROWSER === '1';
const companyId = randomUUID(), foreignCompanyId = randomUUID();
const branchId = randomUUID(), foreignBranchId = randomUUID();
const recipeId = randomUUID(), actorId = randomUUID();
const password = `Synthetic-${randomUUID()}`;
let child: ChildProcess | undefined, browser: Browser | undefined, baseURL: string;
let seeded = false;

beforeAll(async () => {
  if (!enabled) return;
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  if (existsSync('.next/dev/lock')) throw new Error('Existing Next dev server: do not replace it');
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
      { id: foreignBranchId, companyId: foreignCompanyId, name: 'Synthetic foreign branch' }]);
    await tx.insert(recipes).values({ id: recipeId, companyId, name: 'Synthetic legacy dish', baseYield: '1', unit: 'PORTION' });
    await tx.insert(salesEntries).values({ companyId, branchId, recipeId, quantitySold: '3', totalRevenue: 1200,
      saleDate: new Date('2026-11-16T00:00:00Z') });
    await tx.insert(users).values({ id: actorId, companyId, branchId, role: 'ADMIN', email: `${actorId}@example.invalid`,
      name: 'Synthetic COGS actor', emailVerified: true, createdAt: now, updatedAt: now });
    await tx.insert(account).values({ id: randomUUID(), userId: actorId, accountId: actorId, providerId: 'credential',
      password: hash, createdAt: now, updatedAt: now });
  });
  seeded = true;
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: randomUUID(), NEXT_PUBLIC_APP_URL: baseURL,
      // Avoid external integrations configured in the developer's .env.
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', RESEND_API_KEY: '',
      WASENDER_API_KEY: '', INNGEST_DEV: '1', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'ignore', windowsHide: true,
  });
  child.on('error', () => {});
  const deadline = Date.now() + 180_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited (${child.exitCode})`);
    try {
      // The product's session route returns 401 for an anonymous caller.
      ready = (await fetch(`${baseURL}/api/auth/get-session`, { signal: AbortSignal.timeout(5000) })).status === 401;
      if (ready) break;
    } catch { /* Next is still compiling. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Next did not become ready within 180 seconds');
  browser = await chromium.launch({ headless: true });
}, 240_000);

afterAll(async () => {
  if (!enabled) return;
  try { await browser?.close(); }
  finally {
    if (child && child.exitCode === null) {
      // Next CLI owns a worker; taskkill targets only this test's process tree.
      if (process.platform === 'win32') {
        const stop = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await once(stop, 'exit');
      } else { child.kill('SIGTERM'); await once(child, 'exit'); }
    }
    if (seeded) {
      await db.transaction(async tx => {
        await tx.delete(sessions).where(eq(sessions.userId, actorId));
        await tx.delete(account).where(eq(account.userId, actorId));
        await tx.delete(users).where(eq(users.id, actorId));
        await tx.delete(salesEntries).where(eq(salesEntries.companyId, companyId));
        await tx.delete(recipes).where(eq(recipes.id, recipeId));
        for (const id of [branchId, foreignBranchId]) await tx.delete(branches).where(eq(branches.id, id));
        for (const id of [companyId, foreignCompanyId]) await tx.delete(companies).where(eq(companies.id, id));
      });
      for (const id of [companyId, foreignCompanyId])
        expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
      expect(await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, actorId))).toEqual([]);
    }
  }
}, 60_000);

it.skipIf(!enabled)('Next + Chromium + Better Auth: partial and empty COGS, tenant boundaries and logout', async () => {
  const context = await browser!.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const endpoint = `/api/inventory/reports/cogs?branchId=${branchId}&startDate=2026-11-16&endDate=2026-11-16`;
    expect((await context.request.get(endpoint)).status()).toBe(401);
    const login = await context.request.post('/api/auth/sign-in/email', {
      headers: { origin: baseURL }, data: { email: `${actorId}@example.invalid`, password },
    });
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
    await page.goto('/dashboard/inventory/reports/operational', { timeout: 180_000 });
    await page.getByRole('tab', { name: 'COGS', exact: true }).click();
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
