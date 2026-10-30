import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auth, getSession } from '@/lib/auth';
import * as tables from '@/lib/db/schema';
import { GET, PATCH } from '@/app/api/inventory/batches/route';

const state = vi.hoisted(() => ({ close: async () => {} }));
vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite();
  state.close = () => client.close();
  return { db: drizzle(client) };
});
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), auth: { api: { getSession: vi.fn() } } }));

const companyA = 'aaaaaaaa-0000-4000-8000-000000000001';
const companyB = 'bbbbbbbb-0000-4000-8000-000000000001';
const a1 = 'aaaaaaaa-0000-4000-8000-000000000011';
const a2 = 'aaaaaaaa-0000-4000-8000-000000000012';
const b1 = 'bbbbbbbb-0000-4000-8000-000000000011';
const itemA = 'aaaaaaaa-0000-4000-8000-000000000021';
const itemB = 'bbbbbbbb-0000-4000-8000-000000000021';
const lot1 = 'aaaaaaaa-0000-4000-8000-000000000031';
const lot2 = 'aaaaaaaa-0000-4000-8000-000000000032';
const lotB = 'bbbbbbbb-0000-4000-8000-000000000031';
const crossed = 'aaaaaaaa-0000-4000-8000-000000000033';
const databaseTables = [tables.branches, tables.inventoryItems, tables.suppliers, tables.inventoryBatches,
  tables.productionIngredients, tables.productionResults, tables.recipes, tables.inventoryWaste, tables.inventoryMovements,
  tables.inventoryAuditLog];

beforeAll(async () => {
  // Mismo esquema/driver de consultas: sólo se relajan constraints para sembrar
  // relaciones corruptas deliberadamente. No accede a DATABASE_URL.
  for (const table of databaseTables) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      const type = column.getSQLType();
      return `"${column.name}" ${/^(uuid|text|boolean|integer|numeric|timestamp|jsonb|varchar)/.test(type) ? type : 'text'}`;
    });
    await db.execute(sql.raw(`CREATE TABLE "${config.name}" (${columns.join(',')})`));
  }
  await db.execute(sql`INSERT INTO branches (id,company_id,name) VALUES
    (${a1},${companyA},'A1'),(${a2},${companyA},'A2'),(${b1},${companyB},'B1')`);
  await db.execute(sql`INSERT INTO inventory_items (id,company_id,name,unit) VALUES
    (${itemA},${companyA},'Producto A','KG'),(${itemB},${companyB},'Producto B','KG')`);
  await db.execute(sql`INSERT INTO inventory_batches (id,item_id,branch_id,initial_quantity,current_quantity,status) VALUES
    (${lot1},${itemA},${a1},2,1.125,'AVAILABLE'),(${lot2},${itemA},${a2},2,2,'AVAILABLE'),
    (${lotB},${itemB},${b1},2,2,'AVAILABLE'),(${crossed},${itemB},${a1},2,2,'AVAILABLE')`);
}, 60_000);
afterAll(() => state.close());

function session(role = 'GERENTE', branchId: string | null = a1, companyId: string | null = companyA) {
  const value = { user: { id: 'actor-a', role, branchId, companyId } };
  vi.mocked(getSession).mockResolvedValue(value as never);
  vi.mocked(auth.api.getSession).mockResolvedValue(value as never);
}
beforeEach(async () => {
  vi.clearAllMocks(); session();
  await db.execute(sql`UPDATE inventory_batches SET status='AVAILABLE', current_quantity=1.125, expiration_date='2099-01-01'`);
  await db.execute(sql`TRUNCATE inventory_audit_log`);
});
const get = (query = '') => GET(new NextRequest(`http://localhost/api/inventory/batches${query}`));

