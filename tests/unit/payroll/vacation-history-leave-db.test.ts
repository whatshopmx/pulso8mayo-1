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
        id: "worker",
        role: "EMPLEADO",
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
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { DELETE, GET, PATCH, POST } from "@/app/api/leave/requests/route";

const company = "aaaaaaaa-0000-4000-8000-000000000001";
const foreignCompany = "bbbbbbbb-0000-4000-8000-000000000002";
const branch = "aaaaaaaa-0000-4000-8000-000000000011";
const siblingBranch = "aaaaaaaa-0000-4000-8000-000000000012";
const vacType = "aaaaaaaa-0000-4000-8000-000000000021";
const sickType = "aaaaaaaa-0000-4000-8000-000000000022";
const foreignType = "bbbbbbbb-0000-4000-8000-000000000023";
const streamId = "aaaaaaaa-0000-4000-8000-000000000201";

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", query = "", body?: unknown) =>
  new NextRequest(`http://localhost/api/leave/requests${query}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

const events = async () => (await runtime.pg.query("SELECT * FROM vacation_history_events ORDER BY record_version")).rows;
const balanceFor = async (year: number, typeId = vacType) =>
  (await runtime.pg.query("SELECT total_entitlement, used, pending, balance FROM leave_balances WHERE user_id='worker' AND leave_type_id=$1 AND year=$2", [typeId, year])).rows[0];

beforeAll(async () => {
  await runtime.pg.exec(`
    CREATE TABLE companies (id uuid PRIMARY KEY, name text);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), name text);
    CREATE TABLE users (id text PRIMARY KEY, name text, image text, company_id uuid REFERENCES companies(id), branch_id uuid REFERENCES branches(id), role text, deleted_at timestamp);
    CREATE TABLE leave_types (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, is_active boolean DEFAULT true);
    CREATE TABLE leave_balances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES users(id), leave_type_id uuid NOT NULL REFERENCES leave_types(id), year integer NOT NULL, total_entitlement integer NOT NULL, used integer DEFAULT 0, pending integer DEFAULT 0, balance integer NOT NULL, updated_at timestamp DEFAULT now());
    CREATE TABLE vacation_requests (id uuid PRIMARY KEY, company_id uuid, user_id text, branch_id uuid, start_date timestamp, end_date timestamp, total_days integer, status text, approved_by text, approved_at timestamp, cancelled_at timestamp);
    CREATE TABLE leave_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES users(id),
      company_id uuid NOT NULL REFERENCES companies(id),
      branch_id uuid REFERENCES branches(id),
      leave_type_id uuid NOT NULL REFERENCES leave_types(id),
      start_date timestamp NOT NULL,
      end_date timestamp NOT NULL,
      total_days integer NOT NULL,
      reason text NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      supporting_document_id uuid,
      requested_at timestamp DEFAULT now() NOT NULL,
      approved_by text,
      approved_at timestamp,
      rejected_by text,
      rejected_at timestamp,
      rejection_reason text,
      created_by text,
      updated_by text,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    );
  `);
  const sqlText = readFileSync("drizzle/0164_nom02c1_vacation_history.sql", "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint").filter(part => part.trim())) {
    await runtime.pg.exec(statement);
  }
});

beforeEach(async () => {
  runtime.session.user = { id: "worker", role: "EMPLEADO", companyId: company, branchId: branch };
  await runtime.pg.exec(`
    ALTER TABLE vacation_history_events DISABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams DISABLE TRIGGER vacation_history_stream_no_truncate;
    TRUNCATE vacation_history_events, vacation_history_streams, leave_requests, leave_balances, leave_types, users, branches, companies CASCADE;
    ALTER TABLE vacation_history_events ENABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams ENABLE TRIGGER vacation_history_stream_no_truncate;
  `);
  await runtime.pg.query("INSERT INTO companies VALUES ($1,'A'),($2,'B')", [company, foreignCompany]);
  await runtime.pg.query("INSERT INTO branches VALUES ($1,$2,'B1'),($3,$2,'B2')", [branch, company, siblingBranch]);
  await runtime.pg.query(
    `INSERT INTO users (id,name,company_id,branch_id,role) VALUES
      ('admin','Admin',$1,$2,'ADMIN'),
      ('manager','Mgr',$1,$2,'GERENTE'),
      ('otherMgr','OtherMgr',$1,$3,'GERENTE'),
      ('supervisor','Sup',$1,$2,'SUPERVISOR'),
      ('worker','Worker',$1,$2,'EMPLEADO'),
      ('peer','Peer',$1,$2,'EMPLEADO')`,
    [company, branch, siblingBranch],
  );
  await runtime.pg.query(
    `INSERT INTO leave_types (id,company_id,name,is_active) VALUES
      ($1,$4,'VACATION',true),($2,$4,'SICK',true),($3,$5,'VACATION',true)`,
    [vacType, sickType, foreignType, company, foreignCompany],
  );
  await runtime.pg.query(
    `INSERT INTO leave_balances (user_id,leave_type_id,year,total_entitlement,used,pending,balance) VALUES
      ('worker',$1,2027,12,0,0,12),('worker',$2,2027,5,0,0,5)`,
    [vacType, sickType],
  );
  await runtime.pg.exec(`
    SELECT set_config('app.current_company_id', '${company}', true), set_config('app.current_actor_id', 'admin', true);
    INSERT INTO vacation_history_streams (id, company_id, user_id, coverage_from, coverage_through, source_reference, reason, actor_id, idempotency_key)
    VALUES ('${streamId}', '${company}', 'worker', '2026-01-01', '2027-12-31', 'apertura-leave', 'Apertura verificada', 'admin', 'open-leave');
  `);
});

afterAll(async () => {
  await runtime.pg.close();
});

it("crea permiso VACATION derivando días y año del período, aprueba con evento atómico y cancela con reversa", async () => {
  // Rechaza totalDays manipulado
  expect((await POST(req("POST", "", {
    leaveTypeId: vacType, startDate: "2027-03-10", endDate: "2027-03-12", totalDays: 1, reason: "Vacaciones",
  }))).status).toBe(400);

  // Alta válida para 2027 (no depende del reloj actual)
  const createRes = await POST(req("POST", "", {
    leaveTypeId: vacType, startDate: "2027-03-10", endDate: "2027-03-12", reason: "Vacaciones 2027",
  }));
  expect(createRes.status).toBe(201);
  const { request: created } = await createRes.json();
  expect(created.totalDays).toBe(3);
  expect(await balanceFor(2027)).toEqual({ total_entitlement: 12, used: 0, pending: 3, balance: 9 });

  // Cierra el escape de PATCH genérico sin action=approve|reject
  expect((await PATCH(req("PATCH", `?id=${created.id}`, { status: "APPROVED", totalDays: 1 }))).status).toBe(400);

  // SUPERVISOR y GERENTE de otra sucursal no pueden aprobar
  runtime.session.user = { id: "supervisor", role: "SUPERVISOR", companyId: company, branchId: branch };
  expect((await PATCH(req("PATCH", `?id=${created.id}&action=approve`, {}))).status).toBe(403);
  runtime.session.user = { id: "otherMgr", role: "GERENTE", companyId: company, branchId: siblingBranch };
  expect((await PATCH(req("PATCH", `?id=${created.id}&action=approve`, {}))).status).toBe(404);

  // GERENTE de la misma sucursal aprueba -> saldo y APPROVE_REQUEST atómicos
  runtime.session.user = { id: "manager", role: "GERENTE", companyId: company, branchId: branch };
  const approveRes = await PATCH(req("PATCH", `?id=${created.id}&action=approve`, {}));
  expect(approveRes.status).toBe(200);
  expect(await balanceFor(2027)).toEqual({ total_entitlement: 12, used: 3, pending: 0, balance: 9 });
  const afterApprove = await events();
  expect(afterApprove).toHaveLength(1);
  expect(afterApprove[0]).toMatchObject({
    kind: "APPROVE_REQUEST",
    leave_request_id: created.id,
    vacation_request_id: null,
    days: 3,
    actor_id: "manager",
  });

  // Cancelación de solicitud aprobada restaura saldo y registra CANCEL_REQUEST
  runtime.session.user = { id: "worker", role: "EMPLEADO", companyId: company, branchId: branch };
  const cancelRes = await DELETE(req("DELETE", `?id=${created.id}`));
  expect(cancelRes.status).toBe(200);
  expect(await balanceFor(2027)).toEqual({ total_entitlement: 12, used: 0, pending: 0, balance: 12 });
  const afterCancel = await events();
  expect(afterCancel).toHaveLength(2);
  expect(afterCancel[1]).toMatchObject({
    kind: "CANCEL_REQUEST",
    leave_request_id: created.id,
    reverses_event_id: afterApprove[0].id,
    actor_id: "worker",
  });
});

it("permiso SICK no escribe en historial de vacaciones y tipo ajeno es rechazado con 404", async () => {
  expect((await POST(req("POST", "", {
    leaveTypeId: foreignType, startDate: "2027-03-10", endDate: "2027-03-10", reason: "Ajeno",
  }))).status).toBe(404);

  const createRes = await POST(req("POST", "", {
    leaveTypeId: sickType, startDate: "2027-03-10", endDate: "2027-03-11", reason: "Incapacidad",
  }));
  expect(createRes.status).toBe(201);
  const { request: created } = await createRes.json();

  runtime.session.user = { id: "manager", role: "GERENTE", companyId: company, branchId: branch };
  expect((await PATCH(req("PATCH", `?id=${created.id}&action=approve`, {}))).status).toBe(200);
  expect(await events()).toHaveLength(0);
  expect(await balanceFor(2027, sickType)).toEqual({ total_entitlement: 5, used: 2, pending: 0, balance: 3 });
});

it("rollback completo si falla el registro del evento histórico al aprobar un permiso VACATION", async () => {
  const createRes = await POST(req("POST", "", {
    leaveTypeId: vacType, startDate: "2027-04-01", endDate: "2027-04-02", reason: "Rollback test",
  }));
  const { request: created } = await createRes.json();

  await runtime.pg.exec(`
    CREATE FUNCTION fail_leave_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic leave history failure'; END $$;
    CREATE TRIGGER fail_leave_history_trig BEFORE INSERT ON vacation_history_events
    FOR EACH ROW EXECUTE FUNCTION fail_leave_history();
  `);
  try {
    runtime.session.user = { id: "manager", role: "GERENTE", companyId: company, branchId: branch };
    const approveRes = await PATCH(req("PATCH", `?id=${created.id}&action=approve`, {}));
    expect(approveRes.status).toBe(500);
    const row = (await runtime.pg.query("SELECT status FROM leave_requests WHERE id=$1", [created.id])).rows[0];
    expect(row.status).toBe("PENDING");
    expect(await balanceFor(2027)).toEqual({ total_entitlement: 12, used: 0, pending: 2, balance: 10 });
    expect(await events()).toHaveLength(0);
  } finally {
    await runtime.pg.exec("DROP TRIGGER fail_leave_history_trig ON vacation_history_events; DROP FUNCTION fail_leave_history()");
  }
});

it("GET respeta alcance propio y de sucursal; rechaza empresa ajena con 403", async () => {
  await POST(req("POST", "", { leaveTypeId: vacType, startDate: "2027-05-01", endDate: "2027-05-01", reason: "Propio" }));
  expect((await GET(req("GET", `?companyId=${foreignCompany}`))).status).toBe(403);

  runtime.session.user = { id: "peer", role: "EMPLEADO", companyId: company, branchId: branch };
  expect((await GET(req("GET", "?userId=worker"))).status).toBe(404);
  const peerOwn = await (await GET(req("GET"))).json();
  expect(peerOwn.requests).toHaveLength(0);

  runtime.session.user = { id: "otherMgr", role: "GERENTE", companyId: company, branchId: siblingBranch };
  const otherBranchList = await (await GET(req("GET"))).json();
  expect(otherBranchList.requests).toHaveLength(0);
});
