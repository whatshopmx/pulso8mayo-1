import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import { seedCsvRuntimeScenario } from './helpers/csv-runtime-scenario';
import { configChangeLogs, inventoryItems, recipeConsumptionPolicies, recipeItems, recipeVersions, salesConsumptionRevisions } from '@/lib/db/schema';

const enabled = process.env.RUN_RECIPE_POLICY_RUNTIME === '1';
const previous = { database: process.env.DATABASE_URL, runtime: process.env.SALES_RUNTIME_DATABASE_URL,
  policy: process.env.SALES_RECIPE_POLICY_MODE };
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let withRuntime: typeof import('@/lib/db/sales-runtime').withSalesWriterTransaction;
let publish: typeof import('@/lib/services/recipe-consumption-publication').publishRecipeConsumptionPolicy;
let ingest: typeof import('@/lib/services/sales-ingest-service').SalesIngestService.ingest;
type Scenario = Awaited<ReturnType<typeof seedCsvRuntimeScenario>>;
const day = '2026-12-01';

beforeAll(async () => {
  if (!enabled) return;
  fixture = await createSalesRuntimeDatabase({ baseline: '0158' });
  await fixture.owner.transaction(async tx => {
    for (const file of ['0159_inv02_consumption_policy.sql', '0160_inv02_policy_publication_access.sql', '0162_prod01b_finished_consumption_grants.sql']) {
      for (const statement of readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').filter(value => value.trim())) {
        // Only the newly generated role, never the shared pulso_app role.
        await tx.execute(sql.raw(statement.replaceAll('pulso_app', fixture!.roleName)));
      }
    }
  });
  process.env.DATABASE_URL = fixture.ownerUrl;
  process.env.SALES_RUNTIME_DATABASE_URL = fixture.runtimeUrl;
  process.env.SALES_RECIPE_POLICY_MODE = 'PUBLISHED';
  withRuntime = (await import('@/lib/db/sales-runtime')).withSalesWriterTransaction;
  publish = (await import('@/lib/services/recipe-consumption-publication')).publishRecipeConsumptionPolicy;
  const { SalesIngestService } = await import('@/lib/services/sales-ingest-service');
  ingest = input => SalesIngestService.ingest(input);
}, 180_000);

