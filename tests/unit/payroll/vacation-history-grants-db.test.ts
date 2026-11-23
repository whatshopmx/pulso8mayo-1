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
        id: "admin",
        role: "ADMIN",
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

import { GET, POST } from "@/app/api/vacations/history/route";

const company = "aaaaaaaa-0000-4000-8000-000000000001";
const foreignCompany = "bbbbbbbb-0000-4000-8000-000000000002";
const branch = "aaaaaaaa-0000-4000-8000-000000000011";
const siblingBranch = "aaaaaaaa-0000-4000-8000-000000000012";

const req = (method: "GET" | "POST", body?: unknown, query = "") =>
  new NextRequest(`http://localhost/api/vacations/history${query}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

const openBody = (extra: Record<string, unknown> = {}) => ({
  operation: "OPEN_STREAM",
  userId: "worker",
  coverageFrom: "2026-01-01",
  coverageThrough: "2026-06-30",
  sourceReference: "expediente-apertura-2026-001",
  reason: "Apertura verificada con corte documentado",
  idempotencyKey: "open-worker-2026-v1",
  ...extra,
});

beforeAll(async () => {
  await runtime.pg.exec(`
    CREATE TABLE companies (id uuid PRIMARY KEY, name text);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id));
    CREATE TABLE users (id text PRIMARY KEY, company_id uuid REFERENCES companies(id), branch_id uuid REFERENCES branches(id), role text, deleted_at timestamp);
    CREATE TABLE leave_types (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL);
    CREATE TABLE vacation_requests (id uuid PRIMARY KEY, company_id uuid, user_id text, branch_id uuid, start_date timestamp, end_date timestamp, total_days integer, status text, approved_by text, approved_at timestamp, cancelled_at timestamp);
    CREATE TABLE leave_requests (id uuid PRIMARY KEY, company_id uuid, user_id text, branch_id uuid, leave_type_id uuid REFERENCES leave_types(id), start_date timestamp, end_date timestamp, total_days integer, status text, approved_by text, approved_at timestamp);
  `);
  const sqlText = readFileSync("drizzle/0164_nom02c1_vacation_history.sql", "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint").filter(part => part.trim())) {
    await runtime.pg.exec(statement);
  }
});

beforeEach(async () => {
  runtime.session.user = { id: "admin", role: "ADMIN", companyId: company, branchId: branch };
  await runtime.pg.exec(`
    ALTER TABLE vacation_history_events DISABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams DISABLE TRIGGER vacation_history_stream_no_truncate;
    TRUNCATE vacation_history_events, vacation_history_streams, users, branches, companies CASCADE;
    ALTER TABLE vacation_history_events ENABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams ENABLE TRIGGER vacation_history_stream_no_truncate;
  `);
  await runtime.pg.query("INSERT INTO companies VALUES ($1,'A'),($2,'B')", [company, foreignCompany]);
  await runtime.pg.query("INSERT INTO branches VALUES ($1,$2),($3,$2)", [branch, company, siblingBranch]);
  await runtime.pg.query(
    `INSERT INTO users VALUES
      ('admin',$1,$2,'ADMIN',null),
      ('manager',$1,$2,'GERENTE',null),
      ('supervisor',$1,$2,'SUPERVISOR',null),
      ('readonly',$1,$2,'READONLY',null),
      ('worker',$1,$2,'EMPLEADO',null),
      ('peer',$1,$2,'EMPLEADO',null),
      ('sibling',$1,$3,'EMPLEADO',null),
      ('foreign',$4,null,'EMPLEADO',null)`,
    [company, branch, siblingBranch, foreignCompany],
  );
});

afterAll(async () => {
  await runtime.pg.close();
});

it("abre un stream verificado, soporta replay idempotente y rechaza colisión de payload o raíz duplicada", async () => {
  const first = await POST(req("POST", openBody()));
  expect(first.status).toBe(201);
  const firstJson = await first.json();
  expect(firstJson.created).toBe(true);
  expect(firstJson.stream).toMatchObject({
    companyId: company,
    userId: "worker",
    coverageFrom: "2026-01-01",
    coverageThrough: "2026-06-30",
    actorId: "admin",
  });
  expect(BigInt(firstJson.stream.recordVersion)).toBeGreaterThan(0n);

  const replay = await POST(req("POST", openBody()));
  expect(replay.status).toBe(200);
  const replayJson = await replay.json();
  expect(replayJson.created).toBe(false);
  expect(replayJson.stream.id).toBe(firstJson.stream.id);

  const mismatch = await POST(req("POST", openBody({ coverageThrough: "2026-12-31" })));
  expect(mismatch.status).toBe(409);

  const secondRoot = await POST(req("POST", openBody({ idempotencyKey: "open-worker-2026-v2" })));
  expect(secondRoot.status).toBe(409);
});

it("permite extender cobertura, otorgar créditos (incluso 0 días), revocarlos y sustituir el stream por sucesor", async () => {
  const openRes = await POST(req("POST", openBody()));
  const { stream } = await openRes.json();

  const extRes = await POST(req("POST", {
    operation: "EXTEND_COVERAGE",
    streamId: stream.id,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "corte-cierre-2026",
    reason: "Extensión de cobertura verificada al cierre anual",
    idempotencyKey: "ext-2026-12",
  }));
  expect(extRes.status).toBe(201);
  const extJson = await extRes.json();
  expect(BigInt(extJson.event.recordVersion)).toBeGreaterThan(BigInt(stream.recordVersion));

  // Replay idempotente
  expect((await POST(req("POST", {
    operation: "EXTEND_COVERAGE",
    streamId: stream.id,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "corte-cierre-2026",
    reason: "Extensión de cobertura verificada al cierre anual",
    idempotencyKey: "ext-2026-12",
  }))).status).toBe(200);

  // Reducir cobertura falla con 409
  expect((await POST(req("POST", {
    operation: "EXTEND_COVERAGE",
    streamId: stream.id,
    validFrom: "2026-01-01",
    validThrough: "2026-09-30",
    sourceReference: "corte-invalido",
    reason: "Intento de recorte de cobertura",
    idempotencyKey: "ext-shrink",
  }))).status).toBe(409);

  // Crédito anterior a coverageFrom falla con 409
  expect((await POST(req("POST", {
    operation: "GRANT",
    streamId: stream.id,
    days: 12,
    validFrom: "2025-12-01",
    validThrough: "2026-12-31",
    sourceReference: "credito-previo",
    reason: "Crédito anterior a la apertura",
    idempotencyKey: "grant-before",
  }))).status).toBe(409);

  // Crédito válido y crédito cero
  const grantRes = await POST(req("POST", {
    operation: "GRANT",
    streamId: stream.id,
    days: 12,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "aniversario-2026",
    reason: "Derecho anual verificado 2026",
    idempotencyKey: "grant-2026",
  }));
  expect(grantRes.status).toBe(201);
  const { event: grantEvent } = await grantRes.json();
  expect(grantEvent.days).toBe(12);

  const zeroRes = await POST(req("POST", {
    operation: "GRANT",
    streamId: stream.id,
    days: 0,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "sin-derecho-adicional",
    reason: "Constancia explícita de cero días adicionales",
    idempotencyKey: "grant-zero",
  }));
  expect(zeroRes.status).toBe(201);

  // Revocación de crédito y rechazo de doble revocación
  const revokeRes = await POST(req("POST", {
    operation: "REVOKE_GRANT",
    streamId: stream.id,
    reversesEventId: grantEvent.id,
    sourceReference: "correccion-aniversario-2026",
    reason: "Revocación documentada por ajuste de fecha",
    idempotencyKey: "revoke-2026",
  }));
  expect(revokeRes.status).toBe(201);
  expect((await POST(req("POST", {
    operation: "REVOKE_GRANT",
    streamId: stream.id,
    reversesEventId: grantEvent.id,
    sourceReference: "correccion-aniversario-2026",
    reason: "Revocación documentada por ajuste de fecha",
    idempotencyKey: "revoke-2026",
  }))).status).toBe(200);
  expect((await POST(req("POST", {
    operation: "REVOKE_GRANT",
    streamId: stream.id,
    reversesEventId: grantEvent.id,
    sourceReference: "segunda-revocacion",
    reason: "Intento de revocar dos veces",
    idempotencyKey: "revoke-2026-dup",
  }))).status).toBe(409);

  // Sucesor sustituye el stream y el anterior ya no acepta nuevos eventos
  const succRes = await POST(req("POST", openBody({
    predecessorId: stream.id,
    coverageFrom: "2025-06-01",
    coverageThrough: "2026-12-31",
    idempotencyKey: "open-worker-successor-1",
  })));
  expect(succRes.status).toBe(201);
  expect((await POST(req("POST", {
    operation: "GRANT",
    streamId: stream.id,
    days: 5,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "tardio",
    reason: "Evento sobre stream sustituido",
    idempotencyKey: "grant-after-superseded",
  }))).status).toBe(409);

  // Consulta consolidada ordenada por recordVersion
  const getRes = await GET(req("GET", undefined, "?userId=worker"));
  expect(getRes.status).toBe(200);
  const history = await getRes.json();
  expect(history.streams).toHaveLength(2);
  expect(history.events).toHaveLength(4);
});

it.each(["EMPLEADO", "GERENTE", "SUPERVISOR", "READONLY"])("rechaza mutaciones de historial al rol %s", async role => {
  await runtime.pg.query("UPDATE users SET role=$1 WHERE id='worker'", [role]);
  runtime.session.user = { id: "worker", role, companyId: company, branchId: branch };
  expect((await POST(req("POST", openBody()))).status).toBe(403);
});

it("relee autoridad real y rechaza una sesión administrativa revocada", async () => {
  await runtime.pg.exec("UPDATE users SET role='EMPLEADO' WHERE id='admin'");
  expect((await POST(req("POST", openBody()))).status).toBe(403);
});

it("aisla empresas y alcance de sucursal/propiedad en lectura y escritura", async () => {
  expect((await POST(req("POST", openBody({ userId: "foreign" })))).status).toBe(404);
  expect((await POST(req("POST", openBody()))).status).toBe(201);
  expect((await POST(req("POST", openBody({ userId: "sibling", idempotencyKey: "open-sibling" })))).status).toBe(201);

  // Empresa ajena en query -> 403
  expect((await GET(req("GET", undefined, `?companyId=${foreignCompany}&userId=worker`))).status).toBe(403);

  // GERENTE lee su sucursal, no la sucursal hermana
  runtime.session.user = { id: "manager", role: "GERENTE", companyId: company, branchId: branch };
  expect((await GET(req("GET", undefined, "?userId=worker"))).status).toBe(200);
  expect((await GET(req("GET", undefined, "?userId=sibling"))).status).toBe(404);

  // EMPLEADO lee lo propio, no al compañero
  runtime.session.user = { id: "worker", role: "EMPLEADO", companyId: company, branchId: branch };
  expect((await GET(req("GET", undefined, "?userId=worker"))).status).toBe(200);
  expect((await GET(req("GET", undefined, "?userId=peer"))).status).toBe(404);
});

it("rechaza payloads malformados o con campos prohibidos (companyId/actorId) con 400", async () => {
  expect((await POST(req("POST", openBody({ companyId: foreignCompany })))).status).toBe(400);
  expect((await POST(req("POST", openBody({ actorId: "worker" })))).status).toBe(400);
  expect((await POST(req("POST", openBody({ coverageFrom: "2026-07-01", coverageThrough: "2026-06-01" })))).status).toBe(400);
});
