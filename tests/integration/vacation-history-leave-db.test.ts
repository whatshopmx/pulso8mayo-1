import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSalesRuntimeDatabase } from "./helpers/sales-runtime-database";

const state = vi.hoisted(() => ({
  db: undefined as unknown as typeof import("@/lib/db").db,
}));

vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));

import { cancelLeaveRequest, createLeaveRequest, decideLeaveRequest } from "@/lib/services/leave-request-service";
import { openVacationHistoryStream } from "@/lib/services/vacation-history-grants-service";

let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let ownerPool: Pool | undefined;
let previousDatabaseUrl: string | undefined;
let previousRuntimeUrl: string | undefined;

const company = randomUUID();
const branch = randomUUID();
const vacType = randomUUID();
const admin = randomUUID();
const manager = randomUUID();
const worker = randomUUID();

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

  await fixture.owner.insert(schema.companies).values({ id: company, name: "Synthetic leave history A" });
  await fixture.owner.insert(schema.branches).values({ id: branch, companyId: company, name: "B1" });
  await fixture.owner.insert(schema.users).values([
    { id: admin, companyId: company, branchId: null, role: "ADMIN" as const },
    { id: manager, companyId: company, branchId: branch, role: "GERENTE" as const },
    { id: worker, companyId: company, branchId: branch, role: "EMPLEADO" as const },
  ].map(u => ({
    ...u,
    name: u.id,
    email: `${u.id}@leave-history.invalid`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })));
  await fixture.owner.insert(schema.leaveTypes).values({ id: vacType, companyId: company, name: "VACATION", isActive: true });
  await fixture.owner.insert(schema.leaveBalances).values({
    userId: worker,
    leaveTypeId: vacType,
    year: 2027,
    totalEntitlement: 12,
    used: 0,
    pending: 0,
    balance: 12,
  });

  ownerPool = new Pool({ connectionString: fixture.ownerUrl, max: 4, connectionTimeoutMillis: 10_000 });
  ownerPool.on("error", () => console.error("[vacation-history-leave-test] owner pool error"));
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

it("puente VACATION nativo: carrera de aprobación (1 gana / 1 recibe 409), saldo y reversa atómica", async () => {
  const { stream } = await openVacationHistoryStream(
    { userId: admin, companyId: company },
    {
      userId: worker,
      coverageFrom: "2026-01-01",
      coverageThrough: "2027-12-31",
      sourceReference: "native-leave-open",
      reason: "Apertura verificada puente leave",
      idempotencyKey: "open-leave-native",
    },
  );

  const created = await createLeaveRequest(
    { userId: worker, companyId: company },
    { leaveTypeId: vacType, startDate: "2027-06-10", endDate: "2027-06-12", reason: "Vacaciones nativas" },
  );
  expect(created.totalDays).toBe(3);

  // Dos aprobaciones concurrentes: exactamente 1 gana y 1 falla con 409
  const raced = await Promise.allSettled([
    decideLeaveRequest({ userId: manager, companyId: company }, created.id, "approve", {}),
    decideLeaveRequest({ userId: admin, companyId: company }, created.id, "approve", {}),
  ]);
  expect(raced.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const loser = raced.find(r => r.status === "rejected");
  expect(loser?.status === "rejected" && (loser.reason as { statusCode?: number }).statusCode).toBe(409);

  const approvedEvents = (await fixture!.owner.execute(sql`
    SELECT id, kind, leave_request_id, days FROM vacation_history_events WHERE stream_id=${stream.id} ORDER BY record_version
  `)).rows;
  expect(approvedEvents).toHaveLength(1);
  expect(approvedEvents[0]).toMatchObject({ kind: "APPROVE_REQUEST", leave_request_id: created.id, days: 3 });

  // Cancelar la solicitud aprobada restaura el saldo y registra CANCEL_REQUEST
  await cancelLeaveRequest({ userId: worker, companyId: company }, created.id);
  const allEvents = (await fixture!.owner.execute(sql`
    SELECT kind, leave_request_id, reverses_event_id FROM vacation_history_events WHERE stream_id=${stream.id} ORDER BY record_version
  `)).rows;
  expect(allEvents).toHaveLength(2);
  expect(allEvents[1]).toMatchObject({
    kind: "CANCEL_REQUEST",
    leave_request_id: created.id,
    reverses_event_id: approvedEvents[0].id,
  });

  const bal = (await fixture!.owner.execute(sql`
    SELECT used, pending, balance FROM leave_balances WHERE user_id=${worker} AND year=2027
  `)).rows[0];
  expect(bal).toEqual({ used: 0, pending: 0, balance: 12 });
}, 120_000);