afterAll(async () => {
  try { await fixture?.close(); }
  finally {
    for (const [name, value] of [['DATABASE_URL', previous.database], ['SALES_RUNTIME_DATABASE_URL', previous.runtime],
      ['SALES_RECIPE_POLICY_MODE', previous.policy]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  }
}, 90_000);

it.skipIf(!enabled)('INV-02 runtime: pristine baseline and independent login satisfy the actual writer guard', async () => {
  const identity = await withRuntime(async tx => (await tx.execute(sql`
    SELECT current_user AS actor, session_user AS login, current_database() AS database,
      (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user) AS memberships`)).rows[0]);
  expect(identity).toEqual({ actor: fixture!.roleName, login: fixture!.roleName, database: fixture!.databaseName, memberships: 0 });
  const tables = await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`);
  expect(tables.rows[0].n).toBe(207);
});

async function version(s: Scenario, quantity = '1.0000', index = 0, unit = 'PORTION') {
  const [line] = await fixture!.owner.select({ itemId: recipeItems.itemId }).from(recipeItems).where(eq(recipeItems.recipeId, s.recipeIds[index]));
  const [saved] = await fixture!.owner.insert(recipeVersions).values({ companyId: s.companyId, recipeId: s.recipeIds[index],
    versionNumber: 1, name: 'Synthetic immutable version', baseYield: '1.00', unit, calculatedCost: 100,
    priceSelling: 200, foodCostPercentage: '50.00', changedBy: s.actorId,
    itemsSnapshot: [{ itemId: line.itemId, quantity, unit: 'KG', isSubRecipe: false, yieldPercent: 100 }],
  }).returning();
  return saved;
}
const actor = (s: Scenario) => ({ companyId: s.companyId, userId: s.actorId, branchId: null, role: 'ADMIN' as const });
const policy = (s: Scenario, recipeVersionId: string, effectiveFrom = day, index = 0) => ({
  recipeId: s.recipeIds[index], recipeVersionId, effectiveFrom, mode: 'INGREDIENTS_ON_SALE', reason: 'Synthetic native policy publication',
});
const sale = (s: Scenario, quantitySold: number, extra = {}) => ingest({ companyId: s.companyId, branchId: s.branchId,
  userId: s.actorId, rows: [{ recipeRef: s.recipeIds[0], productKey: 'SKU-1', saleDay: day, quantitySold,
    totalRevenueCents: null, rowNumber: 2, ...extra }] });
const stock = (state: Awaited<ReturnType<Scenario['state']>>, s: Scenario) => state.batches.find(batch => batch.id === s.batchIds[0])!.quantity;
const facts = (s: Scenario) => fixture!.owner.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_company_id', ${s.companyId}, true), set_config('app.current_branch_id', '', true)`);
  return {
    policies: await tx.select().from(recipeConsumptionPolicies).where(eq(recipeConsumptionPolicies.companyId, s.companyId)),
    audits: await tx.select().from(configChangeLogs).where(eq(configChangeLogs.companyId, s.companyId)),
    snapshots: await tx.select({ snapshot: salesConsumptionRevisions.recipeSnapshot }).from(salesConsumptionRevisions)
      .where(eq(salesConsumptionRevisions.companyId, s.companyId)).orderBy(salesConsumptionRevisions.revision),
  };
});

it.skipIf(!enabled)('INV-02 runtime: archived demand survives commits, corrections, revenue and cancellation', async () => {
  const s = await seedCsvRuntimeScenario(fixture!), first = await version(s), next = await version(s, '3.0000');
  const saved = await publish(actor(s), policy(s, first.id));
  await fixture!.owner.update(recipeItems).set({ quantity: '99.0000' }).where(eq(recipeItems.recipeId, s.recipeIds[0]));
  expect(await sale(s, 10)).toMatchObject({ inserted: 1, errors: [] }); expect(stock(await s.state(), s)).toBe('10.0000');
  await publish(actor(s), policy(s, next.id, '2026-12-02'));
  expect(await sale(s, 12)).toMatchObject({ updated: 1, errors: [] }); expect(stock(await s.state(), s)).toBe('8.0000');
  expect(await sale(s, 8)).toMatchObject({ updated: 1, errors: [] }); expect(stock(await s.state(), s)).toBe('12.0000');
  const previousState = await s.state();
  expect(await sale(s, 8)).toMatchObject({ skipped: 1, errors: [] }); expect(await s.state()).toEqual(previousState);
  expect(await sale(s, 8, { totalRevenueCents: 8025 })).toMatchObject({ updated: 1, errors: [], revenueComplete: true });
  expect((await s.state()).movements).toEqual(previousState.movements);
  expect(await sale(s, 0, { totalRevenueCents: 0 })).toMatchObject({ updated: 1, errors: [] }); expect(stock(await s.state(), s)).toBe('20.0000');
  const frozen = await facts(s);
  expect(frozen.snapshots).toHaveLength(5);
  expect(new Set(frozen.snapshots.map(row => row.snapshot.versionKey)).size).toBe(1);
  expect(frozen.snapshots[0].snapshot.definition.recipes).toMatchObject([{ publication: { policy: { id: saved.policy.id }, recipeVersionId: first.id } }]);
  expect(await sale(s, 1, { saleDay: '2026-12-02' })).toMatchObject({ inserted: 1, errors: [] }); expect(stock(await s.state(), s)).toBe('17.0000');
}, 90_000);

it.skipIf(!enabled)('INV-02 runtime: real RLS, column grants, composite FK and owner immutability', async () => {
  const a = await seedCsvRuntimeScenario(fixture!), b = await seedCsvRuntimeScenario(fixture!);
  const va = await version(a), vb = await version(b), unpublishedForeign = await version(b);
  const pa = await publish(actor(a), policy(a, va.id)); await publish(actor(b), policy(b, vb.id));
  const scoped = <T>(run: Parameters<typeof withRuntime<T>>[0]) => withRuntime(async tx => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${a.companyId}, true), set_config('app.current_branch_id', ${a.branchId}, true)`);
    return run(tx);
  });
  expect(await scoped(tx => tx.select({ id: recipeConsumptionPolicies.id }).from(recipeConsumptionPolicies))).toEqual([{ id: pa.policy.id }]);
  expect(await scoped(tx => tx.select({ id: recipeVersions.id }).from(recipeVersions).where(eq(recipeVersions.companyId, b.companyId)))).toEqual([]);
  await expect(scoped(tx => tx.select({ cost: recipeVersions.calculatedCost }).from(recipeVersions))).rejects.toMatchObject({ cause: { code: '42501' } });
  await expect(scoped(tx => tx.select({ value: configChangeLogs.newValue }).from(configChangeLogs))).rejects.toMatchObject({ cause: { code: '42501' } });
  await expect(scoped(tx => tx.update(recipeConsumptionPolicies).set({ reason: 'Changed illegally' }))).rejects.toMatchObject({ cause: { code: '42501' } });
  await expect(scoped(tx => tx.insert(recipeConsumptionPolicies).values({ companyId: a.companyId, recipeId: a.recipeIds[0],
    recipeVersionId: unpublishedForeign.id, effectiveFrom: '2026-12-02', mode: 'INGREDIENTS_ON_SALE', publishedBy: a.actorId, reason: 'Invalid composite reference' })))
    .rejects.toMatchObject({ cause: { code: '23503' } });
  await expect(fixture!.owner.update(recipeVersions).set({ baseYield: '99.00' }).where(eq(recipeVersions.id, va.id)))
    .rejects.toMatchObject({ cause: { code: '23514' } });
  await expect(fixture!.owner.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${a.companyId}, true)`);
    return tx.delete(recipeConsumptionPolicies).where(eq(recipeConsumptionPolicies.id, pa.policy.id));
  })).rejects.toMatchObject({ cause: { code: '23514' } });
  expect((await facts(a)).policies).toHaveLength(1); expect(stock(await a.state(), a)).toBe('20.0000');
}, 90_000);

