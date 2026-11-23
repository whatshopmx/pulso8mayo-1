import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import type { db } from '@/lib/db';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';

// SQL/service verification, including explicit runtime selection. Does not
// replace HTTP session/R2/Next gates or activate operational secrets.
const enabled = process.env.RUN_POS_STORAGE_RUNTIME === '1';
const previousDatabase = process.env.DATABASE_URL;
const previousRuntime = process.env.POS_FILES_RUNTIME_DATABASE_URL;
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let pool: Pool | undefined;
let runtime: typeof db;
let service: typeof import('@/lib/services/pos-cut-file-service');
const company = randomUUID(), foreignCompany = randomUUID();
const branch = randomUUID(), sibling = randomUUID(), foreignBranch = randomUUID();
const ownCut = randomUUID(), siblingCut = randomUUID(), foreignCut = randomUUID(), otherDayCut = randomUUID();
const day = '2026-11-22';
const reference = (branchId: string, companyId = company) => `companies/${companyId}/branches/${branchId}/pos/${day}/1_evidence.csv`;
const scope = { companyId: company, branchId: branch };

beforeAll(async () => {
  if (!enabled) return;
  fixture = await createSalesRuntimeDatabase({ baseline: '0158' });
  process.env.DATABASE_URL = fixture.ownerUrl;
  process.env.POS_FILES_RUNTIME_DATABASE_URL = fixture.runtimeUrl;
  pool = new Pool({ connectionString: fixture.runtimeUrl, max: 1, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => console.error('[pos-runtime-test] pooled connection error'));
  runtime = drizzle(pool, { schema }) as unknown as typeof db;
  service = await import('@/lib/services/pos-cut-file-service');
  await fixture.owner.insert(schema.companies).values([
    { id: company, name: 'Synthetic POS runtime company' }, { id: foreignCompany, name: 'Synthetic POS runtime foreign' },
  ]);
  await fixture.owner.insert(schema.branches).values([
    { id: branch, companyId: company, name: 'Synthetic POS runtime branch' },
    { id: sibling, companyId: company, name: 'Synthetic POS runtime sibling' },
    { id: foreignBranch, companyId: foreignCompany, name: 'Synthetic POS runtime foreign' },
  ]);
  await fixture.owner.insert(schema.dailySalesCuts).values([
    { id: ownCut, companyId: company, branchId: branch, businessDate: day, rawFileUrl: reference(branch) },
    { id: siblingCut, companyId: company, branchId: sibling, businessDate: day, rawFileUrl: reference(sibling) },
    { id: foreignCut, companyId: foreignCompany, branchId: foreignBranch, businessDate: day, rawFileUrl: reference(foreignBranch, foreignCompany) },
    { id: otherDayCut, companyId: company, branchId: branch, businessDate: '2026-11-21', rawFileUrl: null },
  ].map(cut => ({ ...cut, shift: 'COMPLETO' as const, channel: 'TOTAL' as const, source: 'MANUAL_FORM' as const, totalSales: 12345 })));
  // Establish the missing-grant baseline before installing the actual candidate.
  await expect(pool.query('SELECT id FROM public.daily_sales_cuts')).rejects.toMatchObject({ code: '42501' });
  for (const statement of readFileSync('drizzle/0155_pos_storage_rls.sql', 'utf8').split('--> statement-breakpoint')) {
    await fixture.owner.execute(sql.raw(statement.replaceAll('pulso_app', fixture.roleName)));
  }
}, 150_000);

afterAll(async () => {
  try { await pool?.end(); }
  finally {
    try { await fixture?.close(); }
    finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousRuntime === undefined) delete process.env.POS_FILES_RUNTIME_DATABASE_URL;
      else process.env.POS_FILES_RUNTIME_DATABASE_URL = previousRuntime;
    }
  }
}, 90_000);

