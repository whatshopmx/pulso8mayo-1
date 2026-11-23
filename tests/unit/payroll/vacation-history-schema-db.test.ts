import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';

const pg = new PGlite();
const company = randomUUID(), foreignCompany = randomUUID(), branch = randomUUID(), sibling = randomUUID();
const stream = randomUUID(), peerStream = randomUUID(), siblingStream = randomUUID(), foreignStream = randomUUID();
const requestId = randomUUID(), foreignRequestId = randomUUID();

async function actor<T>(id: string, run: () => Promise<T>, companyId = company, commit = false): Promise<T> {
  await pg.exec('BEGIN');
  let committed = false;
  try {
    await pg.query("SELECT set_config('app.current_company_id',$1,true),set_config('app.current_actor_id',$2,true)", [companyId, id]);
    await pg.exec('SET LOCAL ROLE pulso_vacations_app');
    const result = await run();
    if (commit) { await pg.exec('COMMIT'); committed = true; }
    return result;
  } finally { if (!committed) await pg.exec('ROLLBACK'); }
}
async function opening(id: string, userId = 'worker', predecessor: string | null = null) {
  return (await pg.query(`INSERT INTO vacation_history_streams
    (id,company_id,user_id,predecessor_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
    VALUES ($1,$2,$3,$4,'2026-01-01','2026-12-31','verified source','verified opening',current_setting('app.current_actor_id'),$5)
    RETURNING *`, [id, company, userId, predecessor, id])).rows[0];
}
async function event(kind = 'GRANT', extra: { requestId?: string; reversalId?: string; streamId?: string } = {}) {
  const approval = kind === 'APPROVE_REQUEST', grant = kind === 'GRANT';
  return (await pg.query(`INSERT INTO vacation_history_events
    (stream_id,company_id,user_id,kind,valid_from,valid_through,days,vacation_request_id,reverses_event_id,
      source_reference,reason,actor_id,idempotency_key,recorded_at,record_version)
    VALUES ($1,$2,'worker',$3,$4,$5,$6,$7,$8,'verified source','verified event',current_setting('app.current_actor_id'),$9,'2000-01-01',-10)
    RETURNING *`, [extra.streamId ?? stream, company, kind, grant ? '2026-01-01' : approval ? '2026-05-01' : null,
    grant ? '2026-12-31' : approval ? '2026-05-02' : null, grant ? 12 : approval ? 2 : null,
    extra.requestId ?? null, extra.reversalId ?? null, randomUUID()])).rows[0];
}

beforeAll(async () => {
  await pg.exec(`CREATE ROLE pulso_vacations_app NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE users(id text PRIMARY KEY,company_id uuid,branch_id uuid,role text,deleted_at timestamp);
    CREATE TABLE branches(id uuid PRIMARY KEY,company_id uuid);
    CREATE TABLE leave_types(id uuid PRIMARY KEY,company_id uuid,name text);
    CREATE TABLE vacation_requests(id uuid PRIMARY KEY,user_id text,company_id uuid,branch_id uuid,start_date timestamp,end_date timestamp,
      total_days int,status text,approved_by text,approved_at timestamp,cancelled_at timestamp);
    CREATE TABLE leave_requests(id uuid PRIMARY KEY,user_id text,company_id uuid,branch_id uuid,leave_type_id uuid,start_date timestamp,end_date timestamp,
      total_days int,status text,approved_by text,approved_at timestamp);
  `);
  for (const statement of readFileSync('drizzle/0164_nom02c1_vacation_history.sql', 'utf8').split('--> statement-breakpoint').filter(part => part.trim())) await pg.exec(statement);
  await pg.query('INSERT INTO companies VALUES ($1),($2)', [company, foreignCompany]);
  await pg.query('INSERT INTO branches VALUES ($1,$2),($3,$2)', [branch, company, sibling]);
  await pg.query(`INSERT INTO users VALUES ('admin',$1,NULL,'ADMIN',NULL),('manager',$1,$2,'GERENTE',NULL),
    ('worker',$1,$2,'EMPLEADO',NULL),('peer',$1,$2,'EMPLEADO',NULL),('sibling',$1,$3,'EMPLEADO',NULL),
    ('readonly',$1,$2,'READONLY',NULL),('foreign-admin',$4,NULL,'ADMIN',NULL),('foreign',$4,NULL,'EMPLEADO',NULL)`, [company, branch, sibling, foreignCompany]);
  await actor('admin', async () => { await opening(stream); await opening(peerStream, 'peer'); await opening(siblingStream, 'sibling'); }, company, true);
  await pg.query(`INSERT INTO vacation_requests VALUES ($1,'worker',$2,$3,'2026-05-01','2026-05-02',2,'APPROVED','manager',now(),NULL),
    ($4,'foreign',$5,NULL,'2026-05-01','2026-05-02',2,'APPROVED','foreign-admin',now(),NULL)`, [requestId, company, branch, foreignRequestId, foreignCompany]);
  await actor('foreign-admin', async () => {
    await pg.query(`INSERT INTO vacation_history_streams(id,company_id,user_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
      VALUES ($1,$2,'foreign','2026-01-01','2026-12-31','verified','opening','foreign-admin','foreign')`, [foreignStream, foreignCompany]);
  }, foreignCompany, true);
}, 60_000);
afterAll(async () => { await pg.close(); });

