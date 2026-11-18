import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { branches, companies, inventoryItems, inventoryBatches, inventoryWaste, workflowInstances, workflowTemplates, recipes, recipeItems, salesEntries,
  salesConsumptionIdentities, salesConsumptionRevisions } from '@/lib/db/schema';

// Only bind the service transaction to the rollback fixture; queries and RLS are real.
const boundary = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/db/tenant-context', async original => ({
  ...await original<typeof import('@/lib/db/tenant-context')>(),
  withCompanyContext: boundary.run,
}));
import { setTenantContext } from '@/lib/db/tenant-context';
import { ExecutiveReportService } from '@/lib/services/executive-report-service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const day = new Date('2026-11-16T00:00:00Z');

async function probe(check: (tx: Tx, f: { company: string[]; branch: string[]; recipe: string[] }) => Promise<void>) {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, '');
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync('.env')).DATABASE_URL));
  const pair = () => [randomUUID(), randomUUID()];
  const f = { company: pair(), branch: [randomUUID(), randomUUID(), randomUUID()], recipe: pair() };
  const item = pair();
  const rollback = new Error('Executive fixture rollback');
  try { await db.transaction(async tx => {
    await tx.insert(companies).values(f.company.map(id => ({ id, name: 'Synthetic executive company' })));
    await tx.insert(branches).values(f.branch.map((id, n) => ({ id, companyId: f.company[n === 2 ? 1 : 0], name: 'Synthetic executive branch' })));
    await tx.insert(inventoryItems).values(item.map((id, n) => ({ id, companyId: f.company[n], name: 'Ingredient', unit: 'KG', averageCost: 200, minLevel: 5 })));
    await tx.insert(recipes).values(f.recipe.map((id, n) => ({ id, companyId: f.company[n], name: `Dish ${n}`, baseYield: '1', unit: 'PORTION' })));
    await tx.insert(recipeItems).values(item.map((itemId, n) => ({ recipeId: f.recipe[n], itemId, quantity: '0.5', unit: 'KG' })));
    for (let n = 0; n < 3; n++) {
      const companyId = f.company[n === 2 ? 1 : 0], branchId = f.branch[n], recipeId = f.recipe[n === 2 ? 1 : 0];
      await setTenantContext(tx, { companyId, branchId });
      await tx.insert(inventoryBatches).values({ itemId: item[n === 2 ? 1 : 0], branchId,
        initialQuantity: '4', currentQuantity: '4', unitCost: 200, status: 'AVAILABLE' });
      await tx.insert(salesEntries).values({ companyId, branchId, recipeId, quantitySold: '3', saleDate: day, totalRevenue: 1200 });
      const [identity] = await tx.insert(salesConsumptionIdentities).values({ companyId, branchId, source: 'pos:cogs-test', productKey: 'dish', saleDay: '2026-11-16' }).returning();
      await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId, branchId, recipeId,
        revision: 1, previousQuantitySold: '0', quantitySold: '3', totalRevenue: n === 1 ? null : 1200,
        recipeSnapshot: { schemaVersion: 1, recipeId, versionKey: 'test', definition: {} },
        allocations: [], movementRefs: [], recordedBy: 'cogs-runtime-test' });
    }
    const template = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await tx.insert(workflowTemplates).values([
      { id: template[0], companyId: f.company[0], name: 'Conteo de Inventario' },
      { id: template[1], companyId: f.company[1], name: 'Conteo de Inventario' },
      { id: template[2], companyId: f.company[0], name: 'Private HR workflow' },
      { id: template[3], companyId: null, name: 'Conteo de Inventario' },
    ]);
    await tx.insert(workflowInstances).values([
      { workflowTemplateId: template[0], branchId: f.branch[0], status: 'COMPLETED', completedAt: day,
        data: { results: [{ systemQuantity: 10, physicalQuantity: 10, variance: 0 }] } },
      { workflowTemplateId: template[1], branchId: f.branch[2], status: 'COMPLETED', completedAt: day,
        data: { results: [{ systemQuantity: 10, physicalQuantity: 1, variance: -9 }] } },
      { workflowTemplateId: template[2], branchId: f.branch[0], status: 'COMPLETED', completedAt: day, data: { private: 'hidden' } },
      { workflowTemplateId: template[3], branchId: f.branch[1], status: 'COMPLETED', completedAt: day,
        data: { results: [{ systemQuantity: 10, physicalQuantity: 10, variance: 0 }] } },
    ]);
    await tx.insert(inventoryWaste).values([
      { companyId: f.company[0], branchId: f.branch[0], quantity: '1', unit: 'KG', reason: 'SPILLAGE', totalLoss: 100, recordedBy: 'executive-test', recordedAt: day },
      { companyId: f.company[1], branchId: f.branch[2], quantity: '1', unit: 'KG', reason: 'SPILLAGE', totalLoss: 600, recordedBy: 'executive-test', recordedAt: day },
      { companyId: f.company[0], branchId: f.branch[0], quantity: '1', unit: 'KG', reason: 'STAFF', totalLoss: 999, recordedBy: 'executive-test', recordedAt: day },
      { companyId: f.company[0], branchId: f.branch[0], quantity: '1', unit: 'KG', reason: 'SPILLAGE', approvalStatus: 'PENDING_APPROVAL', totalLoss: 888, recordedBy: 'executive-test', recordedAt: day },
    ]);
    // Other suites grant broad catalog permissions. Reconstruct the declared
    // column grants inside rollback so those grants cannot hide a reader bug.
    for (const table of ['recipes', 'recipe_items', 'inventory_items', 'workflow_instances', 'workflow_templates', 'inventory_waste']) {
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
    await tx.execute(sql.raw(readFileSync('drizzle/0157_inv01b_executive_reader.sql', 'utf8')));
    for (const statement of readFileSync('drizzle/0158_inv01b_executive_sources.sql', 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) await tx.execute(sql.raw(statement));
    }
    await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
    const role = (await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0];
    expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });
    boundary.run.mockImplementation(async (scope, fn) => {
      await tx.execute(sql`SELECT set_config('app.current_branch_id', '', true)`);
      await setTenantContext(tx, scope);
      return fn(tx);
    });
    await check(tx, f);
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
  for (const id of f.company) expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
}

