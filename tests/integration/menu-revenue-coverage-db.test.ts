import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { branches, companies, recipes, salesEntries,
  salesConsumptionIdentities, salesConsumptionRevisions } from '@/lib/db/schema';

const boundary = vi.hoisted(() => ({ run: vi.fn(), companyId: '', branchId: null as string | null, role: 'ADMIN' }));
vi.mock('@/lib/db/tenant-context', async original => ({
  ...await original<typeof import('@/lib/db/tenant-context')>(), withCompanyContext: boundary.run,
}));
// Session boundary only; SQL, permissions, coverage and route calculations are real.
vi.mock('@/lib/tenant-context', () => ({
  requireTenant: async () => ({ id: boundary.companyId }),
  requireAuth: async () => ({ user: { role: boundary.role, branchId: boundary.branchId } }),
}));
import { setTenantContext } from '@/lib/db/tenant-context';
import { GET } from '@/app/api/inventory/menu-engineering/route';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = { company: string[]; branch: string[]; recipe: string[] };
const day = new Date('2026-11-18T00:00:00Z');
const request = (branchId?: string, period = '2026-11-18') => GET(new NextRequest(
  `http://localhost/api/inventory/menu-engineering?startDate=${period}&endDate=${period}${branchId ? `&branchId=${branchId}` : ''}`));

async function probe(check: (tx: Tx, f: Fixture) => Promise<void>) {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  const f = { company: [randomUUID(), randomUUID()], branch: [randomUUID(), randomUUID(), randomUUID()], recipe: [randomUUID(), randomUUID()] };
  const rollback = new Error('Menu fixture rollback');
  try { await db.transaction(async tx => {
    await tx.insert(companies).values(f.company.map(id => ({ id, name: 'Synthetic menu company' })));
    await tx.insert(branches).values(f.branch.map((id, n) => ({ id, companyId: f.company[n === 2 ? 1 : 0], name: 'Synthetic menu branch' })));
    await tx.insert(recipes).values(f.recipe.map((id, n) => ({ id, companyId: f.company[n], name: `Dish ${n}`, baseYield: '1', unit: 'PORTION', calculatedCost: 100 })));
    for (let n = 0; n < 3; n++) {
      const companyId = f.company[n === 2 ? 1 : 0], branchId = f.branch[n], recipeId = f.recipe[n === 2 ? 1 : 0];
      await setTenantContext(tx, { companyId, branchId });
      await tx.insert(salesEntries).values({ companyId, branchId, recipeId, quantitySold: '3', saleDate: day, totalRevenue: 1200 });
      const [identity] = await tx.insert(salesConsumptionIdentities).values({ companyId, branchId, source: 'pos:menu-test', productKey: 'dish', saleDay: '2026-11-18' }).returning();
      await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId, branchId, recipeId,
        revision: 1, previousQuantitySold: '0', quantitySold: '3', totalRevenue: n === 1 ? null : 1200,
        recipeSnapshot: { schemaVersion: 1, recipeId, versionKey: 'test', definition: {} },
        allocations: [], movementRefs: [], recordedBy: 'menu-runtime-test' });
    }
    const cols = await tx.execute<{ name: string }>(sql`SELECT quote_ident(attname) AS name FROM pg_attribute
      WHERE attrelid='public.recipes'::regclass AND attnum>0 AND NOT attisdropped`);
    await tx.execute(sql.raw('REVOKE ALL PRIVILEGES ON public.recipes FROM pulso_app'));
    await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES (${cols.rows.map(c => c.name).join(',')}) ON public.recipes FROM pulso_app`));
    await tx.execute(sql.raw(readFileSync('drizzle/0138_inv01b_recipe_reader.sql', 'utf8').split('--> statement-breakpoint').at(-1)!));
    await tx.execute(sql.raw(readFileSync('drizzle/0141_inv01b_import_recipe_name.sql', 'utf8')));
    await tx.execute(sql.raw(readFileSync('drizzle/0156_inv01b_menu_reader.sql', 'utf8')));
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
    expect((await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0])
      .toMatchObject({ rolbypassrls: false, rolsuper: false });
    boundary.role = 'ADMIN'; boundary.branchId = null; boundary.companyId = f.company[0];
    boundary.run.mockImplementation(async (scope, fn) => {
      // Clear settings between invocations just as separate request transactions do.
      await tx.execute(sql`SELECT set_config('app.current_branch_id', '', true)`);
      await setTenantContext(tx, scope);
      return fn(tx);
    });
    await check(tx, f);
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
  for (const id of f.company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
}

it('menu runtime: complete, partial, consolidated, empty and foreign branches under RLS', async () => {
  await probe(async (_tx, f) => {
    const complete = await request(f.branch[0]);
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({ items: [{ recipeId: f.recipe[0], revenueCents: 1200,
      foodCostPercent: 25, marginPercent: 75, quadrant: 'STAR', revenueCoverage: { status: 'COMPLETE' } }] });
    expect(await (await request(f.branch[1])).json()).toMatchObject({ items: [{ reportedRevenueCents: 1200,
      revenueCents: null, foodCostPercent: null, marginPercent: null, quadrant: 'UNCLASSIFIED' }] });
    expect(await (await request()).json()).toMatchObject({ items: [{ totalSold: 6, reportedRevenueCents: 2400,
      revenueCents: null, revenueCoverage: { status: 'PARTIAL', totalEntries: 2, completeEntries: 1 } }] });
    expect((await request(f.branch[2])).status).toBe(403);
    expect(await (await request(f.branch[0], '2026-11-19')).json()).toMatchObject({ items: [], medianMargin: null });
    boundary.companyId = f.company[1];
    expect(await (await request()).json()).toMatchObject({ items: [{ recipeId: f.recipe[1], revenueCents: 1200 }] });
  });
});

it('menu runtime: branch-bound manager cannot consolidate or redirect to a foreign branch', async () => {
  await probe(async (_tx, f) => {
    boundary.role = 'GERENTE'; boundary.branchId = f.branch[0];
    expect(await (await request(f.branch[2])).json()).toMatchObject({ items: [{ totalSold: 3, revenueCents: 1200 }] });
    boundary.branchId = null;
    expect((await request()).status).toBe(403);
  });
});

it('menu runtime: minimum cost grant hides foreign recipes and grants no general read or write', async () => {
  await probe(async (tx, f) => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', '', true), set_config('app.current_branch_id', '', true)`);
    expect(await tx.select({ cost: recipes.calculatedCost }).from(recipes)).toEqual([]);
    await setTenantContext(tx, { companyId: f.company[0] });
    expect(await tx.select({ id: recipes.id, cost: recipes.calculatedCost }).from(recipes))
      .toEqual([{ id: f.recipe[0], cost: 100 }]);
    expect((await tx.execute(sql`SELECT
      has_table_privilege(current_user, 'recipes', 'SELECT') AS whole_table,
      has_column_privilege(current_user, 'recipes', 'description', 'SELECT') AS unrelated,
      has_table_privilege(current_user, 'recipes', 'UPDATE') AS write`)).rows[0])
      .toEqual({ whole_table: false, unrelated: false, write: false });
    for (const query of [sql`SELECT * FROM recipes`, sql`UPDATE recipes SET calculated_cost=0 WHERE id=${f.recipe[0]}`]) {
      await tx.execute(sql`SAVEPOINT denied_menu_access`);
      await expect(tx.execute(query)).rejects.toThrow();
      await tx.execute(sql`ROLLBACK TO SAVEPOINT denied_menu_access`);
      await tx.execute(sql`RELEASE SAVEPOINT denied_menu_access`);
    }
  });
});

