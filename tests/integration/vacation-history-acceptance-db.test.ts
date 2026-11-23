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
    user: { id: "", role: "ADMIN", companyId: "", branchId: null as string | null },
  },
}));

vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@/lib/services/notification-dispatcher", () => ({
  NotificationDispatcher: { sendNotification: async () => ({ success: true }) },
}));

import { POST as APPROVE_VACATION } from "@/app/api/vacations/approve/route";
import { DELETE as CANCEL_VACATION } from "@/app/api/vacations/route";
import { createLeaveRequest, decideLeaveRequest } from "@/lib/services/leave-request-service";
import { resolveVacationsForPeriod } from "@/lib/services/payroll-service";
import { grantVacationHistoryDays, openVacationHistoryStream } from "@/lib/services/vacation-history-grants-service";

let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let ownerPool: Pool | undefined;
let previousDatabaseUrl: string | undefined;
let previousRuntimeUrl: string | undefined;

const companyA = randomUUID();
const companyB = randomUUID();
const branchA1 = randomUUID();
const branchA2 = randomUUID();
const adminA = randomUUID();
const managerA1 = randomUUID();
const workerA1 = randomUUID();
const workerA2 = randomUUID();
const adminB = randomUUID();
const workerB1 = randomUUID();
const vacTypeA = randomUUID();
const vacReqA1 = randomUUID();

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

  await fixture.owner.insert(schema.companies).values([
    { id: companyA, name: "Acceptance Co A" },
    { id: companyB, name: "Acceptance Co B" },
  ]);
  await fixture.owner.insert(schema.branches).values([
    { id: branchA1, companyId: companyA, name: "A-1" },
    { id: branchA2, companyId: companyA, name: "A-2" },
  ]);
  await fixture.owner.insert(schema.users).values([
    { id: adminA, companyId: companyA, branchId: null, role: "ADMIN" as const },
    { id: managerA1, companyId: companyA, branchId: branchA1, role: "GERENTE" as const },
    { id: workerA1, companyId: companyA, branchId: branchA1, role: "EMPLEADO" as const },
    { id: workerA2, companyId: companyA, branchId: branchA2, role: "EMPLEADO" as const },
    { id: adminB, companyId: companyB, branchId: null, role: "ADMIN" as const },
    { id: workerB1, companyId: companyB, branchId: null, role: "EMPLEADO" as const },
  ].map(u => ({
    ...u,
    name: u.id,
    email: `${u.id}@acceptance.invalid`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })));

  await fixture.owner.insert(schema.leaveTypes).values({
    id: vacTypeA,
    companyId: companyA,
    name: "VACATION",
    isActive: true,
  });
  await fixture.owner.insert(schema.leaveBalances).values({
    userId: workerA1,
    leaveTypeId: vacTypeA,
    year: 2026,
    totalEntitlement: 10,
    used: 0,
    pending: 0,
    balance: 10,
  });
  // workerA2 tiene saldo mutable generoso pero SIN apertura verificada
  await fixture.owner.insert(schema.vacationAccruals).values({
    userId: workerA2,
    companyId: companyA,
    year: 2026,
    periodStart: new Date("2026-01-01T00:00:00Z"),
    periodEnd: new Date("2026-12-31T00:00:00Z"),
    yearsOfService: 5,
    applicableLawDays: 30,
    daysAccrued: 30,
    daysTaken: 0,
    daysBalance: 30,
  });
  await fixture.owner.insert(schema.vacationRequests).values({
    id: vacReqA1,
    userId: workerA1,
    companyId: companyA,
    branchId: branchA1,
    startDate: new Date("2026-05-05T00:00:00Z"),
    endDate: new Date("2026-05-07T00:00:00Z"),
    totalDays: 3,
    status: "PENDING",
  });

  ownerPool = new Pool({ connectionString: fixture.ownerUrl, max: 4, connectionTimeoutMillis: 10_000 });
  ownerPool.on("error", () => console.error("[vacation-history-acceptance-test] owner pool error"));
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

