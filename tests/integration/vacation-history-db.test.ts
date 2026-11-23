import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { companies, branches, users, vacationRequests } from '@/lib/db/schema';
import { createSalesRuntimeDatabase } from './helpers/sales-runtime-database';

let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let pool: Pool | undefined;
let runtime: ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<typeof runtime.transaction>[0]>[0];
const company = randomUUID(), foreignCompany = randomUUID(), branch = randomUUID(), sibling = randomUUID();
const admin = randomUUID(), manager = randomUUID(), worker = randomUUID(), other = randomUUID(), foreignAdmin = randomUUID(), foreignWorker = randomUUID();
const stream = randomUUID(), otherStream = randomUUID(), foreignStream = randomUUID();
const vacationId = randomUUID(), foreignVacationId = randomUUID();
const code = (error: unknown) => {
  const failure = error as { code?: string; cause?: { code?: string } };
  return failure.cause?.code ?? failure.code;
};
async function rejects(promise: Promise<unknown>, expected: string) {
  try { await promise; } catch (error) { expect(code(error)).toBe(expected); return; }
  throw new Error(`Expected SQLSTATE ${expected}`);
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('History coordination timed out')), 30_000);
  })]); } finally { clearTimeout(timer); }
}
const run = <T>(actor: string, work: (tx: Tx) => Promise<T>, companyId = company) => runtime.transaction(async tx => {
  await tx.execute(sql`SELECT set_config('app.current_company_id',${companyId},true),set_config('app.current_actor_id',${actor},true)`);
  return work(tx);
});
const opening = (tx: Tx, id: string, userId: string, companyId = company) => tx.execute(sql`
  INSERT INTO vacation_history_streams(id,company_id,user_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
  VALUES (${id},${companyId},${userId},'2026-01-01','2026-12-31','verified native source','verified opening',current_setting('app.current_actor_id'),${id})
  RETURNING id,record_version::text`);
const grant = (tx: Tx, streamId: string, userId: string) => tx.execute(sql`
  INSERT INTO vacation_history_events(stream_id,company_id,user_id,kind,valid_from,valid_through,days,source_reference,reason,actor_id,idempotency_key,recorded_at,record_version)
  VALUES (${streamId},${company},${userId},'GRANT','2026-01-01','2026-12-31',12,'verified native source','verified credit',current_setting('app.current_actor_id'),${randomUUID()},'2000-01-01',-10)
  RETURNING id,actor_id,recorded_at,record_version::text`);

