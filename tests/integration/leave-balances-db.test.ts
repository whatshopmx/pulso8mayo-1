import { randomUUID } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';

const state = vi.hoisted(() => ({ db: undefined as unknown as typeof import('@/lib/db').db,
  gate: null as null | { pids: number[]; ready: Promise<void>; release: () => void } }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; } }));
vi.mock('@/lib/db/tenant-context', async original => {
  const real = await original<typeof import('@/lib/db/tenant-context')>();
  return { ...real, withCompanyContext: (...args: Parameters<typeof real.withCompanyContext>) => {
    const [scope, callback, client] = args;
    return real.withCompanyContext(scope, async tx => {
      if (!state.gate) return callback(tx);
      // Solo controla el inicio; lock, consultas, commit y audit son reales.
      const gate = state.gate;
      gate.pids.push(Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid));
      if (gate.pids.length === 2) gate.release();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([gate.ready, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Leave assignment barrier timed out')), 15_000);
      })]); } finally { clearTimeout(timer); }
      return callback(tx);
    }, client);
  } };
});

import { accrueLeaveEntitlements, getLeaveBalances, setLeaveEntitlement } from '@/lib/services/leave-balance-service';
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let pool: Pool | undefined;
const company = randomUUID(), foreignCompany = randomUUID(), branch = randomUUID(), type = randomUUID();
const admin = randomUUID(), worker = randomUUID(), peer = randomUUID(), foreign = randomUUID();
const actor = { companyId: company, userId: admin };
const input = (userId = worker) => ({ userId, leaveTypeId: type, year: 2026, totalEntitlement: 18, reason: 'Fuente sintética verificada' });

beforeAll(async () => {
  fixture = await createSalesRuntimeDatabase({ baseline: '0158', grants: 'none' });
  pool = new Pool({ connectionString: fixture.ownerUrl, max: 4, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => console.error('[leave-test] synthetic pool error'));
  state.db = drizzle(pool, { schema });
  await fixture.owner.insert(schema.companies).values([{ id: company, name: 'Synthetic leave A' }, { id: foreignCompany, name: 'Synthetic leave B' }]);
  await fixture.owner.insert(schema.branches).values({ id: branch, companyId: company, name: 'A' });
  await fixture.owner.insert(schema.users).values([
    { id: admin, name: 'Admin', email: `${admin}@test.invalid`, companyId: company, branchId: branch, role: 'ADMIN' },
    { id: worker, name: 'Worker', email: `${worker}@test.invalid`, companyId: company, branchId: branch, role: 'EMPLEADO' },
    { id: peer, name: 'Peer', email: `${peer}@test.invalid`, companyId: company, branchId: branch, role: 'EMPLEADO' },
    { id: foreign, name: 'Foreign', email: `${foreign}@test.invalid`, companyId: foreignCompany, role: 'EMPLEADO' },
  ].map(user => ({ ...user, role: user.role as 'ADMIN' | 'EMPLEADO', emailVerified: false, createdAt: new Date(), updatedAt: new Date() })));
  await fixture.owner.insert(schema.leaveTypes).values({ id: type, companyId: company, name: 'VACATION' });
}, 180_000);
afterAll(async () => { try { await pool?.end(); } finally { await fixture?.close(); } });

it('commit real, alcance y rollback de batch ante fallo de auditoría', async () => {
  const saved = await setLeaveEntitlement(actor, input());
  expect(saved.created).toBe(true);
  expect(saved.balance.balance).toBe(18);
  await expect(setLeaveEntitlement({ companyId: company, userId: worker }, input())).rejects.toMatchObject({ statusCode: 403 });
  await expect(setLeaveEntitlement(actor, input(foreign))).rejects.toMatchObject({ statusCode: 404 });
  await expect(getLeaveBalances({ companyId: company, userId: peer }, { userId: worker })).rejects.toMatchObject({ statusCode: 404 });
  const before = (await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM employee_audit_logs WHERE entity_type='LEAVE_ENTITLEMENT'`)).rows[0].n;
  await fixture!.owner.execute(sql.raw(`CREATE FUNCTION reject_leave_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.entity_type='LEAVE_ENTITLEMENT' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`));
  await fixture!.owner.execute(sql.raw('CREATE TRIGGER reject_leave_audit BEFORE INSERT ON employee_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_leave_audit()'));
  try {
    await expect(accrueLeaveEntitlements(actor, { userIds: [worker, peer], leaveTypeId: type, year: 2026, accrualRate: 20, reason: 'Corrección sintética' })).rejects.toBeDefined();
    const rows = await fixture!.owner.execute(sql`SELECT user_id,balance FROM leave_balances`);
    expect(rows.rows).toEqual([{ user_id: worker, balance: 18 }]);
    expect((await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM employee_audit_logs WHERE entity_type='LEAVE_ENTITLEMENT'`)).rows[0].n).toBe(before);
  } finally {
    await fixture!.owner.execute(sql.raw('DROP TRIGGER reject_leave_audit ON employee_audit_logs'));
    await fixture!.owner.execute(sql.raw('DROP FUNCTION reject_leave_audit()'));
  }
});

it('dos conexiones asignan el mismo saldo ausente sin duplicar fila ni auditoría', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const gate = { pids: [] as number[], ready, release };
  state.gate = gate;
  const attempts = [setLeaveEntitlement(actor, input(peer)), setLeaveEntitlement(actor, input(peer))];
  try {
    const results = await Promise.all(attempts);
    expect(new Set(gate.pids).size).toBe(2);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(results.filter(result => result.changed)).toHaveLength(1);
    expect((await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM leave_balances WHERE user_id=${peer}`)).rows[0].n).toBe(1);
    expect((await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM employee_audit_logs WHERE user_id=${peer} AND entity_type='LEAVE_ENTITLEMENT'`)).rows[0].n).toBe(1);
  } finally { release(); await Promise.allSettled(attempts); state.gate = null; }
});