describe('FEFO-03A: alcance real de listado y trazabilidad', () => {
  it.each(['ADMIN', 'OWNER', 'SUPER_ADMIN'])('%s sólo lista productos/sucursales de su empresa', async role => {
    session(role, null);
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).batches.map((row: { id: string }) => row.id).sort()).toEqual([lot1, lot2]);
  });
  it.each(['GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'])('%s sólo consulta su sucursal', async role => {
    session(role);
    expect((await (await get()).json()).batches.map((row: { id: string }) => row.id)).toEqual([lot1]);
    expect((await get(`?id=${lot2}&trace=true`)).status).toBe(404);
  });
  it.each(['GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'])('%s sin sucursal no obtiene datos', async role => {
    session(role, null);
    expect((await get()).status).toBe(403);
  });
  it('no permite sustituir la sucursal del usuario con un filtro', async () => {
    expect((await get(`?branchId=${a2}`)).status).toBe(403);
    session('ADMIN', null);
    expect((await (await get(`?branchId=${b1}`)).json()).batches).toEqual([]);
  });
  it.each([lotB, crossed, 'cccccccc-0000-4000-8000-000000000031'])('ID ajeno/inexistente %s no revela trazabilidad', async id => {
    expect((await get(`?id=${id}&trace=true`)).status).toBe(404);
  });
  it('mantiene forma del lote propio y sus cantidades fraccionarias', async () => {
    const response = await get(`?id=${lot1}&trace=true`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, batch: { id: lot1, currentQuantity: 1.125 },
      trace: { productions: [], waste: [], movements: [] } });
  });
  it('filtra ID también sin trace y rechaza aliases incompatibles', async () => {
    session('ADMIN', null);
    expect((await (await get(`?id=${lot2}`)).json()).batches.map((row: { id: string }) => row.id)).toEqual([lot2]);
    expect((await get(`?id=${lot1}&batchId=${lot2}&trace=true`)).status).toBe(400);
  });
  it('no filtra datos ajenos mediante referencias corruptas desde un lote propio', async () => {
    await db.execute(sql`INSERT INTO inventory_movements (batch_id,item_id,branch_id,type,quantity_change) VALUES
      (${lot1},${itemA},${a1},'USAGE',-0.125),(${lot1},${itemB},${b1},'USAGE',-5),(${lot1},${itemB},${a1},'USAGE',-8)`);
    await db.execute(sql`INSERT INTO inventory_waste (batch_id,item_id,branch_id,company_id,quantity,reason) VALUES
      (${lot1},${itemA},${a1},${companyA},0.125,'DAMAGED'),(${lot1},${itemA},${a2},${companyA},9,'DAMAGED'),
      (${lot1},${itemA},${a1},${companyB},7,'DAMAGED')`);
    await db.execute(sql`INSERT INTO production_results (id,company_id,branch_id,recipe_id) VALUES
      (${lot1},${companyA},${a1},${itemA}),(${lot2},${companyA},${a2},${itemA}),(${lotB},${companyB},${b1},${itemB})`);
    await db.execute(sql`INSERT INTO production_ingredients (result_id,batch_id,item_id,actual_quantity) VALUES
      (${lot1},${lot1},${itemA},0.25),(${lot2},${lot1},${itemA},4),(${lotB},${lot1},${itemA},8)`);
    try {
      const { trace } = await (await get(`?id=${lot1}&trace=true`)).json();
      expect(trace.movements.map((row: { quantityChange: number }) => row.quantityChange)).toEqual([-0.125]);
      expect(trace.waste.map((row: { quantity: number }) => row.quantity)).toEqual([0.125]);
      expect(trace.productions.map((row: { actualQuantity: number }) => row.actualQuantity)).toEqual([0.25]);
    } finally {
      await db.execute(sql`TRUNCATE inventory_movements, inventory_waste, production_ingredients, production_results`);
    }
  });
  it.each(['?id=invalid&trace=true', '?status=INVALID', '?itemId=invalid', '?branchId=invalid', '?trace=true'])('rechaza filtros inválidos %s', async query => {
    expect((await get(query)).status).toBe(400);
  });
  it('sin rol o con rol desconocido no asume ADMIN', async () => {
    session(''); expect((await get()).status).toBe(403);
    session('UNKNOWN'); expect((await get()).status).toBe(403);
  });
  it('requiere sesión y empresa', async () => {
    session('ADMIN', null, null); expect((await get()).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
});

const patch = (status: string, notes: unknown = '  Revisión física del lote  ', batchId = lot1) => PATCH(
  new NextRequest('http://localhost/api/inventory/batches', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId, status, notes }) }));
const audit = async () => (await db.select().from(tables.inventoryAuditLog));
const current = async () => (await db.select().from(tables.inventoryBatches).where(sql`id=${lot1}`))[0];

