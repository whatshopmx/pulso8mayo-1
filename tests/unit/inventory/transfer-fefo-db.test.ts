import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { branches, inventoryItems, inventoryBatches, inventoryTransfers, inventoryTransferItems, inventoryMovements } from '@/lib/db/schema';
import { InventoryService } from '@/lib/services/inventory-service';
import { getSession } from '@/lib/auth';
import { PATCH } from '@/app/api/inventory/transfers/[id]/route';

const state = vi.hoisted(() => ({ close: async () => {} }));
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite();
  state.close = () => client.close();
  return { db: drizzle(client) };
});
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const companyA = 'aaaaaaaa-0000-4000-8000-000000000001';
const companyB = 'bbbbbbbb-0000-4000-8000-000000000001';
const origin = 'aaaaaaaa-0000-4000-8000-000000000011';
const destination = 'aaaaaaaa-0000-4000-8000-000000000012';
const foreign = 'bbbbbbbb-0000-4000-8000-000000000011';
const itemA = 'aaaaaaaa-0000-4000-8000-000000000021';
const itemA2 = 'aaaaaaaa-0000-4000-8000-000000000022';
const itemB = 'bbbbbbbb-0000-4000-8000-000000000021';
const transferId = 'aaaaaaaa-0000-4000-8000-000000000031';
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-26T12:00:00Z');
const ship = () => InventoryService.shipTransfer(transferId, companyA, 'actor-a');
async function batch(n: number, overrides: Partial<typeof inventoryBatches.$inferInsert> = {}) {
  await db.insert(inventoryBatches).values({ id: id(n), itemId: itemA, branchId: origin, lotNumber: `LOT-${n}`,
    initialQuantity: '2.0000', currentQuantity: '2.0000', unitCost: 125, status: 'AVAILABLE',
    expirationDate: new Date('2026-11-01T00:00:00Z'), receivedAt: new Date('2026-10-20T00:00:00Z'),
    createdAt: new Date('2026-10-20T00:00:00Z'), ...overrides });
}
async function line(n: number, overrides: Partial<typeof inventoryTransferItems.$inferInsert> = {}) {
  await db.insert(inventoryTransferItems).values({ id: id(n), transferId, itemId: itemA,
    requestedQuantity: 1, approvedQuantity: 1, ...overrides });
}
const snapshot = () => Promise.all([
  db.select().from(inventoryTransfers).orderBy(inventoryTransfers.id),
  db.select().from(inventoryTransferItems).orderBy(inventoryTransferItems.id),
  db.select().from(inventoryBatches).orderBy(inventoryBatches.id),
  db.select().from(inventoryMovements).orderBy(inventoryMovements.id),
]);
async function rejectsUnchanged(statusCode = 409) {
  const before = await snapshot();
  await expect(ship()).rejects.toMatchObject({ statusCode });
  expect(await snapshot()).toEqual(before);
}

beforeAll(async () => {
  // SQL/driver reales con tipos del esquema. Se relajan FK/NOT NULL para
  // sembrar relaciones corruptas; se mantienen PK y numeric(12,4)/integer.
  for (const table of [branches, inventoryItems, inventoryBatches, inventoryTransfers, inventoryTransferItems, inventoryMovements]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      const type = column.getSQLType();
      return `"${column.name}" ${/^(uuid|text|boolean|integer|numeric|timestamp|jsonb|varchar)/.test(type) ? type : 'text'}${column.name === 'id' ? ' DEFAULT gen_random_uuid() PRIMARY KEY' : ''}`;
    });
    await db.execute(sql.raw(`CREATE TABLE "${config.name}" (${columns.join(',')})`));
  }
  await db.execute(sql`INSERT INTO branches (id,company_id) VALUES (${origin},${companyA}),(${destination},${companyA}),(${foreign},${companyB})`);
  await db.execute(sql`INSERT INTO inventory_items (id,company_id,unit) VALUES (${itemA},${companyA},'KG'),(${itemA2},${companyA},'KG'),(${itemB},${companyB},'KG')`);
}, 60_000);
beforeEach(async () => {
  await db.execute(sql`TRUNCATE inventory_transfers, inventory_transfer_items, inventory_batches, inventory_movements`);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await db.insert(inventoryTransfers).values({ id: transferId, transferNumber: 'TRF-FEFO-TEST',
    fromBranchId: origin, toBranchId: destination, status: 'APPROVED', requestedBy: 'actor-a' });
});
afterEach(() => vi.useRealTimers());
afterAll(() => state.close());

