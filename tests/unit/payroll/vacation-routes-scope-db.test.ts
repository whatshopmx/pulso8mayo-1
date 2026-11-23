import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const pg = new PGlite();
  return { pg, session: { user: { id: "manager", role: "GERENTE", companyId: "aaaaaaaa-0000-4000-8000-000000000001", branchId: "aaaaaaaa-0000-4000-8000-000000000011" } }, notify: vi.fn() };
});
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  return { db: drizzle(runtime.pg, { schema }) };
});
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => runtime.session } } }));
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: { sendNotification: runtime.notify } }));

import { GET, POST, DELETE } from "@/app/api/vacations/route";
import { POST as decide } from "@/app/api/vacations/approve/route";

const company = "aaaaaaaa-0000-4000-8000-000000000001";
const otherCompany = "bbbbbbbb-0000-4000-8000-000000000002";
const branch = "aaaaaaaa-0000-4000-8000-000000000011";
const otherBranch = "aaaaaaaa-0000-4000-8000-000000000012";
const foreignBranch = "bbbbbbbb-0000-4000-8000-000000000013";
const requestId = "aaaaaaaa-0000-4000-8000-000000000021";
const siblingId = "aaaaaaaa-0000-4000-8000-000000000022";
const foreignId = "bbbbbbbb-0000-4000-8000-000000000023";

beforeAll(async () => {
  await runtime.pg.exec(`
    CREATE TABLE users (id text PRIMARY KEY, company_id uuid, branch_id uuid, name text, email text, role text);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid, name text);
    CREATE TABLE vacation_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, company_id uuid NOT NULL, branch_id uuid,
      start_date timestamp NOT NULL, end_date timestamp NOT NULL, total_days integer NOT NULL, status text DEFAULT 'PENDING',
      requested_at timestamp DEFAULT now(), approved_by text, approved_at timestamp, rejected_by text, rejected_at timestamp,
      cancelled_at timestamp, reason text, manager_comments text, rejection_reason text,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );
    CREATE TABLE notifications (id uuid DEFAULT gen_random_uuid(), user_id text, title text, message text, type text,
      action_url text, action_label text, read boolean DEFAULT false, read_at timestamp, created_at timestamp DEFAULT now());
  `);
});
beforeEach(async () => {
  vi.clearAllMocks();
  runtime.session = { user: { id: "manager", role: "GERENTE", companyId: company, branchId: branch } };
  await runtime.pg.exec("TRUNCATE vacation_requests, users, branches, notifications");
  await runtime.pg.query("INSERT INTO branches VALUES ($1,$2,'A'),($3,$2,'B'),($4,$5,'Foreign')", [branch, company, otherBranch, foreignBranch, otherCompany]);
  await runtime.pg.query(`INSERT INTO users VALUES
    ('manager',$1,$2,'Manager','manager@test.invalid','GERENTE'),
    ('worker',$1,$2,'Worker','worker@test.invalid','EMPLEADO'),
    ('peer',$1,$2,'Peer','peer@test.invalid','EMPLEADO'),
    ('sibling',$1,$3,'Sibling','sibling@test.invalid','EMPLEADO'),
    ('foreign',$4,$5,'Foreign','foreign@test.invalid','EMPLEADO'),
    ('foreign-manager',$4,$5,'Other Manager','other@test.invalid','GERENTE')`, [company, branch, otherBranch, otherCompany, foreignBranch]);
  await runtime.pg.query(`INSERT INTO vacation_requests (id,user_id,company_id,branch_id,start_date,end_date,total_days)
    VALUES ($1,'worker',$2,$3,'2026-05-04','2026-05-09',6),
    ($4,'sibling',$2,$5,'2026-05-04','2026-05-09',6),
    ($6,'foreign',$7,$8,'2026-05-04','2026-05-09',6)`, [requestId, company, branch, siblingId, otherBranch, foreignId, otherCompany, foreignBranch]);
});
afterAll(async () => { await runtime.pg.close(); });

