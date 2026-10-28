import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as tables from '@/lib/db/schema';
import { ProductionService } from '@/lib/services/production-service';

const state = vi.hoisted(() => ({ close: async () => {} }));
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { unitConversions } = await import('@/lib/db/schema');
  const client = new PGlite(); state.close = () => client.close();
  return { db: drizzle(client, { schema: { unitConversions } }) };
});
const companyA = 'aaaaaaaa-0000-4000-8000-000000000001';
const companyB = 'bbbbbbbb-0000-4000-8000-000000000001';
const branch = 'aaaaaaaa-0000-4000-8000-000000000011';
const otherBranch = 'aaaaaaaa-0000-4000-8000-000000000012';
const foreignBranch = 'bbbbbbbb-0000-4000-8000-000000000011';
const itemA = 'aaaaaaaa-0000-4000-8000-000000000021';
const itemA2 = 'aaaaaaaa-0000-4000-8000-000000000022';
const itemB = 'bbbbbbbb-0000-4000-8000-000000000021';
const recipeA = 'aaaaaaaa-0000-4000-8000-000000000031';
const recipeB = 'bbbbbbbb-0000-4000-8000-000000000031';
const orderA = 'aaaaaaaa-0000-4000-8000-000000000041';
const orderB = 'bbbbbbbb-0000-4000-8000-000000000041';
const workflowId = 'aaaaaaaa-0000-4000-8000-000000000051';
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-26T12:00:00Z');
type ProductionInput = Parameters<typeof ProductionService.recordProduction>[0];
const ingredient = (overrides: Partial<ProductionInput['ingredients'][number]> = {}) => ({
  itemId: itemA, batchId: id(101), expectedQuantity: 1, actualQuantity: 1, unit: 'KG', unitCost: 125, ...overrides,
});
const record = (overrides: Partial<ProductionInput> = {}) => ProductionService.recordProduction({
  companyId: companyA, branchId: branch, recipeId: recipeA, orderId: orderA, producedQuantity: 1,
  unit: 'PORTION', recordedBy: 'actor-a', ingredients: [ingredient()], ...overrides,
});
async function batch(n = 101, overrides: Partial<typeof tables.inventoryBatches.$inferInsert> = {}) {
  await db.insert(tables.inventoryBatches).values({ id: id(n), itemId: itemA, branchId: branch,
    initialQuantity: '2.0000', currentQuantity: '2.0000', unitCost: 125, status: 'AVAILABLE',
    expirationDate: new Date('2026-11-01T00:00:00Z'), receivedAt: new Date('2026-10-20T00:00:00Z'),
    createdAt: new Date('2026-10-20T00:00:00Z'), ...overrides });
}
const snapshot = () => Promise.all([
  db.select().from(tables.inventoryBatches).orderBy(tables.inventoryBatches.id),
  db.select().from(tables.productionResults).orderBy(tables.productionResults.id),
  db.select().from(tables.productionIngredients).orderBy(tables.productionIngredients.id),
  db.select().from(tables.productionOrders).orderBy(tables.productionOrders.id),
  db.select().from(tables.inventoryMovements).orderBy(tables.inventoryMovements.id),
  db.select().from(tables.inventoryWaste).orderBy(tables.inventoryWaste.id),
]);
async function rejectsUnchanged(action: () => Promise<unknown>, statusCode = 409) {
  const before = await snapshot();
  await expect(action()).rejects.toMatchObject({ statusCode });
  expect(await snapshot()).toEqual(before);
}
beforeAll(async () => {
  for (const table of [tables.branches, tables.inventoryItems, tables.inventoryBatches, tables.recipes, tables.recipeItems,
    tables.productionOrders, tables.productionResults, tables.productionIngredients, tables.inventoryMovements,
    tables.inventoryWaste, tables.unitConversions]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      const type = column.getSQLType();
      const extra = column.name === 'id' ? ' DEFAULT gen_random_uuid() PRIMARY KEY'
        : ['created_at', 'updated_at', 'production_date'].includes(column.name) ? ' DEFAULT now()' : '';
      return `"${column.name}" ${/^(uuid|text|boolean|integer|numeric|timestamp|jsonb|varchar)/.test(type) ? type : 'text'}${extra}`;
    });
    await db.execute(sql.raw(`CREATE TABLE "${config.name}" (${columns.join(',')})`));
  }
  await db.execute(sql.raw(`CREATE UNIQUE INDEX production_results_instance_recipe_unique
    ON production_results(workflow_instance_id,recipe_id) WHERE workflow_instance_id IS NOT NULL`));
  await db.execute(sql`INSERT INTO branches (id,company_id) VALUES (${branch},${companyA}),(${otherBranch},${companyA}),(${foreignBranch},${companyB})`);
  await db.execute(sql`INSERT INTO inventory_items (id,company_id,unit) VALUES (${itemA},${companyA},'KG'),(${itemA2},${companyA},'KG'),(${itemB},${companyB},'KG')`);
  await db.execute(sql`INSERT INTO recipes (id,company_id,name,base_yield,unit) VALUES (${recipeA},${companyA},'Recipe A',1,'PORTION'),(${recipeB},${companyB},'Recipe B',1,'PORTION')`);
}, 60_000);
beforeEach(async () => {
  await db.execute(sql`TRUNCATE inventory_batches, production_results, production_ingredients, production_orders, inventory_movements, inventory_waste, recipe_items, unit_conversions`);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await db.insert(tables.productionOrders).values([
    { id: orderA, companyId: companyA, branchId: branch, recipeId: recipeA, plannedQuantity: 1, unit: 'PORTION', plannedDate: now, createdBy: 'actor-a', status: 'PLANNED' },
    { id: orderB, companyId: companyB, branchId: foreignBranch, recipeId: recipeB, plannedQuantity: 1, unit: 'PORTION', plannedDate: now, createdBy: 'actor-b', status: 'PLANNED' },
  ]);
});
afterEach(() => vi.useRealTimers());
afterAll(() => state.close());