it('executive runtime: complete and partial branch revenue, consolidated coverage and isolation', async () => {
  await probe(async (_tx, f) => {
    const report = (company: number, branch?: number) => ExecutiveReportService.getReport(f.company[company], day, day,
      branch === undefined ? undefined : f.branch[branch]);
    const complete = await report(0, 0);
    expect(complete.consolidated).toMatchObject({ revenueCents: 1200, cogsCents: 300, foodCostPercent: 25,
      revenueCoverage: { status: 'COMPLETE', totalEntries: 1, completeEntries: 1 } });
    expect(complete.byBranch).toHaveLength(1);
    expect(complete.byBranch[0]).toMatchObject({ fillRate: 0, stockDays: 2.7, inventoryTurnover: 0.38, shrinkagePercent: 25, countAccuracy: 100 });
    expect((await report(0, 1)).consolidated).toMatchObject({ reportedRevenueCents: 1200, revenueCents: null,
      foodCostPercent: null, revenueCoverage: { status: 'PARTIAL', totalEntries: 1, completeEntries: 0 } });
    const group = await report(0);
    expect(group.byBranch.map(b => b.branchId).sort()).toEqual(f.branch.slice(0, 2).sort());
    expect(group.consolidated).toMatchObject({ reportedRevenueCents: 2400, revenueCents: null, cogsCents: 600,
      foodCostPercent: null, revenueCoverage: { status: 'PARTIAL', totalEntries: 2, completeEntries: 1 } });
    const foreign = await report(1);
    expect(foreign.byBranch.map(b => b.branchId)).toEqual([f.branch[2]]);
    expect(foreign.byBranch[0]).toMatchObject({ countAccuracy: 0, shrinkagePercent: 66.67 });
    await expect(report(0, 2)).rejects.toThrow('Sucursal fuera de la empresa');
    expect((await ExecutiveReportService.getReport(f.company[0], new Date('2026-11-17'), new Date('2026-11-18'))).consolidated)
      .toMatchObject({ revenueCents: null, foodCostPercent: null, revenueCoverage: { status: 'NO_DATA' } });
  });
});

