import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import * as tables from '@/lib/db/schema';
import { publishRecipeConsumptionPolicyInTransaction } from '@/lib/services/recipe-consumption-publication';
import { publishedSaleRecipeReader } from '@/lib/services/sale-consumption-reader';
import { buildSaleRecipeSnapshot, saleSnapshotDemand } from '@/lib/services/sale-consumption-snapshot';
import type { SaleRecipeSnapshot } from '@/lib/services/sale-consumption-contract';
import { applySaleConsumptionInTransaction } from '@/lib/services/sale-consumption-service';
import { SalesIngestService } from '@/lib/services/sales-ingest-service';

const state = vi.hoisted(() => ({ close: async () => {} }));
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite(); state.close = () => client.close();
  return { db: drizzle(client) };
});
const companyA = 'aaaaaaaa-0000-4000-8000-000000000001', companyB = 'bbbbbbbb-0000-4000-8000-000000000001';
const branchA = 'aaaaaaaa-0000-4000-8000-000000000011', branchA2 = 'aaaaaaaa-0000-4000-8000-000000000012';
const recipeA = 'aaaaaaaa-0000-4000-8000-000000000021', recipeB = 'bbbbbbbb-0000-4000-8000-000000000021';
const itemA = 'aaaaaaaa-0000-4000-8000-000000000031', itemB = 'bbbbbbbb-0000-4000-8000-000000000031';
const versionA = 'aaaaaaaa-0000-4000-8000-000000000041', versionA2 = 'aaaaaaaa-0000-4000-8000-000000000042';
const versionB = 'bbbbbbbb-0000-4000-8000-000000000041';
const actor = { userId: 'synthetic-admin', role: 'ADMIN' as const, companyId: companyA, branchId: null };
const input = { recipeId: recipeA, recipeVersionId: versionA, effectiveFrom: '2026-12-01', mode: 'INGREDIENTS_ON_SALE', reason: 'Publicación explícita' };
const policies = () => db.select().from(tables.recipeConsumptionPolicies);
const audits = () => db.select().from(tables.configChangeLogs);
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const publish = (extra = {}, author = actor) => db.transaction(async tx => {
  await tx.execute(sql`SET LOCAL ROLE pulso_app`);
  return publishRecipeConsumptionPolicyInTransaction(tx, author, { ...input, ...extra });
}, { isolationLevel: 'serializable' });

beforeAll(async () => {
  // Existing tables materialize their column types; historical RLS/grants and
  // the new DDL below are executed from the actual migration files.
  for (const table of [tables.companies, tables.branches, tables.recipes, tables.recipeItems, tables.recipeVersions,
    tables.inventoryItems, tables.unitConversions, tables.inventoryBatches, tables.inventoryMovements, tables.salesEntries, tables.configChangeLogs]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      const type = column.getSQLType();
      const extra = column.name === 'id' ? ' DEFAULT gen_random_uuid() PRIMARY KEY'
        : ['created_at', 'updated_at', 'performed_at'].includes(column.name) ? ' DEFAULT now()' : '';
      return `"${column.name}" ${/^(uuid|text|boolean|integer|numeric|timestamp|jsonb|varchar|date)/.test(type) ? type : 'text'}${extra}`;
    });
    await db.execute(sql.raw(`CREATE TABLE "${config.name}" (${columns.join(',')})`));
  }
  await db.execute(sql`CREATE ROLE pulso_app NOSUPERUSER NOBYPASSRLS`);
  await db.execute(sql`CREATE UNIQUE INDEX sale_policy_test_projection ON sales_entries (company_id, branch_id, sale_date, recipe_id)`);
  for (const number of ['0137', '0138', '0139', '0141', '0159', '0160', '0162']) {
    const file = readdirSync('drizzle').find(name => name.startsWith(`${number}_`) && name.endsWith('.sql'))!;
    for (const statement of readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').filter(s => s.trim())) {
      await db.execute(sql.raw(statement));
    }
  }
  await db.insert(tables.companies).values([{ id: companyA, name: 'A sintética' }, { id: companyB, name: 'B sintética' }]);
  await db.insert(tables.branches).values([{ id: branchA, companyId: companyA, name: 'A1' }, { id: branchA2, companyId: companyA, name: 'A2' }]);
  await db.insert(tables.recipes).values([{ id: recipeA, companyId: companyA, name: 'A', unit: 'KG', baseYield: '1.00' }, { id: recipeB, companyId: companyB, name: 'B' }]);
  await db.insert(tables.inventoryItems).values([{ id: itemA, companyId: companyA, name: 'Elaborado A', unit: 'KG' }, { id: itemB, companyId: companyB, name: 'Elaborado B', unit: 'KG' }]);
  await db.insert(tables.recipeItems).values({ recipeId: recipeA, itemId: itemA, quantity: '2.0000', unit: 'KG', isSubRecipe: false, yieldPercent: 100 });
  await db.insert(tables.recipeVersions).values([versionA, versionA2, versionB].map((id, i) => ({
    id, recipeId: i === 2 ? recipeB : recipeA, companyId: i === 2 ? companyB : companyA, versionNumber: i + 1,
    name: 'Versión sintética', baseYield: '1.00', unit: 'KG', calculatedCost: 100, priceSelling: 200,
    foodCostPercentage: '50.00', itemsSnapshot: [{ itemId: itemA, quantity: i === 1 ? '3.0000' : '1.0000', unit: 'KG', isSubRecipe: false, yieldPercent: 100, lastCost: 88888 }],
  })));
}, 60_000);
beforeEach(async () => {
  vi.unstubAllEnvs();
  await db.execute(sql`RESET ROLE`);
  await db.execute(sql`TRUNCATE recipe_consumption_policies, config_change_logs, sales_entries, sales_consumption_revisions, sales_consumption_identities, inventory_batches, inventory_movements`);
  await db.insert(tables.inventoryBatches).values({ itemId: itemA, branchId: branchA,
    initialQuantity: '20', currentQuantity: '20', status: 'AVAILABLE', receivedAt: new Date('2026-01-01'), expirationDate: new Date('2099-01-01') });
});