it('RLS: empresa, sucursal, propiedad y ausencia de actor', async () => {
  const people = () => pg.query<{ user_id: string }>('SELECT user_id FROM vacation_history_streams ORDER BY user_id').then(result => result.rows.map(row => row.user_id));
  expect(await actor('admin', people)).toEqual(['peer', 'sibling', 'worker']);
  expect(await actor('manager', people)).toEqual(['peer', 'worker']);
  expect(await actor('worker', people)).toEqual(['worker']);
  expect(await actor('', people)).toEqual([]);
});
it('solo administración concede créditos; sin acceso al catálogo ni a la secuencia', async () => {
  for (const id of ['worker', 'manager', 'readonly']) await actor(id, async () => {
    await expect(event()).rejects.toMatchObject({ code: '42501' });
  });
  await actor('admin', async () => { await expect(pg.exec('SELECT * FROM users')).rejects.toMatchObject({ code: '42501' }); });
  await actor('admin', async () => { await expect(pg.exec("SELECT nextval('vacation_history_record_version_seq')")).rejects.toMatchObject({ code: '42501' }); });
});
it('la base impone fecha y versión de registro, sin aceptar retrofechado por el caller', async () => {
  await actor('admin', async () => {
    const saved = await event();
    expect(BigInt(String(saved.record_version))).toBeGreaterThan(0n);
    expect(new Date(String(saved.recorded_at)).getUTCFullYear()).toBeGreaterThan(2020);
  });
});
it('una corrección crea sucesor y bloquea escritura en la historia anterior', async () => {
  await actor('admin', async () => {
    await opening(randomUUID(), 'worker', stream);
    await expect(event()).rejects.toMatchObject({ code: '23514' });
  });
});
it('no aprueba el empleado ni se enlazan solicitudes ajenas o reversas de otro tipo', async () => {
  await actor('worker', async () => { await expect(event('APPROVE_REQUEST', { requestId })).rejects.toMatchObject({ code: '42501' }); });
  await actor('manager', async () => { await expect(event('APPROVE_REQUEST', { requestId: foreignRequestId })).rejects.toMatchObject({ code: '23514' }); });
  await actor('admin', async () => {
    const grant = await event();
    await expect(event('CANCEL_REQUEST', { requestId, reversalId: String(grant.id) })).rejects.toMatchObject({ code: '23514' });
  });
});
it('el propietario tampoco actualiza, elimina ni trunca hechos publicados', async () => {
  for (const statement of ["UPDATE vacation_history_streams SET reason='changed'", 'DELETE FROM vacation_history_streams', 'TRUNCATE vacation_history_events']) {
    await pg.exec('BEGIN');
    try { await expect(pg.exec(statement)).rejects.toMatchObject({ code: '23514' }); }
    finally { await pg.exec('ROLLBACK'); }
  }
});

it('conserva aprobación y cancelación propia enlazadas, sin doble reversa', async () => {
  await actor('manager', async () => {
    const approval = await event('APPROVE_REQUEST', { requestId });
    await pg.exec('RESET ROLE');
    await pg.query("UPDATE vacation_requests SET status='CANCELLED',cancelled_at=now() WHERE id=$1", [requestId]);
    await pg.query("SELECT set_config('app.current_actor_id','worker',true)");
    await pg.exec('SET LOCAL ROLE pulso_vacations_app');
    const cancellation = await event('CANCEL_REQUEST', { requestId, reversalId: String(approval.id) });
    expect(cancellation.actor_id).toBe('worker');
    expect(BigInt(String(cancellation.record_version))).toBeGreaterThan(BigInt(String(approval.record_version)));
    await expect(event('CANCEL_REQUEST', { requestId, reversalId: String(approval.id) })).rejects.toMatchObject({ code: '23505' });
  });
});

