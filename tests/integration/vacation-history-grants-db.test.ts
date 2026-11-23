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

vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));

import {
  extendVacationHistoryCoverage,
  getVacationHistory,
  grantVacationHistoryDays,
  openVacationHistoryStream,
  revokeVacationHistoryGrant,
} from "@/lib/services/vacation-history-grants-service";

let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let ownerPool: Pool | undefined;
let previousDatabaseUrl: string | undefined;
let previousRuntimeUrl: string | undefined;

const company = randomUUID();
const foreignCompany = randomUUID();
const branch = randomUUID();
const siblingBranch = randomUUID();
const admin = randomUUID();
const manager = randomUUID();
const worker = randomUUID();
const siblingWorker = randomUUID();
const raceWorker = randomUUID();
const foreignWorker = randomUUID();

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
    { id: company, name: "Synthetic grants A" },
    { id: foreignCompany, name: "Synthetic grants B" },
  ]);
  await fixture.owner.insert(schema.branches).values([
    { id: branch, companyId: company, name: "A1" },
    { id: siblingBranch, companyId: company, name: "A2" },
  ]);
  await fixture.owner.insert(schema.users).values([
    { id: admin, companyId: company, branchId: null, role: "ADMIN" as const },
    { id: manager, companyId: company, branchId: branch, role: "GERENTE" as const },
    { id: worker, companyId: company, branchId: branch, role: "EMPLEADO" as const },
    { id: siblingWorker, companyId: company, branchId: siblingBranch, role: "EMPLEADO" as const },
    { id: raceWorker, companyId: company, branchId: branch, role: "EMPLEADO" as const },
    { id: foreignWorker, companyId: foreignCompany, branchId: null, role: "EMPLEADO" as const },
  ].map(user => ({
    ...user,
    name: user.id,
    email: `${user.id}@grants.invalid`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })));

  ownerPool = new Pool({ connectionString: fixture.ownerUrl, max: 4, connectionTimeoutMillis: 10_000 });
  ownerPool.on("error", () => console.error("[vacation-history-grants-test] synthetic owner pool error"));
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