beforeAll(async () => {
  fixture = await createSalesRuntimeDatabase({ baseline: '0158', grants: 'none' });
  await fixture.owner.transaction(async tx => {
    for (const file of ['0163_nom02c1_vacation_runtime.sql', '0164_nom02c1_vacation_history.sql']) {
      for (const statement of readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').filter(part => part.trim())) {
        await tx.execute(sql.raw(statement.replaceAll('pulso_vacations_app', fixture!.roleName)));
      }
    }
  });
  await fixture.owner.insert(companies).values([{ id: company, name: 'Synthetic history A' }, { id: foreignCompany, name: 'Synthetic history B' }]);
  await fixture.owner.insert(branches).values([{ id: branch, companyId: company, name: 'A' }, { id: sibling, companyId: company, name: 'A sibling' }]);
  await fixture.owner.insert(users).values([
    { id: admin, companyId: company, branchId: null, role: 'ADMIN' as const },
    { id: manager, companyId: company, branchId: branch, role: 'GERENTE' as const },
    { id: worker, companyId: company, branchId: branch, role: 'EMPLEADO' as const },
    { id: other, companyId: company, branchId: sibling, role: 'EMPLEADO' as const },
    { id: foreignAdmin, companyId: foreignCompany, branchId: null, role: 'ADMIN' as const },
    { id: foreignWorker, companyId: foreignCompany, branchId: null, role: 'EMPLEADO' as const },
  ].map(user => ({ ...user, name: user.id, email: `${user.id}@history.invalid`, createdAt: new Date(), updatedAt: new Date() })));
  await fixture.owner.insert(vacationRequests).values([
    { id: vacationId, userId: worker, companyId: company, branchId: branch, approvedBy: manager },
    { id: foreignVacationId, userId: foreignWorker, companyId: foreignCompany, branchId: null, approvedBy: foreignAdmin },
  ].map(request => ({ ...request, status: 'APPROVED' as const, approvedAt: new Date(), startDate: new Date('2026-05-01T00:00:00Z'),
    endDate: new Date('2026-05-02T00:00:00Z'), totalDays: 2 })));
  pool = new Pool({ connectionString: fixture.runtimeUrl, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => console.error('[history-fixture] runtime pool error'));
  runtime = drizzle(pool);
  await run(admin, async tx => { await opening(tx, stream, worker); await opening(tx, otherStream, other); });
  await run(foreignAdmin, async tx => { await opening(tx, foreignStream, foreignWorker, foreignCompany); }, foreignCompany);
}, 180_000);
afterAll(async () => { try { await pool?.end(); } finally { await fixture?.close(); } }, 90_000);

it('LOGIN real: RLS/metadata/privilegios y prohibición de reescribir o truncar la historia', async () => {
  const people = (tx: Tx) => tx.execute<{ user_id: string }>(sql`SELECT user_id FROM vacation_history_streams ORDER BY user_id`).then(result => result.rows.map(row => row.user_id));
  await run(admin, async tx => {
    const who = (await tx.execute(sql`SELECT current_user,session_user,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass`)).rows[0];
    expect(who).toEqual({ current_user: fixture!.roleName, session_user: fixture!.roleName, bypass: false });
    expect(await people(tx)).toEqual([worker, other].sort());
    const saved = (await grant(tx, stream, worker)).rows[0];
    expect(saved.actor_id).toBe(admin);
    expect(BigInt(String(saved.record_version))).toBeGreaterThan(0n);
    expect(new Date(String(saved.recorded_at)).getUTCFullYear()).toBeGreaterThan(2020);
  });
  expect(await run(manager, people)).toEqual([worker]);
  expect(await run(worker, people)).toEqual([worker]);
  expect(await run('', people)).toEqual([]);
  await rejects(run(worker, tx => grant(tx, stream, worker)), '42501');
  await rejects(run(admin, tx => tx.execute(sql`SELECT * FROM users`)), '42501');
  await rejects(run(admin, tx => tx.execute(sql`SELECT nextval('vacation_history_record_version_seq')`)), '42501');
  await rejects(run(admin, tx => tx.execute(sql`UPDATE vacation_history_events SET reason='changed'`)), '42501');
  await rejects(fixture!.owner.execute(sql`TRUNCATE vacation_history_events`), '23514');
  const approve = (tx: Tx, id: string) => tx.execute(sql`INSERT INTO vacation_history_events
    (stream_id,company_id,user_id,kind,valid_from,valid_through,days,vacation_request_id,source_reference,reason,actor_id,idempotency_key)
    VALUES (${stream},${company},${worker},'APPROVE_REQUEST','2026-05-01','2026-05-02',2,${id},'native request','decision',current_setting('app.current_actor_id'),${randomUUID()})
    RETURNING id,record_version::text`);
  await rejects(run(worker, tx => approve(tx, vacationId)), '42501');
  await rejects(run(manager, tx => approve(tx, foreignVacationId)), '23514');
  const approved = (await run(manager, tx => approve(tx, vacationId))).rows[0];
  await fixture!.owner.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.current_company_id',${company},true),set_config('app.current_actor_id',${worker},true)`);
    await tx.execute(sql`UPDATE vacation_requests SET status='CANCELLED',cancelled_at=now() WHERE id=${vacationId}`);
  });
  const cancelled = (await run(worker, tx => tx.execute(sql`INSERT INTO vacation_history_events
    (stream_id,company_id,user_id,kind,vacation_request_id,reverses_event_id,source_reference,reason,actor_id,idempotency_key)
    VALUES (${stream},${company},${worker},'CANCEL_REQUEST',${vacationId},${approved.id},'native request','cancel',current_setting('app.current_actor_id'),${randomUUID()})
    RETURNING actor_id,record_version::text`))).rows[0];
  expect(cancelled.actor_id).toBe(worker);
  expect(BigInt(String(cancelled.record_version))).toBeGreaterThan(BigInt(String(approved.record_version)));
  const force = (await fixture!.owner.execute(sql`SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS forced FROM pg_class
    WHERE oid IN ('public.vacation_history_streams'::regclass,'public.vacation_history_events'::regclass)`)).rows[0];
  expect(force.forced).toBe(true);
}, 120_000);