it('revoca un crédito una sola vez y conserva ambos hechos', async () => {
  await actor('admin', async () => {
    const grant = await event();
    const reversal = await event('REVOKE_GRANT', { reversalId: String(grant.id) });
    expect(reversal.reverses_event_id).toBe(grant.id);
    expect(BigInt(String(reversal.record_version))).toBeGreaterThan(BigInt(String(grant.record_version)));
    await expect(event('REVOKE_GRANT', { reversalId: String(grant.id) })).rejects.toMatchObject({ code: '23505' });
  });
});
it('no permite atribuir la apertura a otro actor ni cruzar la identidad del stream', async () => {
  await actor('admin', async () => {
    await expect(pg.query(`INSERT INTO vacation_history_streams(company_id,user_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
      VALUES ($1,'worker','2026-01-01','2026-12-31','source','reason','worker','forged')`, [company])).rejects.toMatchObject({ code: '42501' });
  });
  await actor('admin', async () => { await expect(event('GRANT', { streamId: foreignStream })).rejects.toMatchObject({ code: '23514' }); });
});
it('extiende cobertura sin reducirla, conserva la apertura y rechaza fechas anteriores', async () => {
  const coverage = (through: string) => pg.query(`INSERT INTO vacation_history_events(stream_id,company_id,user_id,kind,valid_from,valid_through,source_reference,reason,actor_id,idempotency_key)
    VALUES ($1,$2,'worker','COVERAGE','2026-01-01',$3,'source','reason','admin',$4)`, [stream, company, through, randomUUID()]);
  await actor('admin', async () => { await coverage('2027-12-31'); await expect(coverage('2026-12-31')).rejects.toMatchObject({ code: '23514' }); });
  await actor('admin', async () => {
    await expect(pg.query(`INSERT INTO vacation_history_events(stream_id,company_id,user_id,kind,valid_from,valid_through,days,source_reference,reason,actor_id,idempotency_key)
      VALUES ($1,$2,'worker','GRANT','2025-01-01','2026-12-31',12,'source','reason','admin','old')`, [stream, company])).rejects.toMatchObject({ code: '23514' });
  });
});
it('el puente de permisos admite VACATION de la empresa, no otros tipos', async () => {
  await pg.exec('BEGIN');
  try {
    const typeId = randomUUID(), leaveId = randomUUID();
    await pg.query("INSERT INTO leave_types VALUES ($1,$2,'VACATION')", [typeId, company]);
    await pg.query("INSERT INTO leave_requests VALUES ($1,'worker',$2,$3,$4,'2026-05-01','2026-05-02',2,'APPROVED','manager',now())", [leaveId, company, branch, typeId]);
    await pg.query("SELECT set_config('app.current_company_id',$1,true),set_config('app.current_actor_id','manager',true)", [company]);
    await pg.exec('SET LOCAL ROLE pulso_vacations_app');
    const saved = await pg.query(`INSERT INTO vacation_history_events(stream_id,company_id,user_id,kind,valid_from,valid_through,days,leave_request_id,source_reference,reason,actor_id,idempotency_key)
      VALUES ($1,$2,'worker','APPROVE_REQUEST','2026-05-01','2026-05-02',2,$3,'source','reason','manager','leave') RETURNING id`, [stream, company, leaveId]);
    expect(saved.rows).toHaveLength(1);
    await pg.exec('RESET ROLE');
    await pg.query("UPDATE leave_types SET name='SICK_LEAVE' WHERE id=$1", [typeId]);
    await pg.exec('SET LOCAL ROLE pulso_vacations_app');
    await expect(pg.query(`INSERT INTO vacation_history_events(stream_id,company_id,user_id,kind,valid_from,valid_through,days,leave_request_id,source_reference,reason,actor_id,idempotency_key)
      VALUES ($1,$2,'worker','APPROVE_REQUEST','2026-05-01','2026-05-02',2,$3,'source','reason','manager','wrong-type')`, [stream, company, leaveId])).rejects.toMatchObject({ code: '23514' });
  } finally { await pg.exec('ROLLBACK'); }
});
it('referencias legacy de gerente/empleado a una sucursal de otra empresa no conceden lectura del equipo', async () => {
  await pg.exec('BEGIN');
  try {
    const foreignBranch = randomUUID();
    await pg.query('INSERT INTO branches VALUES ($1,$2)', [foreignBranch, foreignCompany]);
    await pg.query("UPDATE users SET branch_id=$1 WHERE id IN ('manager','worker')", [foreignBranch]);
    await pg.query("SELECT set_config('app.current_company_id',$1,true),set_config('app.current_actor_id','manager',true)", [company]);
    await pg.exec('SET LOCAL ROLE pulso_vacations_app');
    expect((await pg.query('SELECT user_id FROM vacation_history_streams')).rows).toEqual([]);
  } finally { await pg.exec('ROLLBACK'); }
});