const publishedSnapshot = (day = input.effectiveFrom, scopeCompany = companyA) => db.transaction(async tx => {
  await tx.execute(sql`SET LOCAL ROLE pulso_app`);
  await tx.execute(sql`SELECT set_config('app.current_company_id', ${scopeCompany}, true), set_config('app.current_branch_id', ${branchA}, true)`);
  return buildSaleRecipeSnapshot(companyA, recipeA, publishedSaleRecipeReader(tx, day));
}, { isolationLevel: 'serializable' });

describe('INV-02.snapshot: lector publicado en la transacción runtime', () => {
  it('lee cantidades archivadas aunque la ficha editable haya cambiado', async () => {
    const saved = await publish();
    const lineId = randomUUID();
    await db.update(tables.recipes).set({ baseYield: '9.00', unit: 'PORTION' }).where(eq(tables.recipes.id, recipeA));
    await db.insert(tables.recipeItems).values({ id: lineId, recipeId: recipeA, itemId: itemA, quantity: '999.0000', unit: 'KG', isSubRecipe: false });
    try {
      const result = await publishedSnapshot();
      expect(saleSnapshotDemand(result, '2')).toEqual([{ itemId: itemA, unit: 'KG', quantity: '2.0000' }]);
      expect(JSON.stringify(result.definition)).toContain(saved.policy.id);
      expect(JSON.stringify(result.definition)).not.toContain('88888');
    } finally {
      await db.update(tables.recipes).set({ baseYield: '1.00', unit: 'KG' }).where(eq(tables.recipes.id, recipeA));
      await db.delete(tables.recipeItems).where(eq(tables.recipeItems.id, lineId));
    }
  });
  it('elige versión por día civil y no reinterpreta el snapshot previo', async () => {
    await publish(); const first = await publishedSnapshot();
    await publish({ recipeVersionId: versionA2, effectiveFrom: '2026-12-02' });
    const second = await publishedSnapshot('2026-12-02');
    expect(saleSnapshotDemand(first, '2')).toEqual([{ itemId: itemA, unit: 'KG', quantity: '2.0000' }]);
    expect(saleSnapshotDemand(second, '2')).toEqual([{ itemId: itemA, unit: 'KG', quantity: '6.0000' }]);
    expect(second.versionKey).not.toBe(first.versionKey);
    const roundTrip = (await db.execute<{ snapshot: SaleRecipeSnapshot }>(sql`SELECT ${JSON.stringify(first)}::jsonb AS snapshot`)).rows[0].snapshot;
    expect(saleSnapshotDemand(roundTrip, '2')).toEqual(saleSnapshotDemand(first, '2'));
  });
  it('no inventa consumo directo si falta política vigente o la RLS no la permite', async () => {
    await expect(publishedSnapshot()).rejects.toThrow(/vigencia/i);
    await publish();
    await expect(publishedSnapshot('2026-11-30')).rejects.toThrow(/vigencia/i);
    await expect(publishedSnapshot(input.effectiveFrom, companyB)).rejects.toThrow(/vigencia/i);
  });
  it('rechaza política sin prueba de publicación auditada', async () => {
    await db.insert(tables.recipeConsumptionPolicies).values({ companyId: companyA, recipeId: recipeA,
      recipeVersionId: versionA, effectiveFrom: input.effectiveFrom, mode: 'INGREDIENTS_ON_SALE', publishedBy: actor.userId, reason: input.reason });
    await expect(publishedSnapshot()).rejects.toThrow(/auditoría/i);
  });
  it('rechaza lector fuera de un snapshot serializable', async () => {
    await publish();
    await expect(db.transaction(tx => buildSaleRecipeSnapshot(companyA, recipeA, publishedSaleRecipeReader(tx, input.effectiveFrom))))
      .rejects.toThrow(/serializable/i);
  });
  it('elaborado consulta sólo su SKU y conserva la demanda física congelada', async () => {
    await publish({ mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: itemA, unit: 'KG' });
    const result = await publishedSnapshot();
    expect(saleSnapshotDemand(result, '2')).toEqual([{ itemId: itemA, unit: 'KG', quantity: '2.0000' }]);
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
  });
  it('una subreceta usa su propia publicación, no sus ingredientes editables', async () => {
    const child = randomUUID(), childVersion = randomUUID(), rootVersion = randomUUID();
    await db.insert(tables.recipes).values({ id: child, companyId: companyA, name: 'Prep sintética', unit: 'KG', baseYield: '9.00' });
    const [base] = await db.select().from(tables.recipeVersions).where(eq(tables.recipeVersions.id, versionA));
    await db.insert(tables.recipeVersions).values([
      { ...base, id: childVersion, recipeId: child, versionNumber: 1, baseYield: '4.00' },
      { ...base, id: rootVersion, versionNumber: 5, itemsSnapshot: [
        { itemId: child, quantity: '0.5000', unit: 'KG', isSubRecipe: true, yieldPercent: 100 },
      ] },
    ]);
    await publish({ recipeVersionId: rootVersion });
    // No adopta la ficha mutable del hijo cuando falta su publicación.
    await expect(publishedSnapshot()).rejects.toThrow(/vigencia/i);
    await publish({ recipeId: child, recipeVersionId: childVersion,
      mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: itemA, unit: 'KG' });
    const result = await publishedSnapshot();
    expect(saleSnapshotDemand(result, '2')).toEqual([{ itemId: itemA, unit: 'KG', quantity: '1.0000' }]);
    expect(JSON.stringify(result.definition)).toContain(childVersion);
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
  });
  it.each([null, [{ itemId: itemA, quantity: '1', unit: 'KG', isSubRecipe: false }],
    [{ itemId: itemB, quantity: '1', unit: 'KG', isSubRecipe: false, yieldPercent: 100 }],
  ])('rechaza una ficha archivada inválida o un ingrediente ajeno: %j', async itemsSnapshot => {
    const id = randomUUID();
    const [base] = await db.select().from(tables.recipeVersions).where(eq(tables.recipeVersions.id, versionA));
    await db.insert(tables.recipeVersions).values({ ...base, id, versionNumber: 6, itemsSnapshot });
    await publish({ recipeVersionId: id });
    await expect(publishedSnapshot()).rejects.toThrow();
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await state.close(); });

describe('INV-02.apply: escritor con políticas publicadas', () => {
  beforeEach(() => vi.stubEnv('SALES_RECIPE_POLICY_MODE', 'PUBLISHED'));
  const stock = async () => (await db.select({ quantity: tables.inventoryBatches.currentQuantity }).from(tables.inventoryBatches))[0].quantity;
  const heads = () => db.select().from(tables.salesConsumptionRevisions).orderBy(tables.salesConsumptionRevisions.revision);
  const write = (quantitySold: string, extra = {}) => db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL ROLE pulso_app`);
    return applySaleConsumptionInTransaction(tx, { companyId: companyA, branchId: branchA, recipeId: recipeA,
      source: 'pos:policy-test', productKey: 'SKU-1', saleDay: input.effectiveFrom,
      quantitySold, totalRevenueCents: null, userId: actor.userId, ...extra });
  }, { isolationLevel: 'serializable' });
  it('aplica 10→12→8, repite, completa ingreso y anula sobre la demanda archivada', async () => {
    const saved = await publish();
    expect(await write('10')).toMatchObject({ applied: true, created: true });
    expect(await stock()).toBe('10.0000');
    expect((await heads())[0].recipeSnapshot.definition.recipes).toMatchObject([
      { publication: { policy: { id: saved.policy.id }, recipeVersionId: versionA } },
    ]);
    await write('12'); expect(await stock()).toBe('8.0000');
    await write('8'); expect(await stock()).toBe('12.0000');
    expect(await write('8')).toMatchObject({ applied: false, revision: 3 });
    const count = (await db.select().from(tables.inventoryMovements)).length;
    await write('8', { totalRevenueCents: 8025 }); expect(await stock()).toBe('12.0000');
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(count);
    await write('0', { totalRevenueCents: 0 }); expect(await stock()).toBe('20.0000');
    expect(await heads()).toHaveLength(5);
  });
  it('una política posterior no cambia la corrección histórica; otra fecha usa la nueva versión', async () => {
    await publish(); await write('2'); const frozen = (await heads())[0].recipeSnapshot.versionKey;
    await publish({ recipeVersionId: versionA2, effectiveFrom: '2026-12-02' });
    await write('1'); expect(await stock()).toBe('19.0000');
    expect((await heads())[1].recipeSnapshot.versionKey).toBe(frozen);
    await write('1', { saleDay: '2026-12-02' }); expect(await stock()).toBe('16.0000');
  });
  it('falta de cobertura, configuración inválida y stock insuficiente no dejan identidad ni proyección', async () => {
    await expect(write('1')).rejects.toMatchObject({ code: 'PENDING_RECOVERY' });
    await publish();
    await expect(write('1', { saleDay: '2026-11-30' })).rejects.toMatchObject({ code: 'PENDING_RECOVERY' });
    await expect(write('21')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    vi.stubEnv('SALES_RECIPE_POLICY_MODE', 'TYPO');
    await expect(write('1')).rejects.toMatchObject({ code: 'PENDING_RECOVERY' });
    expect(await stock()).toBe('20.0000'); expect(await heads()).toHaveLength(0);
    expect(await db.select().from(tables.salesConsumptionIdentities)).toHaveLength(0);
    expect(await db.select().from(tables.salesEntries)).toHaveLength(0);
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
  });
  it('no consume lotes de compra como elaborado si falta lote de producción con genealogía', async () => {
    await publish({ mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: itemA, unit: 'KG' });
    await expect(write('1')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await stock()).toBe('20.0000'); expect(await heads()).toHaveLength(0);
    expect(await db.select().from(tables.salesConsumptionIdentities)).toHaveLength(0);
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
  });
  it('no publica retroactivamente una subreceta usada por un snapshot de venta del padre', async () => {
    const child = randomUUID(), childVersion = randomUUID(), nextVersion = randomUUID(), rootVersion = randomUUID();
    await db.insert(tables.recipes).values({ id: child, companyId: companyA, name: 'Subreceta congelada', unit: 'KG', baseYield: '1.00' });
    const [base] = await db.select().from(tables.recipeVersions).where(eq(tables.recipeVersions.id, versionA));
    await db.insert(tables.recipeVersions).values([
      { ...base, id: childVersion, recipeId: child, versionNumber: 1 },
      { ...base, id: nextVersion, recipeId: child, versionNumber: 2 },
      { ...base, id: rootVersion, versionNumber: 7, itemsSnapshot: [
        { itemId: child, quantity: '0.5000', unit: 'KG', isSubRecipe: true, yieldPercent: 100 },
      ] },
    ]);
    await publish({ recipeId: child, recipeVersionId: childVersion, effectiveFrom: '2026-11-01' });
    await publish({ recipeVersionId: rootVersion });
    await write('2'); expect(await stock()).toBe('19.0000');
    // La ficha editable del padre ya no referencia al hijo: la prueba debe
    // salir del snapshot archivado, no sólo del grafo mutable actual.
    await expect(publish({ recipeId: child, recipeVersionId: nextVersion,
      effectiveFrom: input.effectiveFrom })).rejects.toMatchObject({ statusCode: 409 });
    expect(await policies()).toHaveLength(2);
    await publish({ recipeId: child, recipeVersionId: nextVersion, effectiveFrom: '2026-12-02',
      mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: itemA, unit: 'KG' });
    await expect(write('1', { saleDay: '2026-12-02' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await stock()).toBe('19.0000');
  });
  it('también protege la venta legacy del padre que depende de una subreceta', async () => {
    const child = randomUUID(), childVersion = randomUUID();
    await db.insert(tables.recipes).values({ id: child, companyId: companyA, name: 'Prep legacy', unit: 'KG', baseYield: '1.00' });
    const [base] = await db.select().from(tables.recipeVersions).where(eq(tables.recipeVersions.id, versionA));
    await db.insert(tables.recipeVersions).values({ ...base, id: childVersion, recipeId: child, versionNumber: 1 });
    const [line] = await db.insert(tables.recipeItems).values({ recipeId: recipeA, itemId: child,
      quantity: '0.5000', unit: 'KG', isSubRecipe: true, yieldPercent: 100 }).returning();
    try {
      await db.insert(tables.salesEntries).values({ companyId: companyA, branchId: branchA2, recipeId: recipeA,
        quantitySold: '1', totalRevenue: 100, saleDate: new Date('2026-12-01T00:00:00Z') });
      await expect(publish({ recipeId: child, recipeVersionId: childVersion })).rejects.toMatchObject({ statusCode: 409 });
      expect(await policies()).toHaveLength(0);
    } finally { await db.delete(tables.recipeItems).where(eq(tables.recipeItems.id, line.id)); }
  });
  it('conserva compensaciones legacy al activar políticas, sin adoptar su definición mutable', async () => {
    vi.stubEnv('SALES_RECIPE_POLICY_MODE', undefined);
    await write('2'); expect(await stock()).toBe('16.0000');
    const frozen = (await heads())[0].recipeSnapshot.versionKey;
    vi.stubEnv('SALES_RECIPE_POLICY_MODE', 'PUBLISHED');
    await publish({ effectiveFrom: '2026-12-02' });
    await write('1'); expect(await stock()).toBe('18.0000');
    expect((await heads())[1].recipeSnapshot.versionKey).toBe(frozen);
    await write('0', { totalRevenueCents: 0 }); expect(await stock()).toBe('20.0000');
    // Otra identidad histórica carece de política: no adopta automáticamente su ficha mutable.
    await expect(write('1', { productKey: 'new-identity' })).rejects.toMatchObject({ code: 'PENDING_RECOVERY' });
  });
  it('un head publicado no vuelve a ficha mutable al quitar la bandera o pedir versión explícita', async () => {
    await publish(); await write('2'); const key = (await heads())[0].recipeSnapshot.versionKey;
    vi.stubEnv('SALES_RECIPE_POLICY_MODE', undefined);
    await write('1', { recipeVersionKey: key }); expect(await stock()).toBe('19.0000');
    expect((await heads())[1].recipeSnapshot.versionKey).toBe(key);
    await expect(write('1', { recipeVersionKey: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'RECIPE_VERSION_CONFLICT' });
    await expect(write('1', { productKey: 'new-after-disabling' })).rejects.toMatchObject({ code: 'PENDING_RECOVERY' });
    expect(await stock()).toBe('19.0000');
  });
  it('un fallo después de mover stock revierte lote, movimiento, proyección e identidad', async () => {
    await publish();
    await db.execute(sql`ALTER TABLE sales_consumption_revisions ADD CONSTRAINT deny_policy_revision CHECK (quantity_sold=0)`);
    try {
      await expect(write('1')).rejects.toMatchObject({ cause: { code: '23514' } });
      expect(await stock()).toBe('20.0000'); expect(await heads()).toHaveLength(0);
      expect(await db.select().from(tables.salesEntries)).toHaveLength(0);
      expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
      expect(await db.select().from(tables.salesConsumptionIdentities)).toHaveLength(0);
    } finally { await db.execute(sql`ALTER TABLE sales_consumption_revisions DROP CONSTRAINT deny_policy_revision`); }
  });
  it('ingestión agrupa y corrige usando la versión publicada con el mismo runtime', async () => {
    await publish();
    const ingest = (amount: number) => db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL ROLE pulso_app`);
      return SalesIngestService.ingestInTransaction(tx, { companyId: companyA, branchId: branchA,
        userId: actor.userId, rows: [
          { rowNumber: 2, productKey: 'POS-SKU', recipeRef: recipeA, saleDay: input.effectiveFrom, quantitySold: amount, totalRevenueCents: null },
          { rowNumber: 3, productKey: 'POS-SKU', recipeRef: recipeA, saleDay: input.effectiveFrom, quantitySold: 2, totalRevenueCents: null },
        ] });
    }, { isolationLevel: 'serializable' });
    expect(await ingest(1)).toMatchObject({ inserted: 1, errors: [] }); expect(await stock()).toBe('17.0000');
    expect(await ingest(3)).toMatchObject({ updated: 1, errors: [] }); expect(await stock()).toBe('15.0000');
    expect(await ingest(3)).toMatchObject({ skipped: 1, errors: [] }); expect(await stock()).toBe('15.0000');
    expect(await heads()).toHaveLength(2);
  });
  it('ingestión atómica con otro grupo inválido revierte el consumo publicado anterior', async () => {
    await publish();
    await expect(db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL ROLE pulso_app`);
      return SalesIngestService.ingestInTransaction(tx, { companyId: companyA, branchId: branchA,
        userId: actor.userId, atomic: true, rows: [
          { rowNumber: 2, productKey: 'A-VALID', recipeRef: recipeA, saleDay: input.effectiveFrom, quantitySold: 1, totalRevenueCents: 100 },
          { rowNumber: 3, productKey: 'Z-FOREIGN', recipeRef: recipeB, saleDay: input.effectiveFrom, quantitySold: 1, totalRevenueCents: 100 },
        ] });
    }, { isolationLevel: 'serializable' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await stock()).toBe('20.0000'); expect(await heads()).toHaveLength(0);
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
    expect(await db.select().from(tables.salesEntries)).toHaveLength(0);
    expect(await db.select().from(tables.salesConsumptionIdentities)).toHaveLength(0);
  });
});

describe('INV-02.publish: publicación y auditoría en una transacción real', () => {
  it('publica en runtime con actor/motivo y auditoría propia', async () => {
    const result = await publish();
    expect(result).toMatchObject({ status: 'PUBLISHED', policy: { recipeId: recipeA, recipeVersionId: versionA, reason: input.reason, publishedBy: actor.userId } });
    expect(await policies()).toHaveLength(1);
    expect(await audits()).toMatchObject([{ companyId: companyA, userId: actor.userId,
      fieldName: `recipe_consumption_policy:${result.policy.id}`, newValue: { policy: { id: result.policy.id }, auditReason: input.reason } }]);
  });
  it('un reintento exacto no crea otra política ni otra auditoría', async () => {
    const first = await publish(); expect(await publish()).toMatchObject({ status: 'UNCHANGED', policy: { id: first.policy.id } });
    expect(await policies()).toHaveLength(1); expect(await audits()).toHaveLength(1);
    await expect(publish({ reason: 'Otro motivo' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each(['EMPLEADO', 'READONLY', 'GERENTE', 'SUPERVISOR', 'UNKNOWN'])('rechaza %s antes de publicar', async role => {
    await expect(publish({}, { ...actor, role: role as 'ADMIN' })).rejects.toMatchObject({ statusCode: 403 });
    expect(await policies()).toHaveLength(0); expect(await audits()).toHaveLength(0);
  });
  it.each([{ companyId: companyB }, { reason: ' ' }, { effectiveFrom: '2026-02-30' }, { definition: {} }])('rechaza entrada no confiable %j', async invalid => {
    await expect(publish(invalid)).rejects.toMatchObject({ statusCode: 400 });
    expect(await policies()).toHaveLength(0);
  });
  it('no publica versión ajena ni unidad que no corresponda al elaborado', async () => {
    await expect(publish({ recipeVersionId: versionB })).rejects.toMatchObject({ statusCode: 404 });
    await expect(publish({ mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: itemB, unit: 'KG' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(publish({ mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: itemA, unit: 'L' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await policies()).toHaveLength(0);
  });
  it('append-only: una política posterior no se inserta antes de la última vigencia', async () => {
    await publish();
    await expect(publish({ recipeVersionId: versionA2, effectiveFrom: '2026-11-30' })).rejects.toMatchObject({ statusCode: 409 });
    expect(await publish({ recipeVersionId: versionA2, effectiveFrom: '2026-12-02' })).toMatchObject({ status: 'PUBLISHED' });
    expect(await policies()).toHaveLength(2);
  });
  it('no cambia el significado de venta legacy conocida de otra sucursal propia', async () => {
    await db.insert(tables.salesEntries).values({ companyId: companyA, branchId: branchA2, recipeId: recipeA,
      quantitySold: '2.00', totalRevenue: 100, saleDate: new Date('2026-12-01T00:00:00Z') });
    await expect(publish()).rejects.toMatchObject({ statusCode: 409 });
    expect(await policies()).toHaveLength(0);
  });
  it('también protege días de revisiones canónicas aunque no haya proyección legacy', async () => {
    const [identity] = await db.insert(tables.salesConsumptionIdentities).values({ companyId: companyA, branchId: branchA2,
      source: 'pos:test', productKey: 'SKU', saleDay: input.effectiveFrom }).returning();
    await db.insert(tables.salesConsumptionRevisions).values({ companyId: companyA, branchId: branchA2, identityId: identity.id,
      revision: 1, previousQuantitySold: '0', quantitySold: '2', recipeId: recipeA,
      recipeSnapshot: { schemaVersion: 1, recipeId: recipeA, versionKey: 'synthetic-fixture', definition: {} },
      allocations: [], movementRefs: [], recordedBy: actor.userId });
    await expect(publish()).rejects.toMatchObject({ statusCode: 409 });
    expect(await policies()).toHaveLength(0);
  });
  it('publica elaborado propio con unidad explícita sin mover stock ni activar ventas', async () => {
    expect(await publish({ mode: 'FINISHED_PRODUCT_ON_SALE', inventoryItemId: itemA, unit: 'KG' }))
      .toMatchObject({ status: 'PUBLISHED', policy: { inventoryItemId: itemA, unit: 'KG' } });
    expect(await db.select().from(tables.inventoryMovements)).toHaveLength(0);
    expect(await db.select().from(tables.salesEntries)).toHaveLength(0);
  });
  it('un fallo SQL de bitácora revierte política aunque el llamador capture el error', async () => {
    await db.execute(sql`ALTER TABLE config_change_logs ADD CONSTRAINT deny_policy_audit CHECK (field_name NOT LIKE 'recipe_consumption_policy:%')`);
    try {
      await db.transaction(async tx => {
        await tx.execute(sql`SET LOCAL ROLE pulso_app`);
        await expect(publishRecipeConsumptionPolicyInTransaction(tx, actor, input)).rejects.toMatchObject({ cause: { code: '23514' } });
      }, { isolationLevel: 'serializable' });
      expect(await policies()).toHaveLength(0); expect(await audits()).toHaveLength(0);
    } finally { await db.execute(sql`ALTER TABLE config_change_logs DROP CONSTRAINT deny_policy_audit`); }
  });
  it('no adopta una política sin prueba de auditoría previa', async () => {
    await db.insert(tables.recipeConsumptionPolicies).values({ id: randomUUID(), companyId: companyA,
      recipeId: recipeA, recipeVersionId: versionA, effectiveFrom: input.effectiveFrom, mode: 'INGREDIENTS_ON_SALE', publishedBy: actor.userId, reason: input.reason });
    await expect(publish()).rejects.toMatchObject({ statusCode: 409 });
    expect(await audits()).toHaveLength(0);
  });
  it('restaura el contexto previo del llamador al terminar', async () => {
    await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL ROLE pulso_app`);
      await tx.execute(sql`SELECT set_config('app.current_company_id', ${companyB}, true), set_config('app.current_branch_id', ${branchA2}, true)`);
      await publishRecipeConsumptionPolicyInTransaction(tx, actor, input);
      const row = (await tx.execute(sql`SELECT current_setting('app.current_company_id') AS company, current_setting('app.current_branch_id') AS branch`)).rows[0];
      expect(row).toEqual({ company: companyB, branch: branchA2 });
    }, { isolationLevel: 'serializable' });
  });
  it('no acepta una transacción que permita leer historia obsoleta', async () => {
    await expect(db.transaction((tx: Transaction) => publishRecipeConsumptionPolicyInTransaction(tx, actor, input)))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(await policies()).toHaveLength(0);
  });
});
