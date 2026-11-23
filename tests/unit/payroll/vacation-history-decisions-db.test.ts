import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  return {
    pg: new PGlite(),
    session: {
      user: {
        id: "manager",
        role: "GERENTE",
        companyId: "aaaaaaaa-0000-4000-8000-000000000001",
        branchId: "aaaaaaaa-0000-4000-8000-000000000011",
      },
    },
  };
});

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  return { db: drizzle(runtime.pg, { schema }) };
});
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => runtime.session } } }));
vi.mock("@/lib/services/notification-dispatcher", () => ({
  NotificationDispatcher: { sendNotification: async () => ({ success: true }) },
}));

import { POST as APPROVE } from "@/app/api/vacations/approve/route";
import { DELETE as CANCEL } from "@/app/api/vacations/route";

const company = "aaaaaaaa-0000-4000-8000-000000000001";
const foreignCompany = "bbbbbbbb-0000-4000-8000-000000000002";
const branch = "aaaaaaaa-0000-4000-8000-000000000011";
const siblingBranch = "aaaaaaaa-0000-4000-8000-000000000012";
const reqId1 = "aaaaaaaa-0000-4000-8000-000000000101";
const reqId2 = "aaaaaaaa-0000-4000-8000-000000000102";
const reqIdNoStream = "aaaaaaaa-0000-4000-8000-000000000103";
const reqIdForeign = "bbbbbbbb-0000-4000-8000-000000000104";
const streamId = "aaaaaaaa-0000-4000-8000-000000000201";

const approveReq = (body: unknown) =>
  new NextRequest("http://localhost/api/vacations/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const cancelReq = (id: string) =>
  new NextRequest(`http://localhost/api/vacations?id=${id}`, { method: "DELETE" });

const eventsFor = async (userId: string) =>
  (await runtime.pg.query("SELECT * FROM vacation_history_events WHERE user_id=$1 ORDER BY record_version", [userId])).rows;

const statusOf = async (id: string) =>
  (await runtime.pg.query("SELECT status, approved_by, cancelled_at FROM vacation_requests WHERE id=$1", [id])).rows[0];

beforeAll(async () => {
  await runtime.pg.exec(`
    CREATE TABLE companies (id uuid PRIMARY KEY, name text);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id));
    CREATE TABLE users (id text PRIMARY KEY, name text, email text, company_id uuid REFERENCES companies(id), branch_id uuid REFERENCES branches(id), role text, deleted_at timestamp);
    CREATE TABLE leave_types (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL);
    CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, title text, message text, type text, action_url text, action_label text);
    CREATE TABLE vacation_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES users(id),
      company_id uuid NOT NULL REFERENCES companies(id),
      branch_id uuid REFERENCES branches(id),
      start_date timestamp NOT NULL,
      end_date timestamp NOT NULL,
      total_days integer NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      reason text,
      manager_comments text,
      approved_by text,
      approved_at timestamp,
      rejected_by text,
      rejected_at timestamp,
      rejection_reason text,
      cancelled_at timestamp,
      requested_at timestamp DEFAULT now(),
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
    CREATE TABLE leave_requests (id uuid PRIMARY KEY, company_id uuid, user_id text, branch_id uuid, leave_type_id uuid REFERENCES leave_types(id), start_date timestamp, end_date timestamp, total_days integer, status text, approved_by text, approved_at timestamp);
  `);
  const sqlText = readFileSync("drizzle/0164_nom02c1_vacation_history.sql", "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint").filter(part => part.trim())) {
    await runtime.pg.exec(statement);
  }
});

beforeEach(async () => {
  runtime.session.user = { id: "manager", role: "GERENTE", companyId: company, branchId: branch };
  await runtime.pg.exec(`
    ALTER TABLE vacation_history_events DISABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams DISABLE TRIGGER vacation_history_stream_no_truncate;
    TRUNCATE vacation_history_events, vacation_history_streams, vacation_requests, users, branches, companies CASCADE;
    ALTER TABLE vacation_history_events ENABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams ENABLE TRIGGER vacation_history_stream_no_truncate;
  `);
  await runtime.pg.query("INSERT INTO companies VALUES ($1,'A'),($2,'B')", [company, foreignCompany]);
  await runtime.pg.query("INSERT INTO branches VALUES ($1,$2),($3,$2)", [branch, company, siblingBranch]);
  await runtime.pg.query(
    `INSERT INTO users (id,name,email,company_id,branch_id,role) VALUES
      ('admin','Admin','a@t.invalid',$1,$2,'ADMIN'),
      ('manager','Mgr','m@t.invalid',$1,$2,'GERENTE'),
      ('worker','Worker','w@t.invalid',$1,$2,'EMPLEADO'),
      ('legacy','Legacy','l@t.invalid',$1,$2,'EMPLEADO'),
      ('foreign','Foreign','f@t.invalid',$3,null,'EMPLEADO')`,
    [company, branch, foreignCompany],
  );
  // Abrir historial verificado para worker
  await runtime.pg.exec(`
    SELECT set_config('app.current_company_id', '${company}', true), set_config('app.current_actor_id', 'admin', true);
    INSERT INTO vacation_history_streams (id, company_id, user_id, coverage_from, coverage_through, source_reference, reason, actor_id, idempotency_key)
    VALUES ('${streamId}', '${company}', 'worker', '2026-01-01', '2026-12-31', 'apertura-2026', 'Apertura verificada', 'admin', 'open-worker');
  `);
  await runtime.pg.query(
    `INSERT INTO vacation_requests (id, user_id, company_id, branch_id, start_date, end_date, total_days, status) VALUES
      ($1, 'worker', $5, $6, '2026-05-10T00:00:00Z', '2026-05-12T00:00:00Z', 3, 'PENDING'),
      ($2, 'worker', $5, $6, '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z', 2, 'PENDING'),
      ($3, 'legacy', $5, $6, '2026-05-15T00:00:00Z', '2026-05-16T00:00:00Z', 2, 'PENDING'),
      ($4, 'foreign', $7, null, '2026-05-10T00:00:00Z', '2026-05-11T00:00:00Z', 2, 'PENDING')`,
    [reqId1, reqId2, reqIdNoStream, reqIdForeign, company, branch, foreignCompany],
  );
});

