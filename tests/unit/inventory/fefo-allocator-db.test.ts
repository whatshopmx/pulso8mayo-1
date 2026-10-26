import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { branches, inventoryBatches, inventoryItems } from '@/lib/db/schema';
import { allocateScopedBatches } from '@/lib/services/fefo-allocator';

const state = vi.hoisted(() => ({ close: async () => {}, queries: [] as string[], onLockDispatch: null as (() => void) | null }));
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite();
  state.close = () => client.close();
  return { db: drizzle(client, { logger: { logQuery(query: string) {
    state.queries.push(query);
    if (/for update/i.test(query)) state.onLockDispatch?.();
  } } }) };
});

const companyA = 'aaaaaaaa-0000-4000-8000-000000000001';
const companyB = 'bbbbbbbb-0000-4000-8000-000000000001';
const a1 = 'aaaaaaaa-0000-4000-8000-000000000011';
const a2 = 'aaaaaaaa-0000-4000-8000-000000000012';
const b1 = 'bbbbbbbb-0000-4000-8000-000000000011';
const itemA = 'aaaaaaaa-0000-4000-8000-000000000021';
const itemB = 'bbbbbbbb-0000-4000-8000-000000000021';
const now = new Date('2026-10-26T12:00:00Z');
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = { companyId: companyA, branchId: a1, itemId: itemA, quantity: '1.2500' };
const plan = (overrides: Partial<typeof request> & { batchId?: string } = {}) =>
  db.transaction(tx => allocateScopedBatches(tx, { ...request, ...overrides }));

async function seed(n: number, overrides: Partial<typeof inventoryBatches.$inferInsert> = {}) {
  await db.insert(inventoryBatches).values({ id: id(n), itemId: itemA, branchId: a1,
    initialQuantity: '2.0000', currentQuantity: '2.0000', unitCost: 123, status: 'AVAILABLE',
    expirationDate: new Date('2026-11-01T00:00:00Z'), receivedAt: new Date('2026-10-20T00:00:00Z'),
    createdAt: new Date('2026-10-20T01:00:00Z'), ...overrides });
}

beforeAll(async () => {
  // Mismo esquema/driver de consultas. Constraints relajadas sólo para sembrar
  // relaciones corruptas. No conecta a DATABASE_URL ni modifica inventario real.
  for (const table of [branches, inventoryItems, inventoryBatches]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      const type = column.getSQLType();
      return `"${column.name}" ${/^(uuid|text|boolean|integer|numeric|timestamp|jsonb|varchar)/.test(type) ? type : 'text'}`;
    });
    await db.execute(sql.raw(`CREATE TABLE "${config.name}" (${columns.join(',')})`));
  }
  await db.execute(sql`INSERT INTO branches (id,company_id) VALUES (${a1},${companyA}),(${a2},${companyA}),(${b1},${companyB})`);
  await db.execute(sql`INSERT INTO inventory_items (id,company_id) VALUES (${itemA},${companyA}),(${itemB},${companyB})`);
}, 60_000);
beforeEach(async () => {
  await db.execute(sql`TRUNCATE inventory_batches`);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  state.queries = [];
  state.onLockDispatch = null;
});
afterEach(() => { vi.useRealTimers(); });
afterAll(() => state.close());