it('menu runtime: latest canonical revision distinguishes explicit zero from missing revenue', async () => {
  await probe(async (tx, f) => {
    for (const [revision, totalRevenue] of [[2, 0], [3, null]] as const) {
      await tx.execute(sql.raw('RESET ROLE'));
      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      const [identity] = await tx.select({ id: salesConsumptionIdentities.id }).from(salesConsumptionIdentities)
        .where(eq(salesConsumptionIdentities.branchId, f.branch[0]));
      await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId: f.company[0], branchId: f.branch[0],
        recipeId: f.recipe[0], revision, previousRevision: revision - 1, previousQuantitySold: '3', quantitySold: '3', totalRevenue,
        recipeSnapshot: { schemaVersion: 1, recipeId: f.recipe[0], versionKey: 'test', definition: {} },
        allocations: [], movementRefs: [], recordedBy: 'menu-runtime-correction-test' });
      await tx.update(salesEntries).set({ totalRevenue: 0 }).where(eq(salesEntries.branchId, f.branch[0]));
      await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
      const response = await request(f.branch[0]);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ items: [{ revenueCents: totalRevenue, reportedRevenueCents: 0,
        foodCostPercent: null, marginPercent: null, quadrant: 'UNCLASSIFIED',
        revenueCoverage: { status: totalRevenue === null ? 'PARTIAL' : 'COMPLETE' } }] });
    }
  });
});
