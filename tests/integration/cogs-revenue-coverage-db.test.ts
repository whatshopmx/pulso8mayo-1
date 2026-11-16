import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { branches, companies, inventoryItems, recipes, recipeItems, salesEntries,
  salesConsumptionIdentities, salesConsumptionRevisions } from '@/lib/db/schema';

// Only bind the service transaction to the rollback fixture; queries and RLS are real.
const boundary = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/db/tenant-context', async original => ({
  ...await original<typeof import('@/lib/db/tenant-context')>(),
  withCompanyContext: boundary.run,
}));
import { setTenantContext } from '@/lib/db/tenant-context';
import { InventoryReportsService } from '@/lib/services/inventory-reports-service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const day = new Date('2026-11-16T00:00:00Z');

async function probe(check: (tx: Tx, f: { company: string[]; branch: string[]; recipe: string[] }) => Promise<void>) {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  const pair = () => [randomUUID(), randomUUID()];
  const f = { company: pair(), branch: [randomUUID(), randomUUID(), randomUUID()], recipe: pair() };
  const item = pair();
  const rollback = new Error('COGS fixture rollback');
  try { await db.transaction(async tx => {
    await tx.insert(companies).values(f.company.map(id => ({ id, name: 'Synthetic COGS company' })));
    await tx.insert(branches).values(f.branch.map((id, n) => ({ id, companyId: f.company[n === 2 ? 1 : 0], name: 'Synthetic COGS branch' })));
    await tx.insert(inventoryItems).values(item.map((id, n) => ({ id, companyId: f.company[n], name: 'Ingredient', unit: 'KG', averageCost: 200 })));
    await tx.insert(recipes).values(f.recipe.map((id, n) => ({ id, companyId: f.company[n], name: `Dish ${n}`, baseYield: '1', unit: 'PORTION' })));
    await tx.insert(recipeItems).values(item.map((itemId, n) => ({ recipeId: f.recipe[n], itemId, quantity: '0.5', unit: 'KG' })));
    for (let n = 0; n < 3; n++) {
      const companyId = f.company[n === 2 ? 1 : 0], branchId = f.branch[n], recipeId = f.recipe[n === 2 ? 1 : 0];
      await setTenantContext(tx, { companyId, branchId });
      await tx.insert(salesEntries).values({ companyId, branchId, recipeId, quantitySold: '3', saleDate: day, totalRevenue: 1200 });
      const [identity] = await tx.insert(salesConsumptionIdentities).values({ companyId, branchId, source: 'pos:cogs-test', productKey: 'dish', saleDay: '2026-11-16' }).returning();
      await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId, branchId, recipeId,
        revision: 1, previousQuantitySold: '0', quantitySold: '3', totalRevenue: n === 1 ? null : 1200,
        recipeSnapshot: { schemaVersion: 1, recipeId, versionKey: 'test', definition: {} },
        allocations: [], movementRefs: [], recordedBy: 'cogs-runtime-test' });
    }
    // Other suites grant broad catalog permissions. Reconstruct the declared
    // column grants inside rollback so those grants cannot hide a reader bug.
    for (const table of ['recipes', 'recipe_items', 'inventory_items']) {
      const cols = await tx.execute<{ name: string }>(sql`SELECT quote_ident(attname) AS name FROM pg_attribute
        WHERE attrelid=${`public.${table}`}::regclass AND attnum>0 AND NOT attisdropped`);
      await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES ON public.${table} FROM pulso_app`));
      await tx.execute(sql.raw(`REVOKE ALL PRIVILEGES (${cols.rows.map(c => c.name).join(',')}) ON public.${table} FROM pulso_app`));
    }
    await tx.execute(sql.raw(readFileSync('drizzle/0138_inv01b_recipe_reader.sql', 'utf8').split('--> statement-breakpoint').at(-1)!));
    await tx.execute(sql.raw(readFileSync('drizzle/0141_inv01b_import_recipe_name.sql', 'utf8')));
    // Candidate migration is exercised only inside this rollback transaction.
    const migration = readFileSync('drizzle/0154_inv01b_cogs_reader.sql', 'utf8');
    if (migration.trim()) await tx.execute(sql.raw(migration));
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
    const role = (await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0];
    expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });
    boundary.run.mockImplementation(async (scope, fn) => {
      await setTenantContext(tx, scope);
      return fn(tx);
    });
    await check(tx, f);
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
  for (const id of f.company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
}

it('COGS runtime: complete and partial revenue, cost oracle and two companies / three branches', async () => {
  await probe(async (_tx, f) => {
    const report = (company: number, branch: number) => InventoryReportsService.getCogsReport(f.company[company], f.branch[branch], day, day);
    expect(await report(0, 0)).toMatchObject({ revenueCents: 1200, cogsCents: 300, foodCostPercent: 25,
      revenueCoverage: { status: 'COMPLETE', totalEntries: 1, completeEntries: 1 }, byRecipe: [{ recipeName: 'Dish 0' }] });
    expect(await report(0, 1)).toMatchObject({ reportedRevenueCents: 1200, revenueCents: null, foodCostPercent: null,
      revenueCoverage: { status: 'PARTIAL', totalEntries: 1, completeEntries: 0 } });
    expect(await report(1, 2)).toMatchObject({ revenueCents: 1200, cogsCents: 300, byRecipe: [{ recipeName: 'Dish 1' }] });
    await expect(report(0, 2)).rejects.toThrow('Sucursal fuera de la empresa');
    expect(await InventoryReportsService.getCogsReport(f.company[0], f.branch[0], new Date('2026-11-17'), new Date('2026-11-18')))
      .toMatchObject({ revenueCents: null, foodCostPercent: null, revenueCoverage: { status: 'NO_DATA' } });
  });
});

it('COGS runtime: catalog has no rows without scope and hides foreign costs without a WHERE', async () => {
  await probe(async (tx, f) => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', '', true), set_config('app.current_branch_id', '', true)`);
    expect((await tx.select({ cost: inventoryItems.averageCost }).from(inventoryItems))).toEqual([]);
    await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
    expect(await tx.select({ id: inventoryItems.companyId, cost: inventoryItems.averageCost }).from(inventoryItems))
      .toEqual([{ id: f.company[0], cost: 200 }]);
    const privileges = (await tx.execute(sql`SELECT
      has_table_privilege(current_user, 'inventory_items', 'SELECT') AS whole_table,
      has_column_privilege(current_user, 'inventory_items', 'name', 'SELECT') AS unrelated,
      has_table_privilege(current_user, 'inventory_items', 'UPDATE') AS write`)).rows[0];
    expect(privileges).toEqual({ whole_table: false, unrelated: false, write: false });
  });
});