describe('FEFO-04B-1: consulta real con alcance y elegibilidad', () => {
  it('FEFO toma primero recepción nueva que vence antes y conserva fracciones/costos', async () => {
    await seed(1, { currentQuantity: '0.8500' });
    await seed(2, { currentQuantity: '0.4000', receivedAt: new Date('2026-10-25T00:00:00Z'), expirationDate: new Date('2026-10-27T00:00:00Z'), unitCost: null });
    expect(await plan()).toEqual({ allocations: [{ batchId: id(2), quantity: 0.4, unitCost: null },
      { batchId: id(1), quantity: 0.85, unitCost: 123 }], requestedQuantity: 1.25, allocatedQuantity: 1.25, shortfallQuantity: 0 });
  });

  it('desempata por recepción, creación e ID, no por orden de inserción', async () => {
    await seed(3); await seed(2); await seed(1);
    await seed(4, { createdAt: new Date('2026-10-20T00:00:00Z') });
    await seed(5, { receivedAt: new Date('2026-10-19T00:00:00Z') });
    expect((await plan({ quantity: '20' })).allocations.map(a => a.batchId)).toEqual([id(5), id(4), id(1), id(2), id(3)]);
  });

  it.each(['RESERVED', 'QUARANTINED', 'EXPIRED', 'DEPLETED', null] as const)('excluye estado %s', async status => {
    await seed(1, { status });
    expect(await plan()).toMatchObject({ allocations: [], shortfallQuantity: 1.25 });
  });

  it('AVAILABLE vencido o igual al límite y fecha nula no se asignan', async () => {
    await seed(1, { expirationDate: new Date(now.getTime() - 1) });
    await seed(2, { expirationDate: now });
    await seed(3, { expirationDate: null });
    expect((await plan()).allocations).toEqual([]);
  });

  it('no lee otra sucursal/empresa/producto ni relaciones cruzadas u huérfanas', async () => {
    await seed(1); await seed(2, { branchId: a2 }); await seed(3, { branchId: b1, itemId: itemB });
    await seed(4, { itemId: itemB }); await seed(5, { branchId: b1 }); await seed(6, { branchId: id(999) });
    expect((await plan({ quantity: '20' })).allocations.map(a => a.batchId)).toEqual([id(1)]);
    expect((await plan({ branchId: b1 })).allocations).toEqual([]);
    expect((await plan({ itemId: itemB })).allocations).toEqual([]);
    expect((await plan({ companyId: companyB })).allocations).toEqual([]);
  });

  it('selección explícita valida alcance, estado, fecha y saldo sin sustituir lote', async () => {
    await seed(1); await seed(2, { branchId: a2 }); await seed(3, { status: 'RESERVED' });
    await seed(4, { expirationDate: now }); await seed(5, { currentQuantity: '0' });
    for (const n of [2, 3, 4, 5, 999]) expect((await plan({ batchId: id(n) })).allocations).toEqual([]);
    expect((await plan({ batchId: id(1) })).allocations).toEqual([{ batchId: id(1), quantity: 1.25, unitCost: 123 }]);
  });

  it('no hereda política NONE ni reloj pasado añadidos al objeto de entrada', async () => {
    await seed(1, { expirationDate: null }); await seed(2, { expirationDate: now });
    const injected = { ...request, policy: { strategy: 'FIFO', expiration: 'NONE' }, now: new Date('2000-01-01') };
    expect((await db.transaction(tx => allocateScopedBatches(tx, injected))).allocations).toEqual([]);
  });

  it('vuelve a comprobar el reloj después de despachar la consulta con bloqueo', async () => {
    await seed(1, { expirationDate: new Date(now.getTime() + 1) });
    state.onLockDispatch = () => vi.setSystemTime(new Date(now.getTime() + 2));
    expect((await plan()).allocations).toEqual([]);
  });

  it('reparte sin residuo binario y deja faltante separado, sin cambiar saldos', async () => {
    await seed(1, { currentQuantity: '0.1000' }); await seed(2, { currentQuantity: '0.2000' });
    await seed(3, { currentQuantity: '-1.0000' });
    const before = await db.select().from(inventoryBatches);
    const result = await db.transaction(tx => allocateScopedBatches(tx, { ...request, quantity: 0.1 + 0.2 }));
    expect(result.allocations.map(a => a.quantity)).toEqual([0.1, 0.2]);
    expect(result.shortfallQuantity).toBe(0);
    expect((await plan()).shortfallQuantity).toBe(0.95);
    expect(await db.select().from(inventoryBatches)).toEqual(before);
  });

  it('pide FOR UPDATE sólo de inventory_batches y no inserta ni actualiza stock', async () => {
    await seed(1); state.queries = [];
    await plan();
    expect(state.queries.some(query => /for update of "inventory_batches"/i.test(query))).toBe(true);
    expect(state.queries.some(query => /^\s*(insert|update|delete)\b/i.test(query))).toBe(false);
  });

  it('rechaza precisión inválida antes de consultar/bloquear lotes', async () => {
    state.queries = [];
    await expect(plan({ quantity: '0.00001' })).rejects.toThrow('Cantidad inválida');
    expect(state.queries.some(query => /from "inventory_batches"/i.test(query))).toBe(false);
  });
});