const req = (path = "", method = "GET", body?: unknown) => new NextRequest(`http://localhost/api/vacations${path}`, {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
const decision = (id = requestId) => req("/approve", "POST", { id, action: "APPROVED" });
const createBody = (userId = "worker") => ({ userId, companyId: company, branchId: branch, startDate: "2026-06-01", endDate: "2026-06-03" });
async function status(id = requestId) { return (await runtime.pg.query<{ status: string }>("SELECT status FROM vacation_requests WHERE id=$1", [id])).rows[0].status; }

it("listado del gerente solo incluye su sucursal", async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect((await res.json()).data.map((r: { id: string }) => r.id)).toEqual([requestId]);
});
it("colaborador solo lee lo propio y no puede aprobar", async () => {
  runtime.session.user.id = "worker";
  runtime.session.user.role = "EMPLEADO";
  const res = await GET(req());
  expect((await res.json()).data.map((r: { id: string }) => r.id)).toEqual([requestId]);
  expect((await decide(decision())).status).toBe(403);
  expect(await status()).toBe("PENDING");
  expect(runtime.notify).not.toHaveBeenCalled();
});
it.each([siblingId, foreignId])("gerente no decide ni cancela solicitud fuera de alcance %s", async id => {
  expect((await decide(decision(id))).status).toBe(404);
  expect((await DELETE(req(`?id=${id}`, "DELETE"))).status).toBe(404);
  expect(await status(id)).toBe("PENDING");
});
it("ADMIN sigue acotado a su empresa", async () => {
  runtime.session.user.role = "ADMIN";
  const res = await GET(req());
  expect((await res.json()).data.map((r: { id: string }) => r.id).sort()).toEqual([requestId, siblingId].sort());
  expect((await decide(decision(foreignId))).status).toBe(404);
});
it("colaborador no solicita ni cancela por otro usuario", async () => {
  runtime.session.user.id = "peer";
  runtime.session.user.role = "EMPLEADO";
  expect((await POST(req("", "POST", createBody()))).status).toBe(403);
  expect((await DELETE(req(`?id=${requestId}`, "DELETE"))).status).toBe(404);
});
it("rechaza empresa o sucursal falsificadas al crear", async () => {
  expect((await POST(req("", "POST", { ...createBody(), companyId: otherCompany }))).status).toBe(403);
  expect((await POST(req("", "POST", { ...createBody(), userId: "sibling" }))).status).toBe(404);
  expect((await POST(req("", "POST", { ...createBody(), branchId: foreignBranch }))).status).toBe(403);
});
it("rechaza fechas inválidas y JSON malformado como 400", async () => {
  expect((await POST(req("", "POST", { ...createBody(), startDate: "2026-02-30" }))).status).toBe(400);
  expect((await decide(new NextRequest("http://localhost/api/vacations/approve", { method: "POST", body: "{" }))).status).toBe(400);
});
it("dos decisiones concurrentes solo publican una transición y una notificación", async () => {
  const res = await Promise.all([decide(decision()), decide(decision())]);
  expect(res.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await status()).toBe("APPROVED");
  expect(runtime.notify).toHaveBeenCalledTimes(1);
});
it("lectura y escritura fallan cerradas sin empresa o sucursal asignada", async () => {
  runtime.session.user.companyId = "";
  expect((await GET(req())).status).toBe(403);
  expect((await decide(decision())).status).toBe(403);
  runtime.session.user.companyId = company;
  runtime.session.user.branchId = "";
  expect((await GET(req())).status).toBe(403);
});

it("colaborador crea y cancela lo propio; solo se avisa a responsables de su empresa", async () => {
  runtime.session.user.id = "worker";
  runtime.session.user.role = "EMPLEADO";
  const response = await POST(req("", "POST", createBody()));
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data).toMatchObject({ userId: "worker", companyId: company, branchId: branch, status: "PENDING", totalDays: 3 });
  const recipients = await runtime.pg.query<{ user_id: string }>("SELECT user_id FROM notifications");
  expect(recipients.rows.map(row => row.user_id)).toEqual(["manager"]);
  expect((await DELETE(req(`?id=${data.id}`, "DELETE"))).status).toBe(200);
  expect((await DELETE(req(`?id=${data.id}`, "DELETE"))).status).toBe(409);
});
it("READONLY lee su sucursal pero no crea, cancela ni decide", async () => {
  runtime.session.user.role = "READONLY";
  expect((await GET(req())).status).toBe(200);
  expect((await POST(req("", "POST", createBody()))).status).toBe(403);
  expect((await DELETE(req(`?id=${requestId}`, "DELETE"))).status).toBe(403);
  expect((await decide(decision())).status).toBe(403);
});
it("sin sesión todas las operaciones requieren autenticación", async () => {
  runtime.session.user.id = "";
  expect((await GET(req())).status).toBe(401);
  expect((await POST(req("", "POST", createBody()))).status).toBe(401);
  expect((await DELETE(req(`?id=${requestId}`, "DELETE"))).status).toBe(401);
  expect((await decide(decision())).status).toBe(401);
});
it("un rango contenido dentro de una solicitud sigue encontrándola", async () => {
  const response = await GET(req("?startDate=2026-05-06&endDate=2026-05-07"));
  expect(response.status).toBe(200);
  expect((await response.json()).data.map((row: { id: string }) => row.id)).toEqual([requestId]);
});
it("rechaza crear una solicitud que envuelve vacaciones aprobadas", async () => {
  await runtime.pg.query("UPDATE vacation_requests SET status='APPROVED' WHERE id=$1", [requestId]);
  expect((await POST(req("", "POST", { ...createBody(), startDate: "2026-05-01", endDate: "2026-05-15" }))).status).toBe(400);
});
it("rechazar conserva actor de rechazo sin afirmar que fue aprobado", async () => {
  const response = await decide(req("/approve", "POST", { id: requestId, action: "REJECTED", rejectionReason: "Sin cobertura" }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ status: "REJECTED", approvedBy: null, approvedAt: null, rejectedBy: "manager", rejectionReason: "Sin cobertura" });
});
it("una solicitud legacy con empleado de otra empresa no se muestra ni se decide", async () => {
  await runtime.pg.query("UPDATE vacation_requests SET user_id='foreign' WHERE id=$1", [requestId]);
  expect((await GET(req()).then(response => response.json())).data).toEqual([]);
  expect((await decide(decision())).status).toBe(404);
  expect(runtime.notify).not.toHaveBeenCalled();
});
it("crear no acepta una sucursal ajena heredada del perfil del empleado", async () => {
  runtime.session.user.role = "ADMIN";
  await runtime.pg.query("UPDATE users SET branch_id=$1 WHERE id='worker'", [foreignBranch]);
  const body = { ...createBody(), branchId: undefined };
  expect((await POST(req("", "POST", body))).status).toBe(403);
});