it.skipIf(!enabled)('POS runtime login is independent, unprivileged and restricted to the declared cut columns', async () => {
  const role = (await pool!.query(`SELECT current_user,session_user,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
    has_table_privilege(current_user,'public.daily_sales_cuts','SELECT') AS general_select,
    has_table_privilege(current_user,'public.daily_sales_cuts','UPDATE') AS general_update,
    has_column_privilege(current_user,'public.daily_sales_cuts','total_sales','UPDATE') AS update_amount
    FROM pg_roles r WHERE rolname=current_user`)).rows[0];
  expect(role).toEqual({ current_user: fixture!.roleName, session_user: fixture!.roleName,
    rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, memberships: 0,
    general_select: false, general_update: false, update_amount: false });
  expect((await pool!.query('SELECT id FROM public.daily_sales_cuts')).rows).toEqual([]);
  for (const statement of ['SELECT * FROM public.daily_sales_cuts',
    'UPDATE public.daily_sales_cuts SET total_sales=0', 'DELETE FROM public.daily_sales_cuts']) {
    await expect(pool!.query(statement)).rejects.toMatchObject({ code: '42501' });
  }
}, 30_000);

it.skipIf(!enabled)('POS runtime read scopes company/branch and never leaks context on the reused connection', async () => {
  expect(await service.readPosCutFileRecord(scope, ownCut, runtime)).toMatchObject({ id: ownCut, rawFileUrl: reference(branch) });
  expect(await service.readPosCutFileRecord(scope, siblingCut, runtime)).toBeUndefined();
  expect(await service.readPosCutFileRecord(scope, foreignCut, runtime)).toBeUndefined();
  expect(await service.readPosCutFileRecord({ companyId: company }, siblingCut, runtime)).toMatchObject({ id: siblingCut });
  expect(await service.readPosCutFileRecord({ companyId: foreignCompany, branchId: foreignBranch }, ownCut, runtime)).toBeUndefined();
  // Broad SQL (no WHERE): RLS must clear at transaction end even on max:1.
  expect((await pool!.query('SELECT id FROM public.daily_sales_cuts')).rows).toEqual([]);
}, 30_000);

it.skipIf(!enabled)('POS runtime link commits only the matching company/branch/day and preserves monetary fields', async () => {
  const key = reference(branch).replace('1_evidence', '2_linked');
  expect(await service.linkPosCutFileRecord({ ...scope, businessDate: day }, key, 'Synthetic runtime link', runtime)).toEqual([{ id: ownCut }]);
  const ownerRows = await fixture!.owner.select({ id: schema.dailySalesCuts.id, key: schema.dailySalesCuts.rawFileUrl,
    total: schema.dailySalesCuts.totalSales }).from(schema.dailySalesCuts);
  expect(ownerRows).toHaveLength(4);
  expect(ownerRows.find(row => row.id === ownCut)).toEqual({ id: ownCut, key, total: 12345 });
  expect(ownerRows.find(row => row.id === siblingCut)).toEqual({ id: siblingCut, key: reference(sibling), total: 12345 });
  expect(ownerRows.find(row => row.id === foreignCut)).toEqual({ id: foreignCut, key: reference(foreignBranch, foreignCompany), total: 12345 });
  expect(ownerRows.find(row => row.id === otherDayCut)).toEqual({ id: otherDayCut, key: null, total: 12345 });
  expect(await service.readPosCutFileRecord(scope, ownCut, runtime)).toMatchObject({ rawFileUrl: key });
  expect((await pool!.query('SELECT id FROM public.daily_sales_cuts')).rows).toEqual([]);
}, 30_000);

it.skipIf(!enabled)('POS runtime refuses a missing company and unknown targets without changing stored links', async () => {
  const before = await fixture!.owner.select().from(schema.dailySalesCuts).where(eq(schema.dailySalesCuts.id, ownCut));
  await expect(service.readPosCutFileRecord({ companyId: '' }, ownCut, runtime)).rejects.toThrow('companyId');
  expect(await service.linkPosCutFileRecord({ ...scope, businessDate: '2026-11-20' }, reference(branch), 'No match', runtime)).toEqual([]);
  expect(await service.readPosCutFileRecord(scope, randomUUID(), runtime)).toBeUndefined();
  expect(await fixture!.owner.select().from(schema.dailySalesCuts).where(eq(schema.dailySalesCuts.id, ownCut))).toEqual(before);
}, 30_000);