afterAll(async () => {
  await runtime.pg.close();
});

it("aprobar y cancelar una solicitud registra APPROVE_REQUEST y CANCEL_REQUEST atómicamente en el historial", async () => {
  const approveRes = await APPROVE(approveReq({ id: reqId1, action: "APPROVED", managerComments: "Aprobado por cobertura" }));
  expect(approveRes.status).toBe(200);
  expect((await statusOf(reqId1)).status).toBe("APPROVED");

  const afterApprove = await eventsFor("worker");
  expect(afterApprove).toHaveLength(1);
  expect(afterApprove[0]).toMatchObject({
    stream_id: streamId,
    kind: "APPROVE_REQUEST",
    days: 3,
    vacation_request_id: reqId1,
    actor_id: "manager",
    reason: "Aprobado por cobertura",
  });

  // Cancelación por el propio empleado registra CANCEL_REQUEST apuntando al evento de aprobación
  runtime.session.user = { id: "worker", role: "EMPLEADO", companyId: company, branchId: branch };
  const cancelRes = await CANCEL(cancelReq(reqId1));
  expect(cancelRes.status).toBe(200);
  expect((await statusOf(reqId1)).status).toBe("CANCELLED");

  const afterCancel = await eventsFor("worker");
  expect(afterCancel).toHaveLength(2);
  expect(afterCancel[1]).toMatchObject({
    stream_id: streamId,
    kind: "CANCEL_REQUEST",
    vacation_request_id: reqId1,
    reverses_event_id: afterApprove[0].id,
    actor_id: "worker",
  });
  expect(BigInt(String(afterCancel[1].record_version))).toBeGreaterThan(BigInt(String(afterCancel[0].record_version)));
});

it("rechazar o cancelar una solicitud PENDING no genera eventos en el historial", async () => {
  expect((await APPROVE(approveReq({ id: reqId1, action: "REJECTED", rejectionReason: "Temporada alta" }))).status).toBe(200);
  runtime.session.user = { id: "worker", role: "EMPLEADO", companyId: company, branchId: branch };
  expect((await CANCEL(cancelReq(reqId2))).status).toBe(200);
  expect(await eventsFor("worker")).toHaveLength(0);
});

it("si falla la escritura del evento de historial, la aprobación y la cancelación hacen rollback completo", async () => {
  await runtime.pg.exec(`
    CREATE FUNCTION fail_history_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic history failure'; END $$;
    CREATE TRIGGER fail_history_event_trig BEFORE INSERT ON vacation_history_events
    FOR EACH ROW EXECUTE FUNCTION fail_history_event();
  `);
  try {
    const res = await APPROVE(approveReq({ id: reqId1, action: "APPROVED" }));
    expect(res.status).toBe(500);
    expect((await statusOf(reqId1)).status).toBe("PENDING");
    expect(await eventsFor("worker")).toHaveLength(0);
  } finally {
    await runtime.pg.exec("DROP TRIGGER fail_history_event_trig ON vacation_history_events; DROP FUNCTION fail_history_event()");
  }

  // Aprobar normalmente, luego fallar el evento de cancelación -> debe seguir APPROVED
  expect((await APPROVE(approveReq({ id: reqId1, action: "APPROVED" }))).status).toBe(200);
  await runtime.pg.exec(`
    CREATE FUNCTION fail_cancel_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.kind='CANCEL_REQUEST' THEN RAISE EXCEPTION 'synthetic cancel failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_cancel_event_trig BEFORE INSERT ON vacation_history_events
    FOR EACH ROW EXECUTE FUNCTION fail_cancel_event();
  `);
  try {
    runtime.session.user = { id: "worker", role: "EMPLEADO", companyId: company, branchId: branch };
    const cancelRes = await CANCEL(cancelReq(reqId1));
    expect(cancelRes.status).toBe(500);
    expect((await statusOf(reqId1)).status).toBe("APPROVED");
    expect(await eventsFor("worker")).toHaveLength(1);
  } finally {
    await runtime.pg.exec("DROP TRIGGER fail_cancel_event_trig ON vacation_history_events; DROP FUNCTION fail_cancel_event()");
  }
});

it("sin stream abierto, aprobar/cancelar conserva compatibilidad sin inventar apertura; empresa ajena devuelve 404", async () => {
  expect((await APPROVE(approveReq({ id: reqIdNoStream, action: "APPROVED" }))).status).toBe(200);
  expect((await statusOf(reqIdNoStream)).status).toBe("APPROVED");
  expect(await eventsFor("legacy")).toHaveLength(0);

  expect((await APPROVE(approveReq({ id: reqIdForeign, action: "APPROVED" }))).status).toBe(404);
});