it("supervisor no modifica a terceros aunque pueda leer la sucursal", async () => {
  runtime.session.user.role = "SUPERVISOR";
  expect((await GET(req())).status).toBe(200);
  expect((await POST(req("", "POST", createBody()))).status).toBe(403);
  expect((await DELETE(req(`?id=${requestId}`, "DELETE"))).status).toBe(403);
  expect((await decide(decision())).status).toBe(403);
});
it("filtros no amplían sucursal ni aceptan estados arbitrarios", async () => {
  expect((await GET(req(`?branchId=${otherBranch}`))).status).toBe(403);
  expect((await GET(req("?status=UNKNOWN"))).status).toBe(400);
  expect((await GET(req("?startDate=2026-05-01"))).status).toBe(400);
  runtime.session.user.role = "ADMIN";
  expect((await GET(req(`?branchId=${foreignBranch}`))).status).toBe(403);
});
it("una sucursal legacy de otra empresa tampoco habilita lectura ni decisión corporativa", async () => {
  runtime.session.user.role = "ADMIN";
  await runtime.pg.query("UPDATE vacation_requests SET branch_id=$1 WHERE id=$2", [foreignBranch, requestId]);
  const response = await GET(req());
  expect((await response.json()).data.map((row: { id: string }) => row.id)).toEqual([siblingId]);
  expect((await decide(decision())).status).toBe(404);
});
it("cancelaciones concurrentes no sobrescriben la transición ya publicada", async () => {
  const responses = await Promise.all([
    DELETE(req(`?id=${requestId}`, "DELETE")), DELETE(req(`?id=${requestId}`, "DELETE")),
  ]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect(await status()).toBe("CANCELLED");
});
it("crear rechaza un empleado ajeno aunque se envíe una empresa propia", async () => {
  expect((await POST(req("", "POST", createBody("foreign")))).status).toBe(404);
  const count = await runtime.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM vacation_requests");
  expect(count.rows[0].count).toBe(3);
});
