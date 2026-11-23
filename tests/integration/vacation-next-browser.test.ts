import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { account, branches, companies, notificationPreferences, users, vacationRequests } from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import { startSalesRuntimeNextServer } from './helpers/sales-runtime-next-server';

const previous = { database: process.env.DATABASE_URL, runtime: process.env.VACATIONS_RUNTIME_DATABASE_URL };
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;

beforeAll(async () => {
  fixture = await createSalesRuntimeDatabase({ baseline: '0158', grants: 'none' });
  await fixture.owner.transaction(async tx => {
    for (const statement of readFileSync('drizzle/0163_nom02c1_vacation_runtime.sql', 'utf8')
      .split('--> statement-breakpoint').filter(value => value.trim())) {
      await tx.execute(sql.raw(statement.replaceAll('pulso_vacations_app', fixture!.roleName)));
    }
  });
  process.env.DATABASE_URL = fixture.ownerUrl;
  process.env.VACATIONS_RUNTIME_DATABASE_URL = fixture.runtimeUrl;
}, 180_000);

afterAll(async () => {
  try { await fixture?.close(); }
  finally {
    for (const [key, value] of [['DATABASE_URL', previous.database], ['VACATIONS_RUNTIME_DATABASE_URL', previous.runtime]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
}, 90_000);

it('Next + Better Auth + Chromium: solicitud, decisión y cancelación por alcance con runtime dedicado', async () => {
  const companyId = randomUUID(), branchId = randomUUID();
  const siblingBranch = randomUUID(), foreignCompany = randomUUID(), foreignBranch = randomUUID();
  const managerId = randomUUID(), workerId = randomUUID(), ownerId = randomUUID();
  const siblingId = randomUUID(), foreignId = randomUUID();
  const password = `Synthetic-${randomUUID()}`, now = new Date();
  const passwordHash = await hashPassword(password);
  await fixture!.owner.insert(companies).values([
    { id: companyId, name: 'Synthetic vacation browser' }, { id: foreignCompany, name: 'Synthetic foreign company' },
  ]);
  await fixture!.owner.insert(branches).values([
    { id: branchId, companyId, name: 'Synthetic vacation branch' },
    { id: siblingBranch, companyId, name: 'Synthetic sibling branch' },
    { id: foreignBranch, companyId: foreignCompany, name: 'Synthetic foreign branch' },
  ]);
  await fixture!.owner.insert(users).values([
    { id: managerId, role: 'GERENTE' as const, name: 'Synthetic Vacation Manager', companyId, branchId },
    { id: workerId, role: 'EMPLEADO' as const, name: 'Synthetic Vacation Worker', companyId, branchId },
    { id: ownerId, role: 'OWNER' as const, name: 'Synthetic Vacation Owner', companyId, branchId: null },
    { id: siblingId, role: 'EMPLEADO' as const, name: 'Synthetic Vacation Sibling', companyId, branchId: siblingBranch },
    { id: foreignId, role: 'EMPLEADO' as const, name: 'Synthetic Vacation Foreign', companyId: foreignCompany, branchId: foreignBranch },
  ].map(user => ({ ...user, email: `${user.id}@example.invalid`, emailVerified: true, createdAt: now, updatedAt: now })));
  const allUsers = [managerId, workerId, ownerId, siblingId, foreignId];
  await fixture!.owner.insert(account).values(allUsers.map(userId => ({
    id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: passwordHash, createdAt: now, updatedAt: now,
  })));
  await fixture!.owner.insert(notificationPreferences).values(allUsers.map(userId => ({
    userId, whatsappEnabled: false, emailEnabled: false, inAppEnabled: true,
  })));
  const seeded = await fixture!.owner.insert(vacationRequests).values([
    { userId: workerId, companyId, branchId },
    { userId: siblingId, companyId, branchId: siblingBranch },
    { userId: foreignId, companyId: foreignCompany, branchId: foreignBranch },
  ].map(row => ({ ...row, startDate: new Date('2026-12-10T12:00:00Z'), endDate: new Date('2026-12-12T12:00:00Z'), totalDays: 3 }))).returning();
  const server = await startSalesRuntimeNextServer(fixture!);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const session = async (userId: string, mobile = false) => {
      const context = await browser!.newContext({ baseURL: server.baseURL, timezoneId: 'America/Mexico_City',
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
      expect((await context.request.post('/api/auth/sign-in/email', { headers: { origin: server.baseURL },
        data: { email: `${userId}@example.invalid`, password } })).status()).toBe(200);
      await context.addCookies([{ name: 'pulso_selected_branch', value: branchId, url: server.baseURL }]);
      return context;
    };
    const errors: string[] = [];
    const manager = await session(managerId);
    const page = await manager.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const list = page.waitForResponse(response => new URL(response.url()).pathname === '/api/vacations');
    await page.goto('/dashboard/labor/vacations', { timeout: 90_000 });
    expect((await list).status()).toBe(200);
    await browserExpect(page.getByRole('row').filter({ hasText: 'Synthetic Vacation Worker' })).toHaveCount(1);
    await browserExpect(page.getByRole('row').filter({ hasText: 'Synthetic Vacation Sibling' })).toHaveCount(0);
    await browserExpect(page.getByRole('row').filter({ hasText: 'Synthetic Vacation Foreign' })).toHaveCount(0);
    expect((await manager.request.get(`/api/vacations?branchId=${siblingBranch}`)).status()).toBe(403);
    expect((await manager.request.post('/api/vacations/approve', {
      data: { id: seeded.find(row => row.userId === foreignId)!.id, action: 'APPROVED' },
    })).status()).toBe(404);

    const worker = await session(workerId, true);
    const own = await worker.newPage();
    own.on('pageerror', error => errors.push(error.message));
    await own.goto('/dashboard/labor/vacations', { timeout: 90_000 });
    await browserExpect(own.getByRole('row').filter({ hasText: 'Synthetic Vacation Worker' })).toHaveCount(1);
    await browserExpect(own.getByRole('button', { name: 'Aprobar', exact: true })).toHaveCount(0);
    expect((await worker.request.get(`/api/vacations?companyId=${foreignCompany}`)).status()).toBe(403);
    const outsideOwn = await worker.request.get(`/api/vacations?userId=${siblingId}`);
    expect(outsideOwn.status()).toBe(200);
    expect((await outsideOwn.json()).data).toEqual([]);
    expect((await worker.request.post('/api/vacations/approve', {
      data: { id: seeded[0].id, action: 'APPROVED' },
    })).status()).toBe(403);
    await own.getByRole('button', { name: 'Solicitar Vacaciones', exact: true }).click();
    await own.getByLabel('Fecha de Inicio *', { exact: true }).fill('2026-12-20');
    await own.getByLabel('Fecha de Fin *', { exact: true }).fill('2026-12-19');
    const invalid = own.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/vacations');
    await own.getByRole('button', { name: 'Solicitar', exact: true }).click();
    expect((await invalid).status()).toBe(400);
    await browserExpect(own.getByRole('dialog').getByRole('alert')).toContainText('inválida');
    await own.getByLabel('Fecha de Fin *', { exact: true }).fill('2026-12-22');
    const creation = own.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/vacations');
    await own.getByRole('button', { name: 'Solicitar', exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(200);
    const id = (await created.json()).data.id as string;
    await browserExpect(own.getByRole('dialog')).toHaveCount(0);

    await page.reload();
    const row = page.getByRole('row').filter({ hasText: 'Synthetic Vacation Worker' }).last();
    await row.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await page.getByLabel('Comentarios (Aprobación)', { exact: true }).fill('Revisión real por gerente');
    const approval = page.waitForResponse(response => new URL(response.url()).pathname === '/api/vacations/approve');
    await page.getByRole('dialog').getByRole('button', { name: 'Aprobar', exact: true }).click();
    expect((await approval).status()).toBe(200);
    const stored = (await fixture!.owner.execute(sql`SELECT status,approved_by,total_days FROM vacation_requests WHERE id=${id}`)).rows[0];
    expect(stored).toEqual({ status: 'APPROVED', approved_by: managerId, total_days: 3 });
    expect((await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM notifications
      WHERE user_id=${workerId} AND title='Solicitud Aprobada' AND message='Vacaciones fue Aprobada'
        AND action_url=${`/dashboard/labor/vacations?id=${id}`}`)).rows[0].n).toBe(1);
    await page.screenshot({ path: '.tmp/vacation-next-browser-manager.png', fullPage: true });

    await own.reload();
    own.once('dialog', dialog => dialog.accept());
    const cancellation = own.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/vacations');
    await own.getByRole('row').filter({ hasText: 'Aprobada' }).getByRole('button', { name: 'Cancelar solicitud', exact: true }).click();
    expect((await cancellation).status()).toBe(200);
    await browserExpect(own.getByRole('row').filter({ hasText: 'Cancelada' })).toHaveCount(1);
    expect((await fixture!.owner.execute(sql`SELECT status,approved_by,cancelled_at IS NOT NULL AS cancelled FROM vacation_requests WHERE id=${id}`)).rows[0])
      .toEqual({ status: 'CANCELLED', approved_by: managerId, cancelled: true });
    expect((await worker.request.delete(`/api/vacations?id=${id}`)).status()).toBe(409);
    await own.screenshot({ path: '.tmp/vacation-next-browser-worker.png', fullPage: true });

    const owner = await session(ownerId);
    const all = await owner.newPage();
    all.on('pageerror', error => errors.push(error.message));
    await all.goto('/dashboard/labor/vacations', { timeout: 90_000 });
    await browserExpect(all.getByRole('row').filter({ hasText: 'Synthetic Vacation Sibling' })).toHaveCount(1);
    await browserExpect(all.getByRole('row').filter({ hasText: 'Synthetic Vacation Foreign' })).toHaveCount(0);
    await all.getByRole('row').filter({ hasText: 'Synthetic Vacation Sibling' }).getByRole('button', { name: 'Aprobar', exact: true }).click();
    await all.getByLabel('Motivo de Rechazo', { exact: true }).fill('Revisión corporativa real');
    const rejection = all.waitForResponse(response => new URL(response.url()).pathname === '/api/vacations/approve');
    await all.getByRole('dialog').getByRole('button', { name: 'Rechazar', exact: true }).click();
    expect((await rejection).status()).toBe(200);
    expect((await fixture!.owner.execute(sql`SELECT status,rejected_by FROM vacation_requests WHERE user_id=${siblingId}`)).rows[0])
      .toEqual({ status: 'REJECTED', rejected_by: ownerId });
    expect((await fixture!.owner.execute(sql`SELECT status FROM vacation_requests WHERE user_id=${foreignId}`)).rows[0].status).toBe('PENDING');

    // Real admission failure, no request interception: unsafe DB configuration
    // must be visible, clear stale rows, and recover after RLS is restored.
    await fixture!.owner.execute(sql`ALTER TABLE vacation_requests DISABLE ROW LEVEL SECURITY`);
    try {
      const unavailable = own.waitForResponse(response => new URL(response.url()).pathname === '/api/vacations');
      await own.reload();
      expect((await unavailable).status()).toBe(503);
      await browserExpect(own.getByRole('alert').filter({ hasText: 'No se pudo habilitar vacaciones' })).toBeVisible();
      await browserExpect(own.getByRole('row').filter({ hasText: 'Synthetic Vacation Worker' })).toHaveCount(0);
    } finally { await fixture!.owner.execute(sql`ALTER TABLE vacation_requests ENABLE ROW LEVEL SECURITY`); }
    await own.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await browserExpect(own.getByRole('row').filter({ hasText: 'Synthetic Vacation Worker' })).toHaveCount(2);
    await browserExpect(own.getByRole('alert').filter({ hasText: 'No se pudo habilitar vacaciones' })).toHaveCount(0);
    // A date selected by a Mexico City browser must survive the UTC server.
    await browserExpect(own.getByRole('row').filter({ hasText: 'Cancelada' })).toContainText('20 dic 2026');
    await browserExpect(own.getByRole('row').filter({ hasText: 'Cancelada' })).toContainText('22 dic 2026');
    expect((await worker.request.post('/api/auth/sign-out', { headers: { origin: server.baseURL }, data: {} })).status()).toBe(200);
    expect((await worker.request.get('/api/vacations')).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally { try { await browser?.close(); } finally { await server.close(); } }
}, 300_000);