describe('FEFO-04B-3: registro de producción con SQL real', () => {
  it('manual descuenta una vez, registra USAGE y cierra la orden en la misma transacción', async () => {
    await batch(); const result = await record();
    expect(result).toMatchObject({ ingredientCost: 125, shortfalls: [] });
    expect((await db.select().from(tables.inventoryBatches))[0].currentQuantity).toBe('1.0000');
    expect(await db.select().from(tables.inventoryMovements)).toMatchObject([{ batchId: id(101), itemId: itemA,
      branchId: branch, type: 'USAGE', quantityChange: '-1.0000', referenceId: result!.id, performedBy: 'actor-a' }]);
    expect((await db.select().from(tables.productionOrders).where(eq(tables.productionOrders.id, orderA)))[0].status).toBe('COMPLETED');
  });
  it.each(['EXPIRED', 'RESERVED', 'QUARANTINED', 'DEPLETED', null] as const)('rechaza ingrediente explícito %s y revierte todo', async status => {
    await batch(101, { status }); await batch(102); await rejectsUnchanged(() => record());
  });
  it.each([now, new Date(now.getTime() - 1), null])('rechaza caducidad %s sin depender del cron', async expirationDate => {
    await batch(101, { expirationDate }); await rejectsUnchanged(() => record());
  });
  it('un faltante físico no produce parcialmente ni genera merma ficticia', async () => {
    await batch(101, { currentQuantity: '0.4000' }); await rejectsUnchanged(() => record());
  });
  it('revierte el primer ingrediente si falla el segundo', async () => {
    await batch(); await batch(102, { itemId: itemA2, status: 'QUARANTINED' });
    await rejectsUnchanged(() => record({ ingredients: [ingredient(), ingredient({ itemId: itemA2, batchId: id(102) })] }));
  });
  it('no sobreasigna un lote repetido en dos líneas', async () => {
    await batch(101, { currentQuantity: '1.5000' });
    await rejectsUnchanged(() => record({ ingredients: [ingredient(), ingredient()] }));
  });
  it('rechaza lote de otro producto aunque esté en la misma sucursal', async () => {
    await batch(101, { itemId: itemA2 }); await rejectsUnchanged(() => record(), 400);
  });
  it('no completa una orden de otra empresa', async () => {
    await batch(); await rejectsUnchanged(() => record({ orderId: orderB }), 400);
  });
  it('sin lote explícito aplica FEFO y distribuye cantidad/costo/esperado sin duplicar', async () => {
    await batch(101, { currentQuantity: '0.6000' });
    await batch(102, { currentQuantity: '0.4000', expirationDate: new Date('2026-10-27T00:00:00Z'), unitCost: 200 });
    expect(await record({ ingredients: [ingredient({ batchId: undefined, expectedQuantity: 2, unitCost: undefined })] })).toMatchObject({ ingredientCost: 155 });
    const rows = await db.select().from(tables.productionIngredients).orderBy(tables.productionIngredients.batchId);
    expect(rows.map(r => [r.batchId, r.actualQuantity, r.expectedQuantity, r.unitCost])).toEqual([
      [id(101), '0.6000', '1.2000', 125], [id(102), '0.4000', '0.8000', 200],
    ]);
  });
  it('convierte unidades una vez con la conversión de su empresa y el mismo ejecutor', async () => {
    await batch(); await db.insert(tables.unitConversions).values({ companyId: companyA, fromUnit: 'G', toUnit: 'KG', factor: '0.001000' });
    expect(await record({ ingredients: [ingredient({ unit: 'G', actualQuantity: 250, expectedQuantity: 500 })] })).toMatchObject({ ingredientCost: 31 });
    expect((await db.select().from(tables.inventoryBatches))[0].currentQuantity).toBe('1.7500');
    expect((await db.select().from(tables.productionIngredients))[0]).toMatchObject({ actualQuantity: '0.2500', expectedQuantity: '0.5000', unit: 'KG' });
  });
  it('no usa una conversión de otra empresa ni asume equivalencias', async () => {
    await batch(); await db.insert(tables.unitConversions).values({ companyId: companyB, fromUnit: 'G', toUnit: 'KG', factor: '0.001000' });
    await rejectsUnchanged(() => record({ ingredients: [ingredient({ unit: 'G', actualQuantity: 1 })] }), 400);
  });
  it('un fallo real de kardex revierte resultado, insumos, saldos y orden', async () => {
    await batch(); const before = await snapshot();
    await db.execute(sql`ALTER TABLE inventory_movements ADD CONSTRAINT deny_usage CHECK (type <> 'USAGE')`);
    try { await expect(record()).rejects.toMatchObject({ cause: { code: '23514' } }); expect(await snapshot()).toEqual(before); }
    finally { await db.execute(sql`ALTER TABLE inventory_movements DROP CONSTRAINT deny_usage`); }
  });
  it('un fallo al insertar insumos revierte también el descuento anterior', async () => {
    await batch(); const before = await snapshot();
    await db.execute(sql`ALTER TABLE production_ingredients ADD CONSTRAINT deny_ingredient CHECK (actual_quantity=0)`);
    try { await expect(record()).rejects.toMatchObject({ cause: { code: '23514' } }); expect(await snapshot()).toEqual(before); }
    finally { await db.execute(sql`ALTER TABLE production_ingredients DROP CONSTRAINT deny_ingredient`); }
  });
  it('un reintento de workflow no descuenta de nuevo aunque el lote esté ahora bloqueado', async () => {
    await batch(); await record({ workflowInstanceId: workflowId });
    await db.update(tables.inventoryBatches).set({ status: 'QUARANTINED' });
    const before = await snapshot(); expect(await record({ workflowInstanceId: workflowId })).toBeNull(); expect(await snapshot()).toEqual(before);
  });
});