it('dos conexiones serializan apertura y corte por empleado; una escritura posterior no entra en una versión capturada', async () => {
  const raceUser = randomUUID();
  await fixture!.owner.insert(users).values({ id: raceUser, companyId: company, branchId: branch, role: 'EMPLEADO', name: 'Synthetic race',
    email: `${raceUser}@history.invalid`, createdAt: new Date(), updatedAt: new Date() });
  let ready = 0, releaseRace!: () => void;
  const barrier = new Promise<void>(resolve => { releaseRace = resolve; });
  const pids: number[] = [], candidates = [randomUUID(), randomUUID()];
  const create = (id: string) => run(admin, async tx => {
    pids.push(Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid));
    if (++ready === 2) releaseRace();
    await bounded(barrier);
    return opening(tx, id, raceUser);
  });
  const raced = await Promise.allSettled(candidates.map(create));
  expect(new Set(pids).size).toBe(2);
  expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const loser = raced.find(result => result.status === 'rejected');
  expect(loser?.status === 'rejected' && code(loser.reason)).toBe('23514');
  const winner = await run(admin, async tx => String((await tx.execute(sql`SELECT id FROM vacation_history_streams WHERE user_id=${raceUser}`)).rows[0].id));

  let captured!: () => void, releaseReader!: () => void, writerStarted!: () => void;
  const captureReady = new Promise<void>(resolve => { captured = resolve; });
  const readerGate = new Promise<void>(resolve => { releaseReader = resolve; });
  const writerReady = new Promise<void>(resolve => { writerStarted = resolve; });
  let writerPid = 0, cutoff = '0';
  const reader = run(admin, async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${company}::text || ':' || ${raceUser},0))`);
    cutoff = String((await tx.execute(sql`SELECT record_version::text FROM vacation_history_streams WHERE id=${winner}`)).rows[0].record_version);
    captured();
    await bounded(readerGate);
  });
  let writer: Promise<unknown> | undefined;
  try {
    await bounded(Promise.race([captureReady, reader]));
    writer = run(admin, async tx => {
      writerPid = Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
      writerStarted();
      return grant(tx, winner, raceUser);
    });
    await bounded(Promise.race([writerReady, writer]));
    const deadline = Date.now() + 10_000;
    let blocked = false;
    while (!blocked && Date.now() < deadline) {
      blocked = Boolean((await fixture!.owner.execute(sql`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=${writerPid} AND locktype='advisory' AND NOT granted) AS blocked`)).rows[0].blocked);
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(blocked).toBe(true);
    releaseReader(); await reader;
    const saved = await writer as Awaited<ReturnType<typeof grant>>;
    expect(BigInt(String(saved.rows[0].record_version))).toBeGreaterThan(BigInt(cutoff));
    const stable = await run(admin, tx => tx.execute(sql`SELECT id FROM vacation_history_events WHERE stream_id=${winner} AND record_version<=${cutoff}::bigint`));
    expect(stable.rows).toEqual([]);
  } finally { releaseReader(); await Promise.allSettled([reader, ...(writer ? [writer] : [])]); }
}, 150_000);