it.skipIf(!enabled)('configured POS runtime services read/link through their own login, commit and close their pools', async () => {
  const held = await pool!.connect();
  try {
  const key = reference(branch).replace('1_evidence', '3_configured');
  expect(await service.readPosCutFileRecord(scope, ownCut)).toMatchObject({ id: ownCut });
  expect(await service.readPosCutFileRecord(scope, siblingCut)).toBeUndefined();
  expect(await service.readPosCutFileRecord(scope, foreignCut)).toBeUndefined();
  expect(await service.linkPosCutFileRecord({ ...scope, businessDate: day }, key, 'Configured runtime')).toEqual([{ id: ownCut }]);
  expect(await fixture!.owner.select({ key: schema.dailySalesCuts.rawFileUrl, total: schema.dailySalesCuts.totalSales })
    .from(schema.dailySalesCuts).where(eq(schema.dailySalesCuts.id, ownCut))).toEqual([{ key, total: 12345 }]);
  const connections = await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname=${fixture!.databaseName} AND usename=${fixture!.roleName}`);
  // Only the explicit max:1 test pool remains; every application pool ended.
  expect(connections.rows[0].n).toBe(1);
  } finally { held.release(); }
}, 45_000);

it.skipIf(!enabled)('configured POS runtime rejects owner, broad column grants and missing RLS without effects or fallback', async () => {
  const before = await fixture!.owner.select().from(schema.dailySalesCuts).where(eq(schema.dailySalesCuts.id, ownCut));
  const rejectBoth = async () => {
    await expect(service.readPosCutFileRecord(scope, ownCut)).rejects.toMatchObject({ statusCode: 503 });
    await expect(service.linkPosCutFileRecord({ ...scope, businessDate: day }, 'rejected', 'Must not write')).rejects.toMatchObject({ statusCode: 503 });
    expect(await fixture!.owner.select().from(schema.dailySalesCuts).where(eq(schema.dailySalesCuts.id, ownCut))).toEqual(before);
  };
  process.env.POS_FILES_RUNTIME_DATABASE_URL = fixture!.ownerUrl;
  try { await rejectBoth(); }
  finally { process.env.POS_FILES_RUNTIME_DATABASE_URL = fixture!.runtimeUrl; }
  const role = `"${fixture!.roleName}"`;
  for (const [grant, restore] of [
    [`GRANT SELECT ON public.daily_sales_cuts TO ${role}`, `REVOKE SELECT ON public.daily_sales_cuts FROM ${role}`],
    [`GRANT UPDATE(total_sales) ON public.daily_sales_cuts TO ${role}`, `REVOKE UPDATE(total_sales) ON public.daily_sales_cuts FROM ${role}`],
    ['ALTER TABLE public.daily_sales_cuts DISABLE ROW LEVEL SECURITY', 'ALTER TABLE public.daily_sales_cuts ENABLE ROW LEVEL SECURITY'],
  ]) {
    expect(await service.readPosCutFileRecord(scope, ownCut)).toMatchObject({ id: ownCut });
    await fixture!.owner.execute(sql.raw(grant));
    try { await rejectBoth(); }
    finally {
      await fixture!.owner.execute(sql.raw(restore));
      // Table-level REVOKE removes column grants too. Restore the actual
      // declared minimum so each negative starts from a working role.
      const minimum = readFileSync('drizzle/0155_pos_storage_rls.sql', 'utf8').split('--> statement-breakpoint').at(-1)!;
      await fixture!.owner.execute(sql.raw(minimum.replaceAll('pulso_app', fixture!.roleName)));
    }
    expect(await service.readPosCutFileRecord(scope, ownCut)).toMatchObject({ id: ownCut });
  }
  expect(await service.readPosCutFileRecord(scope, ownCut)).toMatchObject({ id: ownCut });
}, 60_000);
