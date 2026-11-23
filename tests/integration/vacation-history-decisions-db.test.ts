import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSalesRuntimeDatabase } from "./helpers/sales-runtime-database";

const state = vi.hoisted(() => ({
  db: undefined as unknown as typeof import("@/lib/db").db,
  session: {
    user: { id: "", role: "GERENTE", companyId: "", branchId: "" as string | null },
  },
}));

vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@/lib/services/notification-dispatcher", () => ({
  NotificationDispatcher: { sendNotification: async () => ({ success: true }) },
}));

import { POST as APPROVE } from "@/app/api/vacations/approve/route";
import { DELETE as CANCEL } from "@/app/api/vacations/route";
import { openVacationHistoryStream } from "@/lib/services/vacation-history-grants-service";

let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let ownerPool: Pool | undefined;
let previousDatabaseUrl: string | undefined;
let previousRuntimeUrl: string | undefined;

const company = randomUUID();
const branch = randomUUID();
const admin = randomUUID();
const manager = randomUUID();
const worker = randomUUID();
const requestId = randomUUID();

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousRuntimeUrl = process.env.VACATIONS_RUNTIME_DATABASE_URL;

  fixture = await createSalesRuntimeDatabase({ baseline: "0158", grants: "none" });
  await fixture.owner.transaction(async tx => {
    for (const file of ["0163_nom02c1_vacation_runtime.sql", "0164_nom02c1_vacation_history.sql"]) {
      for (const statement of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint").filter(part => part.trim())) {
        await tx.execute(sql.raw(statement.replaceAll("pulso_vacations_app", fixture!.roleName)));
      }
    }
  });

  await fixture.owner.insert(schema.companies).values({ id: company, name: "Synthetic decisions A" });
  await fixture.owner.insert(schema.branches).values({ id: branch, companyId: company, name: "B1" });
  await fixture.owner.insert(schema.users).values([
    { id: admin, companyId: company, branchId: null, role: "ADMIN" as const },
    { id: manager, companyId: company, branchId: branch, role: "GERENTE" as const },
    { id: worker, companyId: company, branchId: branch, role: "EMPLEADO" as const },
  ].map(u => ({
    ...u,
    name: u.id,
    email: `${u.id}@decisions.invalid`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })));

  await fixture.owner.insert(schema.vacationRequests).values({
    id: requestId,
    userId: worker,
    companyId: company,
    branchId: branch,
    startDate: new Date("2026-05-10T00:00:00Z"),
    endDate: new Date("2026-05-12T00:00:00Z"),
    totalDays: 3,
    status: "PENDING",
  });

  ownerPool = new Pool({ connectionString: fixture.ownerUrl, max: 4, connectionTimeoutMillis: 10_000 });
  ownerPool.on("error", () => console.error("[vacation-history-decisions-test] owner pool error"));
  state.db = drizzle(ownerPool, { schema });

  process.env.DATABASE_URL = fixture.ownerUrl;
  process.env.VACATIONS_RUNTIME_DATABASE_URL = fixture.runtimeUrl;
}, 180_000);

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousRuntimeUrl === undefined) delete process.env.VACATIONS_RUNTIME_DATABASE_URL;
  else process.env.VACATIONS_RUNTIME_DATABASE_URL = previousRuntimeUrl;
  try {
    await ownerPool?.end();
  } finally {
    await fixture?.close();
  }
}, 90_000);

it("LOGIN mínimo: aprobar y cancelar persisten solicitud y eventos en la misma transacción con rollback atómico", async () => {
  const { stream } = await openVacationHistoryStream(
    { userId: admin, companyId: company },
    {
      userId: worker,
      coverageFrom: "2026-01-01",
      coverageThrough: "2026-12-31",
      sourceReference: "native-decisions-open",
      reason: "Apertura verificada para decisiones",
      idempotencyKey: "open-decisions-1",
    },
  );

  state.session.user = { id: manager, role: "GERENTE", companyId: company, branchId: branch };
  const approveRes = await APPROVE(new NextRequest("http://localhost/api/vacations/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: requestId, action: "APPROVED", managerComments: "OK nativo" }),
  }));
  expect(approveRes.status).toBe(200);

  const approvedRows = (await fixture!.owner.execute(sql`
    SELECT id, kind, days, vacation_request_id, actor_id, record_version::text
    FROM vacation_history_events
    WHERE stream_id = ${stream.id}
    ORDER BY record_version
  `)).rows;
  expect(approvedRows).toHaveLength(1);
  expect(approvedRows[0]).toMatchObject({
    kind: "APPROVE_REQUEST",
    days: 3,
    vacation_request_id: requestId,
    actor_id: manager,
  });

  state.session.user = { id: worker, role: "EMPLEADO", companyId: company, branchId: branch };
  const cancelRes = await CANCEL(new NextRequest(`http://localhost/api/vacations?id=${requestId}`, { method: "DELETE" }));
  expect(cancelRes.status).toBe(200);

  const allRows = (await fixture!.owner.execute(sql`
    SELECT id, kind, vacation_request_id, reverses_event_id, actor_id, record_version::text
    FROM vacation_history_events
    WHERE stream_id = ${stream.id}
    ORDER BY record_version
  `)).rows;
  expect(allRows).toHaveLength(2);
  expect(allRows[1]).toMatchObject({
    kind: "CANCEL_REQUEST",
    vacation_request_id: requestId,
    reverses_event_id: approvedRows[0].id,
    actor_id: worker,
  });
  expect(BigInt(String(allRows[1].record_version))).toBeGreaterThan(BigInt(String(allRows[0].record_version)));
}, 120_000);