/** Confirm both independent transactions are actually waiting on the same
 * server lock before release. Promise.all alone would not prove overlap. */
async function overlapping(s: Scenario, work: () => Promise<unknown>[]) {
  const locker = new Pool({ connectionString: fixture!.ownerUrl, max: 1, connectionTimeoutMillis: 10_000 });
  const client = await locker.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`recipe-consumption-policy:${s.companyId}:${s.recipeIds[0]}`]);
    const running = Promise.allSettled(work());
    let barrierError: unknown;
    try {
      const deadline = Date.now() + 45_000;
      let waiting = 0;
      while (waiting < 2) {
        const state = await fixture!.owner.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=${fixture!.databaseName} AND usename=${fixture!.roleName}
            AND wait_event_type='Lock' AND wait_event='advisory'`);
        waiting = state.rows[0].n;
        if (waiting >= 2) break;
        if (Date.now() >= deadline) throw new Error(`Concurrent runtime barrier observed only ${waiting} advisory waiters`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(waiting).toBe(2);
    } catch (error) { barrierError = error; }
    finally { await client.query('COMMIT'); }
    const result = await running;
    if (barrierError) throw barrierError;
    return result;
  } finally {
    await client.query('ROLLBACK'); client.release(); await locker.end();
  }
}

it.skipIf(!enabled)('INV-02 runtime: overlapping publications retry to one immutable policy and one audit', async () => {
  const s = await seedCsvRuntimeScenario(fixture!), v = await version(s), input = policy(s, v.id);
  const results = await overlapping(s, () => [publish(actor(s), input), publish(actor(s), input)]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(results.map(result => result.status === 'fulfilled' ? (result.value as { status: string }).status : 'rejected').sort())
    .toEqual(['PUBLISHED', 'UNCHANGED']);
  const state = await facts(s); expect(state.policies).toHaveLength(1); expect(state.audits).toHaveLength(1);
  expect(stock(await s.state(), s)).toBe('20.0000');
}, 150_000);

it.skipIf(!enabled)('INV-02 runtime: overlapping sale and publication cannot reinterpret a committed sale day', async () => {
  const s = await seedCsvRuntimeScenario(fixture!), first = await version(s), next = await version(s, '3.0000');
  await publish(actor(s), policy(s, first.id));
  const results = await overlapping(s, () => [sale(s, 1, { saleDay: '2026-12-02' }), publish(actor(s), policy(s, next.id, '2026-12-02'))]);
  expect(results[0]).toMatchObject({ status: 'fulfilled', value: { inserted: 1, errors: [] } });
  const published = results[1].status === 'fulfilled';
  if (published) expect(results[1]).toMatchObject({ value: { status: 'PUBLISHED' } });
  else expect(results[1]).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } });
  const state = await facts(s);
  expect(state.policies).toHaveLength(published ? 2 : 1);
  expect(state.audits).toHaveLength(state.policies.length);
  expect(stock(await s.state(), s)).toBe(published ? '17.0000' : '19.0000');
  expect(state.snapshots).toHaveLength(1);
  expect(state.snapshots[0].snapshot.definition.recipes).toMatchObject([
    { publication: { recipeVersionId: published ? next.id : first.id } },
  ]);
}, 150_000);

it.skipIf(!enabled)('INV-02 runtime: missing coverage and finished-product mode leave no sale or consumption', async () => {
  const s = await seedCsvRuntimeScenario(fixture!), v = await version(s, '1.0000', 0, 'KG'), before = await s.state();
  expect(await sale(s, 1)).toMatchObject({ inserted: 0, revenueComplete: false, errors: [{ rowNumber: 2 }] });
  expect(await s.state()).toEqual(before);
  const item = v.itemsSnapshot as { itemId: string }[];
  await publish(actor(s), { ...policy(s, v.id), mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: item[0].itemId, unit: 'KG' });
  expect(await sale(s, 1)).toMatchObject({ inserted: 0, errors: [{ rowNumber: 2 }] });
  expect(await s.state()).toEqual(before);
  expect((await facts(s)).policies).toHaveLength(1);
}, 90_000);

it.skipIf(!enabled)('INV-02 runtime: a real audit failure rolls back publication across connections', async () => {
  const s = await seedCsvRuntimeScenario(fixture!), v = await version(s), trigger = `inv02_${randomUUID().replaceAll('-', '')}`;
  await fixture!.owner.execute(sql.raw(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.company_id='${s.companyId}'::uuid THEN RAISE EXCEPTION 'synthetic policy audit failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON public.config_change_logs FOR EACH ROW EXECUTE FUNCTION public.${trigger}();`));
  try {
    await expect(publish(actor(s), policy(s, v.id))).rejects.toMatchObject({ cause: { code: 'P0001' } });
    const state = await facts(s); expect(state.policies).toHaveLength(0); expect(state.audits).toHaveLength(0);
  } finally { await fixture!.owner.execute(sql.raw(`DROP TRIGGER ${trigger} ON public.config_change_logs; DROP FUNCTION public.${trigger}();`)); }
}, 90_000);