it('executive sources: fail closed without context, isolate branches and hide non-inventory workflows', async () => {
  await probe(async (tx, f) => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', '', true), set_config('app.current_branch_id', '', true)`);
    expect(await tx.select({ data: workflowInstances.data }).from(workflowInstances)).toEqual([]);
    expect(await tx.select({ id: workflowTemplates.id }).from(workflowTemplates)).toEqual([]);
    expect(await tx.select({ loss: inventoryWaste.totalLoss }).from(inventoryWaste)).toEqual([]);
    await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
    const count = await tx.select({ branchId: workflowInstances.branchId, data: workflowInstances.data }).from(workflowInstances);
    expect(count).toEqual([{ branchId: f.branch[0], data: { results: [{ systemQuantity: 10, physicalQuantity: 10, variance: 0 }] } }]);
    expect((await tx.select({ branchId: inventoryWaste.branchId }).from(inventoryWaste)).every(r => r.branchId === f.branch[0])).toBe(true);
    expect((await tx.select({ min: inventoryItems.minLevel, active: inventoryItems.active }).from(inventoryItems)))
      .toEqual([{ min: 5, active: true }]);
    for (const table of ['workflow_instances', 'workflow_templates', 'inventory_waste', 'inventory_items']) {
      expect((await tx.execute(sql`SELECT has_table_privilege(current_user, ${table}, 'SELECT') AS whole_table,
        has_table_privilege(current_user, ${table}, 'INSERT') AS insert,
        has_table_privilege(current_user, ${table}, 'UPDATE') AS update,
        has_table_privilege(current_user, ${table}, 'DELETE') AS delete`)).rows[0])
        .toEqual({ whole_table: false, insert: false, update: false, delete: false });
    }
    for (const query of [sql`SELECT * FROM workflow_instances`, sql`SELECT * FROM workflow_templates`, sql`SELECT * FROM inventory_waste`,
      sql`UPDATE inventory_items SET min_level=0`, sql`UPDATE workflow_instances SET status='CANCELLED'`,
      sql`UPDATE workflow_templates SET name='tampered'`, sql`UPDATE inventory_waste SET total_loss=0`]) {
      await tx.execute(sql`SAVEPOINT denied_executive_access`);
      await expect(tx.execute(query)).rejects.toThrow();
      await tx.execute(sql`ROLLBACK TO SAVEPOINT denied_executive_access`);
      await tx.execute(sql`RELEASE SAVEPOINT denied_executive_access`);
    }
  });
});

it('executive runtime: canonical head distinguishes explicit zero from unknown revenue', async () => {
  await probe(async (tx, f) => {
    for (const [revision, totalRevenue] of [[2, 0], [3, null]] as const) {
      await tx.execute(sql.raw('RESET ROLE'));
      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      const [identity] = await tx.select({ id: salesConsumptionIdentities.id }).from(salesConsumptionIdentities)
        .where(eq(salesConsumptionIdentities.branchId, f.branch[0]));
      await tx.insert(salesConsumptionRevisions).values({ identityId: identity.id, companyId: f.company[0], branchId: f.branch[0],
        recipeId: f.recipe[0], revision, previousRevision: revision - 1, previousQuantitySold: '3', quantitySold: '3', totalRevenue,
        recipeSnapshot: { schemaVersion: 1, recipeId: f.recipe[0], versionKey: 'test', definition: {} },
        allocations: [], movementRefs: [], recordedBy: 'executive-correction-test' });
      await tx.update(salesEntries).set({ totalRevenue: 0 }).where(eq(salesEntries.branchId, f.branch[0]));
      await tx.execute(sql.raw('SET LOCAL ROLE pulso_app'));
      expect((await ExecutiveReportService.getReport(f.company[0], day, day, f.branch[0])).consolidated)
        .toMatchObject({ revenueCents: totalRevenue, reportedRevenueCents: 0, foodCostPercent: null,
          revenueCoverage: { status: totalRevenue === null ? 'PARTIAL' : 'COMPLETE' } });
    }
  });
});