it("recorrido integrado: dos empresas, LOGIN mínimo, grants + vacaciones + leave + nómina al corte y corrección", async () => {
  // 1. Aperturas y créditos en dos empresas independientes bajo LOGIN mínimo
  const { stream: streamA1 } = await openVacationHistoryStream(
    { userId: adminA, companyId: companyA },
    {
      userId: workerA1,
      coverageFrom: "2026-01-01",
      coverageThrough: "2026-12-31",
      sourceReference: "acc-open-a1",
      reason: "Apertura verificada A1",
      idempotencyKey: "acc-open-a1",
    },
  );
  await grantVacationHistoryDays(
    { userId: adminA, companyId: companyA },
    {
      streamId: streamA1.id,
      days: 10,
      validFrom: "2026-01-01",
      validThrough: "2026-12-31",
      sourceReference: "acc-grant-a1",
      reason: "Crédito anual A1",
      idempotencyKey: "acc-grant-a1",
    },
  );
  const { stream: streamB1 } = await openVacationHistoryStream(
    { userId: adminB, companyId: companyB },
    {
      userId: workerB1,
      coverageFrom: "2026-01-01",
      coverageThrough: "2026-12-31",
      sourceReference: "acc-open-b1",
      reason: "Apertura verificada B1",
      idempotencyKey: "acc-open-b1",
    },
  );
  await grantVacationHistoryDays(
    { userId: adminB, companyId: companyB },
    {
      streamId: streamB1.id,
      days: 5,
      validFrom: "2026-01-01",
      validThrough: "2026-12-31",
      sourceReference: "acc-grant-b1",
      reason: "Crédito anual B1",
      idempotencyKey: "acc-grant-b1",
    },
  );

  // 2. Aprobación atómica de vacation_request (3 días: 5-7 mayo) bajo LOGIN mínimo
  state.session.user = { id: managerA1, role: "GERENTE", companyId: companyA, branchId: branchA1 };
  const approveVacRes = await APPROVE_VACATION(new NextRequest("http://localhost/api/vacations/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: vacReqA1, action: "APPROVED", managerComments: "Aprobado A1" }),
  }));
  expect(approveVacRes.status).toBe(200);

  // 3. Alta y aprobación atómica de leave_request VACATION (2 días: 12-13 mayo)
  const leaveCreated = await createLeaveRequest(
    { userId: workerA1, companyId: companyA },
    { leaveTypeId: vacTypeA, startDate: "2026-05-12", endDate: "2026-05-13", reason: "Permiso vacaciones" },
  );
  await decideLeaveRequest({ userId: managerA1, companyId: companyA }, leaveCreated.id, "approve", {});

  // 4. Lectura de nómina al corte bajo LOGIN mínimo (sin dbInstance -> usa withVacationHistoryTransaction)
  const payrollBefore = await resolveVacationsForPeriod({
    userId: workerA1,
    companyId: companyA,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: adminA,
  });
  expect(payrollBefore.vacationSource).toBe("VERIFIED_HISTORY");
  expect(payrollBefore.vacationBalanceStatus).toBe("AVAILABLE");
  expect(payrollBefore.vacationDaysTaken).toBe(5);
  expect(payrollBefore.vacationDaysEligible).toBe(5);
  expect(payrollBefore.vacationDaysExceeded).toBe(0);
  expect(payrollBefore.vacationAvailableBalance).toBe(10);
  expect(payrollBefore.vacationRemainingBalance).toBe(5);
  expect(payrollBefore.vacationBasePayCents).toBe(500_000);
  expect(payrollBefore.vacationPrimeCents).toBe(125_000);
  expect(payrollBefore.historyManifest?.streamId).toBe(streamA1.id);

  // 5. Cancelación y corrección posterior (stream sucesor)
  state.session.user = { id: workerA1, role: "EMPLEADO", companyId: companyA, branchId: branchA1 };
  expect((await CANCEL_VACATION(new NextRequest(`http://localhost/api/vacations?id=${vacReqA1}`, { method: "DELETE" }))).status).toBe(200);

  const { stream: streamA2 } = await openVacationHistoryStream(
    { userId: adminA, companyId: companyA },
    {
      userId: workerA1,
      predecessorId: streamA1.id,
      coverageFrom: "2026-01-01",
      coverageThrough: "2026-12-31",
      sourceReference: "acc-succ-a2",
      reason: "Corrección posterior al corte",
      idempotencyKey: "acc-succ-a2",
    },
  );
  await grantVacationHistoryDays(
    { userId: adminA, companyId: companyA },
    {
      streamId: streamA2.id,
      days: 12,
      validFrom: "2026-01-01",
      validThrough: "2026-12-31",
      sourceReference: "acc-grant-a2",
      reason: "Crédito corregido",
      idempotencyKey: "acc-grant-a2",
    },
  );

  // 6. Replay del manifiesto anterior conserva exactamente 5 días / prima 125_000
  const replayed = await resolveVacationsForPeriod({
    userId: workerA1,
    companyId: companyA,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: adminA,
    historyCutoff: {
      knownAt: payrollBefore.historyManifest!.knownAt,
      throughVersion: payrollBefore.historyManifest!.throughVersion,
    },
  });
  expect(replayed.vacationDaysEligible).toBe(5);
  expect(replayed.vacationPrimeCents).toBe(125_000);
  expect(replayed.historyManifest?.streamId).toBe(streamA1.id);

  // 7. Consulta al corte vigente usa streamA2
  const payrollAfter = await resolveVacationsForPeriod({
    userId: workerA1,
    companyId: companyA,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: adminA,
  });
  expect(payrollAfter.historyManifest?.streamId).toBe(streamA2.id);
  expect(payrollAfter.vacationAvailableBalance).toBe(12);
  expect(payrollAfter.vacationDaysTaken).toBe(0);

  // 8. Sin fallback a saldos mutables (workerA2 tiene 30 días en vacation_accruals pero sin historia)
  const noFallback = await resolveVacationsForPeriod({
    userId: workerA2,
    companyId: companyA,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: adminA,
  });
  expect(noFallback.vacationBalanceStatus).toBe("MISSING");
  expect(noFallback.historyReason).toBe("NO_COVERAGE");
  expect(noFallback.vacationPrimeCents).toBe(0);

  // 9. Aislamiento entre empresas: adminA no lee la historia de workerB1
  const crossTenant = await resolveVacationsForPeriod({
    userId: workerB1,
    companyId: companyA,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: adminA,
  });
  expect(crossTenant.vacationBalanceStatus).toBe("MISSING");
  expect(crossTenant.vacationPrimeCents).toBe(0);
}, 180_000);