it.skipIf(!enabled)('INV-02 runtime: frozen subrecipe protects retroactivity and finished stock remains gated', async () => {
  const s = await seedCsvRuntimeScenario(fixture!), child = await version(s, '1.0000', 1, 'KG');
  const childNext = await version(s, '1.0000', 1, 'KG');
  const [finished] = await fixture!.owner.insert(inventoryItems).values({ companyId: s.companyId, name: 'Synthetic finished SKU', unit: 'KG' }).returning();
  const [parent] = await fixture!.owner.insert(recipeVersions).values({ companyId: s.companyId, recipeId: s.recipeIds[0],
    versionNumber: 1, name: 'Synthetic parent version', baseYield: '1.00', unit: 'PORTION', calculatedCost: 100,
    priceSelling: 200, foodCostPercentage: '50.00', changedBy: s.actorId,
    itemsSnapshot: [{ itemId: s.recipeIds[1], quantity: '0.5000', unit: 'KG', isSubRecipe: true, yieldPercent: 100 }],
  }).returning();
  await publish(actor(s), policy(s, child.id, day, 1)); await publish(actor(s), policy(s, parent.id));
  expect(await sale(s, 2)).toMatchObject({ inserted: 1, errors: [] });
  const before = await s.state();
  expect(stock(before, s)).toBe('20.0000');
  expect(before.batches.find(batch => batch.id === s.batchIds[1])!.quantity).toBe('19.0000');
  // The mutable parent has only its own raw ingredient; the frozen JSON must
  // provide the historical relation when checking this child's publication.
  await expect(publish(actor(s), { ...policy(s, childNext.id, day, 1), mode: 'FINISHED_PRODUCT_ON_SALE',
    inventoryItemId: finished.id, unit: 'KG' })).rejects.toMatchObject({ statusCode: 409 });
  await publish(actor(s), { ...policy(s, childNext.id, '2026-12-02', 1), mode: 'FINISHED_PRODUCT_ON_SALE',
    inventoryItemId: finished.id, unit: 'KG' });
  const blocked = await sale(s, 1, { saleDay: '2026-12-02' });
  expect(blocked).toMatchObject({ inserted: 0, errors: [{ rowNumber: 2 }] });
  expect(blocked.errors[0].message).toContain('Stock de lote terminado de producción insuficiente');
  expect(await s.state()).toEqual(before);
}, 90_000);
