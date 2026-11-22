import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';
import type { seedCsvRuntimeScenario } from './helpers/csv-runtime-scenario';

const enabled = process.env.RUN_SALES_RUNTIME_NEXT_BROWSER === '1';
const previous = { database: process.env.DATABASE_URL, runtime: process.env.SALES_RUNTIME_DATABASE_URL };
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let seed: typeof seedCsvRuntimeScenario;
let ingest: typeof import('@/lib/services/sales-ingest-service').SalesIngestService.ingest;
type Scenario = Awaited<ReturnType<typeof seedCsvRuntimeScenario>>;
const day = '2026-11-22';
const row = (recipeRef: string, productKey: string, quantitySold: number, totalRevenueCents: number | null, rowNumber = 2) =>
  ({ recipeRef, productKey, quantitySold, totalRevenueCents, rowNumber, saleDay: day });
const input = (scenario: Scenario) => ({ companyId: scenario.companyId, branchId: scenario.branchId, userId: scenario.actorId });
const stock = (state: Awaited<ReturnType<Scenario['state']>>, scenario: Scenario, index = 0) =>
  state.batches.find(batch => batch.id === scenario.batchIds[index])!.quantity;

beforeAll(async () => {
  if (!enabled) return;
  fixture = await createSalesRuntimeDatabase();
  process.env.DATABASE_URL = fixture.ownerUrl;
  process.env.SALES_RUNTIME_DATABASE_URL = fixture.runtimeUrl;
  // Bind host imports only after creating the disposable database. Ingest uses
  // its real transaction/role guard, rather than a supplied owner transaction.
  seed = (await import('./helpers/csv-runtime-scenario')).seedCsvRuntimeScenario;
  const { SalesIngestService } = await import('@/lib/services/sales-ingest-service');
  ingest = params => SalesIngestService.ingest(params);
}, 150_000);