it("ciclo completo con LOGIN mínimo, rechazo de URI dueña (503) y aislamiento de empresa/sucursal", async () => {
  const actor = { userId: admin, companyId: company };

  // URI dueña configurada como runtime -> 503 sin efectos
  process.env.VACATIONS_RUNTIME_DATABASE_URL = fixture!.ownerUrl;
  await expect(openVacationHistoryStream(actor, {
    userId: worker,
    coverageFrom: "2026-01-01",
    coverageThrough: "2026-06-30",
    sourceReference: "source-owner-rejected",
    reason: "No debe escribir con URI dueña",
    idempotencyKey: "owner-rejected",
  })).rejects.toMatchObject({ statusCode: 503 });
  expect((await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM vacation_history_streams`)).rows[0].n).toBe(0);

  // Restaurar LOGIN mínimo dedicado
  process.env.VACATIONS_RUNTIME_DATABASE_URL = fixture!.runtimeUrl;

  const opened = await openVacationHistoryStream(actor, {
    userId: worker,
    coverageFrom: "2026-01-01",
    coverageThrough: "2026-06-30",
    sourceReference: "expediente-2026-01",
    reason: "Apertura verificada inicial",
    idempotencyKey: "open-1",
  });
  expect(opened.created).toBe(true);
  expect(BigInt(opened.stream.recordVersion)).toBeGreaterThan(0n);

  const extended = await extendVacationHistoryCoverage(actor, {
    streamId: opened.stream.id,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "corte-2026-12",
    reason: "Extensión de cobertura verificada",
    idempotencyKey: "ext-1",
  });
  expect(extended.created).toBe(true);
  expect(BigInt(extended.event.recordVersion)).toBeGreaterThan(BigInt(opened.stream.recordVersion));

  const granted = await grantVacationHistoryDays(actor, {
    streamId: opened.stream.id,
    days: 12,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "aniversario-2026",
    reason: "Crédito anual verificado",
    idempotencyKey: "grant-1",
  });
  expect(granted.created).toBe(true);

  const revoked = await revokeVacationHistoryGrant(actor, {
    streamId: opened.stream.id,
    reversesEventId: granted.event.id,
    sourceReference: "ajuste-2026",
    reason: "Revocación documentada",
    idempotencyKey: "revoke-1",
  });
  expect(revoked.created).toBe(true);

  const successor = await openVacationHistoryStream(actor, {
    userId: worker,
    predecessorId: opened.stream.id,
    coverageFrom: "2025-07-01",
    coverageThrough: "2026-12-31",
    sourceReference: "reapertura-2026",
    reason: "Corrección de apertura verificada",
    idempotencyKey: "open-succ-1",
  });
  expect(successor.created).toBe(true);

  // Stream sustituido rechaza nuevos eventos
  await expect(grantVacationHistoryDays(actor, {
    streamId: opened.stream.id,
    days: 3,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "tardio",
    reason: "Intento sobre stream sustituido",
    idempotencyKey: "grant-late",
  })).rejects.toMatchObject({ statusCode: 409 });

  // Alcance de lectura y escritura
  await expect(openVacationHistoryStream({ userId: manager, companyId: company }, {
    userId: worker,
    coverageFrom: "2026-01-01",
    coverageThrough: "2026-12-31",
    sourceReference: "gerente",
    reason: "Gerente no puede otorgar",
    idempotencyKey: "mgr-open",
  })).rejects.toMatchObject({ statusCode: 403 });

  await expect(openVacationHistoryStream(actor, {
    userId: foreignWorker,
    coverageFrom: "2026-01-01",
    coverageThrough: "2026-12-31",
    sourceReference: "ajeno",
    reason: "Colaborador de otra empresa",
    idempotencyKey: "foreign-open",
  })).rejects.toMatchObject({ statusCode: 404 });

  const managerRead = await getVacationHistory({ userId: manager, companyId: company }, { userId: worker });
  expect(managerRead.streams).toHaveLength(2);
  expect(managerRead.events).toHaveLength(3);

  await expect(getVacationHistory({ userId: manager, companyId: company }, { userId: siblingWorker }))
    .rejects.toMatchObject({ statusCode: 404 });
}, 120_000);

it("serializa aperturas concurrentes y replays idempotentes simultáneos sin duplicar hechos", async () => {
  const actor = { userId: admin, companyId: company };

  const racedOpenings = await Promise.allSettled([
    openVacationHistoryStream(actor, {
      userId: raceWorker,
      coverageFrom: "2026-01-01",
      coverageThrough: "2026-12-31",
      sourceReference: "race-1",
      reason: "Apertura concurrente 1",
      idempotencyKey: "race-open-1",
    }),
    openVacationHistoryStream(actor, {
      userId: raceWorker,
      coverageFrom: "2026-01-01",
      coverageThrough: "2026-12-31",
      sourceReference: "race-2",
      reason: "Apertura concurrente 2",
      idempotencyKey: "race-open-2",
    }),
  ]);
  expect(racedOpenings.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const rejected = racedOpenings.find(r => r.status === "rejected");
  expect(rejected?.status === "rejected" && (rejected.reason as { statusCode?: number }).statusCode).toBe(409);

  const winner = racedOpenings.find((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof openVacationHistoryStream>>> => r.status === "fulfilled")!.value.stream;

  const grantPayload = {
    streamId: winner.id,
    days: 14,
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    sourceReference: "race-grant-source",
    reason: "Crédito idempotente concurrente",
    idempotencyKey: "race-grant-same-key",
  };
  const racedGrants = await Promise.all([
    grantVacationHistoryDays(actor, grantPayload),
    grantVacationHistoryDays(actor, grantPayload),
  ]);
  expect(racedGrants.filter(r => r.created)).toHaveLength(1);
  expect(racedGrants.filter(r => !r.created)).toHaveLength(1);
  expect(racedGrants[0].event.id).toBe(racedGrants[1].event.id);
  expect((await fixture!.owner.execute(sql`SELECT count(*)::int AS n FROM vacation_history_events WHERE stream_id=${winner.id}`)).rows[0].n).toBe(1);
}, 120_000);