describe('FEFO-03B: estado y auditoría atómicos', () => {
  it('requiere empresa, sesión y asignación para escritura local', async () => {
    session('GERENTE', null); expect((await patch('QUARANTINED')).status).toBe(403);
    session('ADMIN', null, null); expect((await patch('QUARANTINED')).status).toBe(401);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    expect((await patch('QUARANTINED')).status).toBe(401);
    expect(await audit()).toHaveLength(0);
  });
  it('ADMIN tampoco modifica productos o sucursales de otra empresa', async () => {
    session('ADMIN', null);
    for (const id of [lotB, crossed]) expect((await patch('QUARANTINED', 'Verificación', id)).status).toBe(404);
    expect(await audit()).toHaveLength(0);
  });
  it('sólo un gerente o superior reserva íntegramente un lote', async () => {
    session('SUPERVISOR'); expect((await patch('RESERVED')).status).toBe(403);
    session('GERENTE'); expect((await patch('RESERVED')).status).toBe(200);
    expect(await current()).toMatchObject({ status: 'RESERVED', currentQuantity: '1.1250' });
    expect(await audit()).toHaveLength(1);
  });
  it.each(['EMPLEADO', 'READONLY', 'UNKNOWN', ''])('deniega PATCH al rol %s', async role => {
    session(role);
    expect((await patch('QUARANTINED')).status).toBe(403);
    expect((await current()).status).toBe('AVAILABLE');
    expect(await audit()).toHaveLength(0);
  });
  it.each([lot2, lotB, crossed])('no modifica ni revela el lote fuera de alcance %s', async id => {
    expect((await patch('QUARANTINED', 'Bloqueo preventivo', id)).status).toBe(404);
    expect(await audit()).toHaveLength(0);
  });
  it.each(['', '   ', 'x'.repeat(1001)])('exige motivo válido %j', async notes => {
    expect((await patch('QUARANTINED', notes)).status).toBe(400);
    expect((await current()).status).toBe('AVAILABLE');
    expect(await audit()).toHaveLength(0);
  });
  it('rechaza un cambio sin motivo', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/inventory/batches', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: lot1, status: 'QUARANTINED' }) }));
    expect(response.status).toBe(400);
    expect(await audit()).toHaveLength(0);
  });
  it('SUPERVISOR puede inmovilizar y conserva cantidad y auditoría con actor de sesión', async () => {
    session('SUPERVISOR');
    expect((await patch('QUARANTINED')).status).toBe(200);
    expect(await current()).toMatchObject({ status: 'QUARANTINED', currentQuantity: '1.1250' });
    expect(await audit()).toEqual([expect.objectContaining({ companyId: companyA, branchId: a1,
      entityId: lot1, entityType: 'BATCH', action: 'UPDATE', performedBy: 'actor-a',
      reason: 'Revisión física del lote', oldValue: { status: 'AVAILABLE' }, newValue: { status: 'QUARANTINED' } })]);
  });
  it('sólo GERENTE o superior libera cuarentena y reserva íntegra', async () => {
    for (const status of ['QUARANTINED', 'RESERVED']) {
      await db.execute(sql`UPDATE inventory_batches SET status=${status} WHERE id=${lot1}`);
      session('SUPERVISOR'); expect((await patch('AVAILABLE')).status).toBe(403);
      session('GERENTE'); expect((await patch('AVAILABLE')).status).toBe(200);
    }
    expect(await audit()).toHaveLength(2);
  });
  it.each(['EXPIRED', 'DEPLETED'])('PATCH no fabrica disponibilidad desde %s ni deriva estados sin movimientos', async status => {
    expect((await patch(status)).status).toBe(409);
    await db.execute(sql`UPDATE inventory_batches SET status=${status} WHERE id=${lot1}`);
    expect((await patch('AVAILABLE')).status).toBe(409);
    expect(await audit()).toHaveLength(0);
  });
  it('no libera un lote vencido, sin fecha o sin saldo', async () => {
    for (const [expiration, quantity] of [['2000-01-01', '1'], [null, '1'], ['2099-01-01', '0']]) {
      await db.execute(sql`UPDATE inventory_batches SET status='QUARANTINED',expiration_date=${expiration},current_quantity=${quantity} WHERE id=${lot1}`);
      expect((await patch('AVAILABLE')).status).toBe(409);
    }
    expect(await audit()).toHaveLength(0);
  });
  it('dos peticiones al mismo estado no duplican la auditoría', async () => {
    const responses = await Promise.all([patch('QUARANTINED'), patch('QUARANTINED')]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await audit()).toHaveLength(1);
  });
  it('si falla la auditoría, revierte el cambio de estado', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.execute(sql.raw(`CREATE FUNCTION fail_fefo_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated audit failure'; END $$`));
    await db.execute(sql.raw('CREATE TRIGGER fail_fefo_audit BEFORE INSERT ON inventory_audit_log FOR EACH ROW EXECUTE FUNCTION fail_fefo_audit()'));
    try {
      expect((await patch('QUARANTINED')).status).toBe(500);
      expect((await current()).status).toBe('AVAILABLE');
      expect(await audit()).toHaveLength(0);
    } finally {
      await db.execute(sql.raw('DROP TRIGGER fail_fefo_audit ON inventory_audit_log'));
      await db.execute(sql.raw('DROP FUNCTION fail_fefo_audit()'));
      error.mockRestore();
    }
  });
});