afterAll(async () => {
  try { await fixture?.close(); }
  finally {
    for (const [name, value] of [['DATABASE_URL', previous.database], ['SALES_RUNTIME_DATABASE_URL', previous.runtime]]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
  }
}, 90_000);

it.skipIf(!enabled)('ingest runtime: unknown revenue, aggregate correction and cross-source coverage survive real commits', async () => {
  const scenario = await seed(fixture!), base = input(scenario);
  const rows = [row(scenario.recipeNames[0], 'SKU-1', 2, 200), row(scenario.recipeNames[0], 'SKU-1', 3, null, 3)];
  expect(await ingest({ ...base, rows })).toMatchObject({ inserted: 1, updated: 0, skipped: 0, errors: [], revenueComplete: false });
  const initial = await scenario.state();
  expect(stock(initial, scenario)).toBe('15.0000');
  expect(initial.identities).toMatchObject([{ source: 'pos:import', productKey: 'SKU-1', day }]);
  expect(initial.revisions).toMatchObject([{ quantity: '5.00', revenue: null, revision: 1 }]);
  expect(initial.sales).toMatchObject([{ quantity: '5.00', revenue: 0 }]);
  expect(await ingest({ ...base, rows })).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
  expect(await scenario.state()).toEqual(initial);

  expect(await ingest({ ...base, rows: [row(scenario.recipeIds[0], 'SKU-1', 7, null)] })).toMatchObject({ updated: 1 });
  const corrected = await scenario.state();
  expect(stock(corrected, scenario)).toBe('13.0000');
  expect(corrected.identities).toEqual(initial.identities);
  expect(await ingest({ ...base, rows: [row(scenario.recipeIds[0], 'SKU-1', 7, 700)] })).toMatchObject({ updated: 1, revenueComplete: true });
  const completed = await scenario.state();
  expect(completed.movements).toEqual(corrected.movements);
  expect(completed.revisions.at(-1)).toMatchObject({ revenue: 700, revision: 3 });

  expect(await ingest({ ...base, source: 'manual:recipe', rows: [row(scenario.recipeIds[0], 'manual', 1, null)] }))
    .toMatchObject({ inserted: 1, revenueComplete: false });
  expect(await ingest({ ...base, rows: [row(scenario.recipeIds[0], 'SKU-1', 7, 700)] }))
    .toMatchObject({ skipped: 1, revenueComplete: false, revenueCoverage: [{ recipeId: scenario.recipeIds[0], saleDay: day, complete: false }] });
  const mixed = await scenario.state();
  expect(mixed.sales).toMatchObject([{ quantity: '8.00', revenue: 700 }]);
  expect(await ingest({ ...base, source: 'manual:recipe', rows: [row(scenario.recipeIds[0], 'manual', 0, 0)] }))
    .toMatchObject({ updated: 1, revenueComplete: true });
  const zero = await scenario.state();
  expect(stock(zero, scenario)).toBe('13.0000');
  expect(zero.revisions.some(revision => revision.quantity === '0.00' && revision.revenue === 0)).toBe(true);
}, 150_000);

it.skipIf(!enabled)('ingest runtime: business failures preserve valid groups and report every grouped row', async () => {
  const scenario = await seed(fixture!), foreign = await seed(fixture!);
  const result = await ingest({ ...input(scenario), rows: [
    row(scenario.recipeIds[0], 'short', 12, 1200), row(scenario.recipeIds[0], 'short', 12, 1200, 3),
    row(foreign.recipeIds[0], 'foreign', 1, 100, 4), row(scenario.recipeIds[1], 'good', 2, 200, 5),
  ] });
  expect(result).toMatchObject({ inserted: 1, updated: 0, skipped: 0, revenueComplete: false });
  expect(result.errors.map(error => error.rowNumber)).toEqual([2, 3, 4]);
  const state = await scenario.state();
  expect(state.identities).toMatchObject([{ productKey: 'good' }]);
  expect(state.revisions).toHaveLength(1);
  expect(stock(state, scenario)).toBe('20.0000');
  expect(stock(state, scenario, 1)).toBe('18.0000');
  expect((await foreign.state()).movements).toEqual([]);
}, 90_000);

it.skipIf(!enabled)('ingest runtime: atomic business failure rolls back earlier groups across connections', async () => {
  const scenario = await seed(fixture!), before = await scenario.state();
  await expect(ingest({ ...input(scenario), atomic: true, rows: [
    row(scenario.recipeIds[0], 'first', 2, 200), row(scenario.recipeIds[1], 'short', 21, 2100, 3),
  ] })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  expect(await scenario.state()).toEqual(before);
}, 90_000);

it.skipIf(!enabled)('ingest runtime: SQL infrastructure failure rolls back the whole non-atomic batch', async () => {
  const scenario = await seed(fixture!), before = await scenario.state();
  // Fault injection stays in this disposable database, through an actual SQL
  // trigger. A business-error double would miss transaction abort behavior.
  await fixture!.owner.execute(sql.raw(`CREATE FUNCTION public.synthetic_ingest_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.batch_id = '${scenario.batchIds[1]}'::uuid THEN
      RAISE EXCEPTION 'synthetic ingest infrastructure failure' USING ERRCODE='P0001';
    END IF; RETURN NEW; END $$;
    CREATE TRIGGER synthetic_ingest_failure BEFORE INSERT ON public.inventory_movements
      FOR EACH ROW EXECUTE FUNCTION public.synthetic_ingest_failure();`));
  try {
    await expect(ingest({ ...input(scenario), rows: [
      row(scenario.recipeIds[0], 'first', 2, 200), row(scenario.recipeIds[1], 'broken', 2, 200, 3),
    ] })).rejects.toMatchObject({ cause: { code: 'P0001', message: 'synthetic ingest infrastructure failure' } });
    expect(await scenario.state()).toEqual(before);
  } finally {
    await fixture!.owner.execute(sql.raw('DROP TRIGGER synthetic_ingest_failure ON public.inventory_movements; DROP FUNCTION public.synthetic_ingest_failure();'));
  }
}, 90_000);