describe('FEFO-04B-2: envío real con asignación común', () => {
  it('descuenta 0.4 + 0.6 de lotes FEFO y conserva exactamente saldo/kardex', async () => {
    await batch(101, { currentQuantity: '0.6000' });
    await batch(102, { currentQuantity: '0.4000', receivedAt: new Date('2026-10-25T00:00:00Z'), expirationDate: new Date('2026-10-27T00:00:00Z') });
    await line(201);
    expect(await ship()).toMatchObject({ status: 'IN_TRANSIT', shippedBy: 'actor-a' });
    const movements = await db.select().from(inventoryMovements);
    expect(movements).toHaveLength(2);
    expect(movements.map(m => [m.batchId, m.quantityChange]).sort()).toEqual([[id(101), '-0.6000'], [id(102), '-0.4000']]);
    expect(movements.every(m => m.branchId === origin && m.itemId === itemA && m.referenceId === transferId && m.performedBy === 'actor-a')).toBe(true);
    expect((await db.select().from(inventoryBatches)).map(b => b.currentQuantity)).toEqual(['0.0000', '0.0000']);
    expect((await db.select().from(inventoryTransferItems))[0]).toMatchObject({ shippedQuantity: 1, batchId: id(101) });
  });

  it('el envío automático excluye vencido AVAILABLE, sin fecha, cuarentena y reserva', async () => {
    await batch(101, { expirationDate: now }); await batch(102, { expirationDate: null });
    await batch(103, { status: 'QUARANTINED' }); await batch(104, { status: 'RESERVED' }); await batch(105);
    await line(201); await ship();
    expect((await db.select().from(inventoryMovements)).map(m => m.batchId)).toEqual([id(105)]);
    expect((await db.select().from(inventoryBatches).where(eq(inventoryBatches.id, id(101))))[0].currentQuantity).toBe('2.0000');
  });

  it.each(['RESERVED', 'QUARANTINED', 'EXPIRED', 'DEPLETED', null] as const)('rechaza lote explícito %s sin sustituirlo por otro disponible', async status => {
    await batch(101, { status }); await batch(102); await line(201, { batchId: id(101) });
    await rejectsUnchanged();
  });

  it.each([null, new Date(now.getTime() - 1), now])('rechaza caducidad explícita %s y revierte cabecera/línea/stock', async expirationDate => {
    await batch(101, { expirationDate }); await batch(102); await line(201, { batchId: id(101) });
    await rejectsUnchanged();
  });

  it.each([{ branchId: destination }, { branchId: foreign }, { itemId: itemA2 }, { itemId: itemB }])('rechaza lote incompatible %j sin escrituras', async overrides => {
    await batch(101, overrides); await batch(102); await line(201, { batchId: id(101) });
    await rejectsUnchanged();
  });

  it('rechaza lote explícito inexistente sin usar el lote disponible', async () => {
    await batch(102); await line(201, { batchId: id(999) }); await rejectsUnchanged();
  });

  it.each([false, true])('rechaza faltante íntegro (selección explícita=%s) sin saldo negativo', async explicit => {
    await batch(101, { currentQuantity: '0.4000' }); await batch(102, { status: 'RESERVED' });
    await line(201, { batchId: explicit ? id(101) : null }); await rejectsUnchanged();
  });

  it('revierte también la primera línea si la segunda no tiene stock elegible', async () => {
    await batch(101); await batch(102, { itemId: itemA2, status: 'QUARANTINED' });
    await line(201, { batchId: id(101) }); await line(202, { itemId: itemA2, batchId: id(102) });
    await rejectsUnchanged();
  });

  it('fallar al insertar el kardex revierte el descuento y el estado', async () => {
    await batch(101); await line(201, { batchId: id(101) });
    const before = await snapshot();
    await db.execute(sql`ALTER TABLE inventory_movements ADD CONSTRAINT reject_transfer CHECK (type <> 'TRANSFER')`);
    try {
      await expect(ship()).rejects.toMatchObject({ cause: { code: '23514' } });
      expect(await snapshot()).toEqual(before);
    } finally { await db.execute(sql`ALTER TABLE inventory_movements DROP CONSTRAINT reject_transfer`); }
  });

  it('conserva el recorrido C17.4: una salida y una entrada, una sola creación en destino', async () => {
    await batch(101); await line(201, { batchId: id(101) });
    await ship(); await InventoryService.receiveTransfer(transferId, companyA, 'actor-destination');
    const movements = await db.select().from(inventoryMovements);
    expect(movements).toHaveLength(2);
    expect(movements.find(m => m.branchId === origin)).toMatchObject({ batchId: id(101), type: 'TRANSFER', quantityChange: '-1.0000', referenceId: transferId });
    expect(movements.find(m => m.branchId === destination)).toMatchObject({ type: 'TRANSFER', quantityChange: '1.0000', referenceId: transferId });
    const batches = await db.select().from(inventoryBatches);
    expect(batches.filter(b => b.branchId === origin)).toHaveLength(1);
    expect(batches.find(b => b.branchId === origin)?.currentQuantity).toBe('1.0000');
    expect(batches.filter(b => b.branchId === destination)).toHaveLength(1);
    expect(batches.find(b => b.branchId === destination)).toMatchObject({ currentQuantity: '1.0000', lotNumber: 'LOT-101' });
  });

  it('repetir un envío ya despachado no vuelve a descontar', async () => {
    await batch(101); await line(201, { batchId: id(101) }); await ship(); await rejectsUnchanged();
  });

  it('reaprobar una transferencia enviada no permite descontarla otra vez', async () => {
    await batch(101); await line(201, { batchId: id(101) }); await ship();
    await InventoryService.approveTransfer(transferId, companyA, 'actor-a');
    await rejectsUnchanged();
  });

  it.each([0, -1])('rechaza cantidad aprobada inválida %s sin cambiar inventario', async approvedQuantity => {
    await batch(101); await line(201, { batchId: id(101), approvedQuantity }); await rejectsUnchanged(400);
  });

  it('si la base no devuelve una cabecera reclamada no envía stock', async () => {
    await batch(101); await line(201, { batchId: id(101) });
    await db.execute(sql.raw(`CREATE FUNCTION block_ship_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$`));
    await db.execute(sql.raw(`CREATE TRIGGER block_ship_claim BEFORE UPDATE ON inventory_transfers FOR EACH ROW EXECUTE FUNCTION block_ship_claim()`));
    try { await rejectsUnchanged(); }
    finally {
      await db.execute(sql.raw(`DROP TRIGGER block_ship_claim ON inventory_transfers`));
      await db.execute(sql.raw(`DROP FUNCTION block_ship_claim()`));
    }
  });

  it('no envía una transferencia vacía', async () => { await rejectsUnchanged(); });

  it('lee la cantidad aprobada después de reclamar el envío', async () => {
    await batch(101); await line(201, { batchId: id(101), requestedQuantity: 2, approvedQuantity: 1 });
    // Cambio en la frontera de reclamo: el envío debe usar la aprobación que
    // existe al obtener la cabecera, sin conservar líneas leídas previamente.
    await db.execute(sql.raw(`CREATE FUNCTION refresh_ship_approval() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE inventory_transfer_items SET approved_quantity=2 WHERE transfer_id=NEW.id; RETURN NEW; END; $$`));
    await db.execute(sql.raw(`CREATE TRIGGER refresh_ship_approval BEFORE UPDATE ON inventory_transfers FOR EACH ROW EXECUTE FUNCTION refresh_ship_approval()`));
    try {
      await ship();
      expect((await db.select().from(inventoryTransferItems))[0].shippedQuantity).toBe(2);
      expect((await db.select().from(inventoryBatches))[0].currentQuantity).toBe('0.0000');
      expect((await db.select().from(inventoryMovements))[0].quantityChange).toBe('-2.0000');
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER refresh_ship_approval ON inventory_transfers`));
      await db.execute(sql.raw(`DROP FUNCTION refresh_ship_approval()`));
    }
  });

  it('C17.3: HTTP permite enviar al gerente del origen y rechaza al del destino', async () => {
    await batch(101); await line(201, { batchId: id(101) });
    const patch = () => PATCH(new NextRequest(`http://localhost/api/inventory/transfers/${transferId}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'ship' }), headers: { 'Content-Type': 'application/json' },
    }), { params: Promise.resolve({ id: transferId }) });
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'actor-a', role: 'GERENTE', companyId: companyA, branchId: destination } } as never);
    const before = await snapshot();
    expect((await patch()).status).toBe(403);
    expect(await snapshot()).toEqual(before);
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'actor-a', role: 'GERENTE', companyId: companyA, branchId: origin } } as never);
    expect((await patch()).status).toBe(200);
    expect(await db.select().from(inventoryMovements)).toHaveLength(1);
  });

  it('HTTP devuelve 409 y conserva inventario para lote explícito vencido', async () => {
    await batch(101, { expirationDate: now }); await line(201, { batchId: id(101) });
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'actor-a', role: 'GERENTE', companyId: companyA, branchId: origin } } as never);
    const before = await snapshot();
    const response = await PATCH(new NextRequest(`http://localhost/api/inventory/transfers/${transferId}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'ship' }), headers: { 'Content-Type': 'application/json' },
    }), { params: Promise.resolve({ id: transferId }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Stock elegible insuficiente');
    expect(await snapshot()).toEqual(before);
  });

  it('no envía una transferencia cuyo destino pertenece a otra empresa', async () => {
    await batch(101); await line(201, { batchId: id(101) });
    await db.update(inventoryTransfers).set({ toBranchId: foreign }).where(eq(inventoryTransfers.id, transferId));
    await rejectsUnchanged(404);
  });
});