it('COGS runtime: latest revision distinguishes explicit zero from unknown revenue', async () => {
  await probe(async (tx, f) => {
    const report = () => InventoryReportsService.getCogsReport(f.company[0], f.branch[0], day, day);
    for (const [revision, totalRevenue] of [[2, 0], [3, null]] as const) {
      await tx.execute(sql.raw('RESET ROLE'));
      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      const [identity] = await tx.select({ id: salesConsumptionIdentities.id }).from(salesConsumptionIdentities)
        .where(eq(salesConsumptionIdentities.branchId, f.branch[0]));
      await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId: f.company[0], branchId: f.branch[0],
        recipeId: f.recipe[0], revision, previousRevision: revision - 1, previousQuantitySold: '3', quantitySold: '3', totalRevenue,
        recipeSnapshot: { schemaVersion: 1, recipeId: f.recipe[0], versionKey: 'test', definition: {} },
        allocations: [], movementRefs: [], recordedBy: 'cogs-runtime-correction-test' });
      await tx.update(salesEntries).set({ totalRevenue: 0 }).where(eq(salesEntries.branchId, f.branch[0]));
      await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
      expect(await report()).toMatchObject({ revenueCents: totalRevenue, reportedRevenueCents: 0, foodCostPercent: null,
        revenueCoverage: { status: totalRevenue === null ? 'PARTIAL' : 'COMPLETE' } });
    }
  });
});
