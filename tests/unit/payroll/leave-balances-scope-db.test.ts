import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
  return { pg: new PGlite(), session: { user: { id: 'admin', role: 'ADMIN', companyId: 'aaaaaaaa-0000-4000-8000-000000000001', branchId: 'aaaaaaaa-0000-4000-8000-000000000011' } } };
});
vi.mock('@/lib/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite');
  const schema = await import('@/lib/db/schema');
  return { db: drizzle(runtime.pg, { schema }) };
});
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => runtime.session } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
import { GET, POST, PATCH } from '@/app/api/leave/balances/route';

const company = 'aaaaaaaa-0000-4000-8000-000000000001';
const foreignCompany = 'bbbbbbbb-0000-4000-8000-000000000002';
const branch = 'aaaaaaaa-0000-4000-8000-000000000011';
const siblingBranch = 'aaaaaaaa-0000-4000-8000-000000000012';
const type = 'aaaaaaaa-0000-4000-8000-000000000021';
const foreignType = 'bbbbbbbb-0000-4000-8000-000000000022';
const req = (method = 'GET', body?: unknown, query = '') => new NextRequest(`http://localhost/api/leave/balances${query}`, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const body = (extra = {}) => ({ userId: 'worker', leaveTypeId: type, year: 2026, totalEntitlement: 18, reason: 'Asignación documentada', ...extra });
const batch = (extra = {}) => ({ userIds: ['worker', 'sibling'], leaveTypeId: type, year: 2026, accrualRate: 18, reason: 'Asignación anual documentada', ...extra });
const balances = async () => (await runtime.pg.query('SELECT * FROM leave_balances ORDER BY user_id')).rows;
const logs = async () => (await runtime.pg.query('SELECT * FROM employee_audit_logs ORDER BY user_id')).rows;

beforeAll(async () => {
  await runtime.pg.exec(`
    CREATE TABLE users (id text PRIMARY KEY, company_id uuid, branch_id uuid, role text, deleted_at timestamp);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE leave_types (id uuid PRIMARY KEY, company_id uuid, name text, description text, is_paid boolean, is_active boolean);
    CREATE TABLE leave_balances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES users,
      leave_type_id uuid NOT NULL REFERENCES leave_types, year integer NOT NULL, total_entitlement integer NOT NULL,
      used integer DEFAULT 0, pending integer DEFAULT 0, balance integer NOT NULL, updated_at timestamp DEFAULT now());
    CREATE TABLE employee_audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES users,
      action text, entity_type text, entity_id text, field_name text, old_value jsonb, new_value jsonb,
      performed_by text REFERENCES users, performed_at timestamp, ip_address text, user_agent text, reason text,
      is_sensitive boolean, requires_approval boolean, approved_by text, approved_at timestamp, retention_until timestamp,
      created_at timestamp DEFAULT now());
  `);
});
beforeEach(async () => {
  runtime.session.user = { id: 'admin', role: 'ADMIN', companyId: company, branchId: branch };
  await runtime.pg.exec('TRUNCATE employee_audit_logs, leave_balances, leave_types, users, branches CASCADE');
  await runtime.pg.query('INSERT INTO branches VALUES ($1,$2),($3,$2)', [branch, company, siblingBranch]);
  await runtime.pg.query(`INSERT INTO users VALUES
    ('admin',$1,$2,'ADMIN',null),('manager',$1,$2,'GERENTE',null),('worker',$1,$2,'EMPLEADO',null),
    ('peer',$1,$2,'EMPLEADO',null),('sibling',$1,$3,'EMPLEADO',null),('foreign',$4,null,'EMPLEADO',null)`, [company, branch, siblingBranch, foreignCompany]);
  await runtime.pg.query("INSERT INTO leave_types VALUES ($1,$2,'VACATION','Vacaciones',true,true),($3,$4,'VACATION','Otra empresa',true,true)", [type, company, foreignType, foreignCompany]);
  await runtime.pg.query('INSERT INTO leave_balances (user_id,leave_type_id,year,total_entitlement,used,pending,balance) VALUES ($1,$2,2026,12,3,2,7)', ['worker', type]);
});
afterAll(async () => { await runtime.pg.close(); });

it.each(['EMPLEADO', 'GERENTE', 'SUPERVISOR', 'READONLY'])('no permite asignar derechos al rol %s', async role => {
  await runtime.pg.query('UPDATE users SET role=$1 WHERE id=$2', [role, 'worker']);
  runtime.session.user.id = 'worker'; runtime.session.user.role = role;
  expect((await POST(req('POST', body({ used: 0, pending: 0, balance: 18 })))).status).toBe(403);
  expect((await PATCH(req('PATCH', batch()))).status).toBe(403);
  expect((await balances())[0]).toMatchObject({ total_entitlement: 12, used: 3, pending: 2, balance: 7 });
  expect(await logs()).toHaveLength(0);
});
it('relee autoridad real y rechaza una sesión administrativa revocada', async () => {
  await runtime.pg.exec("UPDATE users SET role='EMPLEADO' WHERE id='admin'");
  expect((await PATCH(req('PATCH', batch()))).status).toBe(403);
});
it('preserva usados/pendientes y deriva saldo, con auditoría completa', async () => {
  const response = await POST(req('POST', body()));
  expect(response.status).toBe(200);
  expect((await balances())[0]).toMatchObject({ user_id: 'worker', total_entitlement: 18, used: 3, pending: 2, balance: 13 });
  expect(await logs()).toHaveLength(1);
  expect((await logs())[0]).toMatchObject({ user_id: 'worker', performed_by: 'admin', entity_type: 'LEAVE_ENTITLEMENT', action: 'UPDATE', reason: 'Asignación documentada', old_value: { totalEntitlement: 12 }, new_value: { totalEntitlement: 18, balance: 13 } });
  expect((await POST(req('POST', body()))).status).toBe(200);
  expect(await logs()).toHaveLength(1);
});
it('crea un saldo y audita solo una vez al repetirlo', async () => {
  expect((await POST(req('POST', body({ userId: 'sibling' })))).status).toBe(201);
  expect((await POST(req('POST', body({ userId: 'sibling' })))).status).toBe(200);
  expect((await balances()).find(row => row.user_id === 'sibling')).toMatchObject({ balance: 18, used: 0, pending: 0 });
  expect((await logs())[0]).toMatchObject({ action: 'CREATE', user_id: 'sibling' });
  expect(await logs()).toHaveLength(1);
});
it.each([{ used: 0 }, { pending: 0 }, { balance: 999 }, { totalEntitlement: 4 }])('rechaza manipular contadores o reducir por debajo del consumo: %j', async extra => {
  expect((await POST(req('POST', body(extra)))).status).toBe(409);
  expect((await balances())[0].balance).toBe(7);
  expect(await logs()).toHaveLength(0);
});
it.each([{ userId: 'foreign' }, { leaveTypeId: foreignType }, { userId: 'missing' }])('no escribe referencias fuera de empresa: %j', async extra => {
  expect((await POST(req('POST', body(extra)))).status).toBe(404);
  expect(await balances()).toHaveLength(1);
  expect(await logs()).toHaveLength(0);
});
it('batch completo o nada cuando un objetivo es ajeno', async () => {
  expect((await PATCH(req('PATCH', batch({ userIds: ['worker', 'foreign'] })))).status).toBe(404);
  expect((await balances())[0].balance).toBe(7);
  expect(await logs()).toHaveLength(0);
});
it('rollback de todo el lote si falla el segundo audit', async () => {
  await runtime.pg.exec(`CREATE FUNCTION reject_worker_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.user_id='worker' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_audit BEFORE INSERT ON employee_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_worker_audit()`);
  try {
    expect((await PATCH(req('PATCH', batch()))).status).toBe(500);
    expect(await balances()).toHaveLength(1);
    expect((await balances())[0].balance).toBe(7);
    expect(await logs()).toHaveLength(0);
  } finally { await runtime.pg.exec('DROP TRIGGER reject_audit ON employee_audit_logs; DROP FUNCTION reject_worker_audit()'); }
});
it('batch deduplica objetivos y mantiene auditoría por cambio', async () => {
  expect((await PATCH(req('PATCH', batch({ userIds: ['worker', 'sibling', 'worker'] })))).status).toBe(200);
  expect(await balances()).toHaveLength(2);
  expect(await logs()).toHaveLength(2);
});
it('rechaza ambigüedad legacy sin fusionar ni sobrescribir filas', async () => {
  await runtime.pg.exec('INSERT INTO leave_balances (user_id,leave_type_id,year,total_entitlement,used,pending,balance) SELECT user_id,leave_type_id,year,total_entitlement,used,pending,balance FROM leave_balances');
  expect((await POST(req('POST', body()))).status).toBe(409);
  expect(await logs()).toHaveLength(0);
});
it.each([{ reason: '' }, { reason: 'abc' }, { year: 2026.5 }, { totalEntitlement: 1.5 }, { totalEntitlement: 2147483648 }])('valida motivo y días/año enteros: %j', async extra => {
  expect((await POST(req('POST', body(extra)))).status).toBe(400);
  expect(await logs()).toHaveLength(0);
});
it('lecturas propias/sucursal/empresa y tipos ajenos no filtran saldos', async () => {
  runtime.session.user.id = 'worker'; runtime.session.user.role = 'EMPLEADO';
  expect((await GET(req())).status).toBe(200);
  expect((await GET(req('GET', undefined, '?userId=peer'))).status).toBe(404);
  runtime.session.user.id = 'manager'; runtime.session.user.role = 'GERENTE';
  expect((await GET(req('GET', undefined, '?userId=worker'))).status).toBe(200);
  expect((await GET(req('GET', undefined, '?userId=sibling'))).status).toBe(404);
  expect((await GET(req('GET', undefined, '?userId=foreign'))).status).toBe(404);
  await runtime.pg.query('INSERT INTO leave_balances (user_id,leave_type_id,year,total_entitlement,balance) VALUES ($1,$2,2026,99,99)', ['worker', foreignType]);
  const response = await GET(req('GET', undefined, '?userId=worker'));
  expect((await response.json()).balances).toHaveLength(1);
});
it('rechaza año y JSON inválidos', async () => {
  expect((await GET(req('GET', undefined, '?year=2026oops'))).status).toBe(400);
  expect((await POST(new NextRequest('http://localhost/api/leave/balances', { method: 'POST', body: '{' }))).status).toBe(400);
});
