import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  branches,
  companies,
  dailySalesCuts,
  domainEvents,
  exceptions,
  incidents,
} from "@/lib/db/schema";
import {
  runExceptionAdapters,
  type AdapterOutcome,
} from "@/lib/services/exception-adapters";
import {
  GroupExceptionsService,
  LEGACY_SUBJECT_TYPES,
  type GroupException,
} from "@/lib/services/group-exceptions-service";

/**
 * La ruta V3 se importa después de los mocks de sesión: el handler resuelve
 * `auth.api.getSession` y `next/headers` en cada request.
 */
const currentActor = vi.hoisted(() => ({
  user: {
    id: "",
    role: "ADMIN" as string,
    companyId: "",
    branchId: null as string | null,
    email: "exc02@test.local",
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: currentActor.user })),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import { GET as getGroupExceptions } from "@/app/api/group/exceptions/route";

/**
 * EXC-02 — sync legacy → canónico sobre Postgres real (V2).
 *
 * Certifica el criterio del plan:
 *   (1) repetir el sync no duplica filas canónicas ni cambia sus identidades;
 *   (2) los conteos e identidades del feed legacy coinciden con la proyección
 *       canónica de los mismos sujetos;
 *   (3) el flag `EXCEPTIONS_CANONICAL_READ` es reversible: apagado lee el
 *       dominio, encendido lee `exceptions`, y la tabla no cambia entre ambos;
 *   (4) el feed legacy declara `canonical` cuando el sujeto ya está proyectado
 *       y lo omite cuando el sync todavía no lo alcanzó.
 *
 * Base aislada (`.env.test`). El rol dueño conserva el bypass de RLS: aquí se
 * certifica el sync, no el aislamiento (eso es EXC-01/EXC-01.rls).
 */

const companyId = randomUUID();
const branchId = randomUUID();
const incidentIds = [randomUUID(), randomUUID()];
const cutId = randomUUID();

const identity = (row: { subjectType: string; subjectId: string }) =>
  `${row.subjectType}:${row.subjectId}`;

async function seedLegacy(): Promise<void> {
  await db.insert(incidents).values([
    {
      id: incidentIds[0],
      instanceId: randomUUID(),
      stepId: "exc02-temperatura",
      branchId,
      severity: "WARNING",
      status: "DETECTED",
      title: "Cámara fría fuera de rango",
      description: "Lectura de temperatura por encima del límite NOM-251",
    },
    {
      id: incidentIds[1],
      instanceId: randomUUID(),
      stepId: "exc02-caja",
      branchId,
      severity: "HIGH",
      status: "DETECTED",
      title: "Faltante de caja en arqueo",
      description: "Caja con descuadre en turno matutino",
    },
  ]);

  await db.insert(dailySalesCuts).values({
    id: cutId,
    companyId,
    branchId,
    businessDate: "2026-11-15",
    shift: "MATUTINO",
    source: "MANUAL_FORM",
    totalSales: 100_000,
    cashSales: 50_000,
    cashCountedCents: 30_000,
  });
}

async function clearLegacy(): Promise<void> {
  await db.delete(exceptions).where(eq(exceptions.companyId, companyId));
  await db.delete(incidents).where(eq(incidents.branchId, branchId));
  await db.delete(dailySalesCuts).where(eq(dailySalesCuts.companyId, companyId));
}

/**
 * `ExceptionService.raise` emite `EXCEPTION_RAISED` de forma asíncrona
 * (fire-and-forget) y esos eventos referencian la sucursal: hay que retirarlos
 * antes de borrar `branches`.
 */
async function clearDomainEvents(): Promise<void> {
  await db.delete(domainEvents).where(eq(domainEvents.branchId, branchId));
}

async function canonicalRows() {
  return db
    .select({
      id: exceptions.id,
      subjectType: exceptions.subjectType,
      subjectId: exceptions.subjectId,
      status: exceptions.status,
      ownerId: exceptions.ownerId,
      slaDueAt: exceptions.slaDueAt,
    })
    .from(exceptions)
    .where(eq(exceptions.companyId, companyId));
}

async function sync(): Promise<AdapterOutcome[]> {
  return runExceptionAdapters({ companyId });
}

async function legacyFeed(): Promise<GroupException[]> {
  return GroupExceptionsService.listOpen(companyId);
}

describe("EXC-02 — sync legacy → canónico sobre base real", () => {
  beforeAll(async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    expect(testUrl).toBeDefined();

    const host = new URL(testUrl!).hostname.replace(/-pooler(?=\.)/, "");
    expect(host).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");

    if (existsSync(".env")) {
      const operational = parse(readFileSync(".env")).DATABASE_URL;
      if (operational) {
        expect(new URL(operational).hostname.replace(/-pooler(?=\.)/, "")).not.toBe(host);
      }
    }

    await db.insert(companies).values({
      id: companyId,
      name: `Empresa EXC-02 ${companyId.slice(0, 8)}`,
    });
    await db.insert(branches).values({
      id: branchId,
      companyId,
      name: "Sucursal EXC-02",
    });

    // Sesión que consume `withTenantAuth`: ADMIN sin sucursal ve todo el grupo.
    currentActor.user.id = randomUUID();
    currentActor.user.companyId = companyId;
  });

  beforeEach(async () => {
    await clearLegacy();
    await seedLegacy();
  });

  afterEach(() => {
    delete process.env.EXCEPTIONS_CANONICAL_READ;
  });

  afterAll(async () => {
    await clearLegacy();
    await clearDomainEvents();
    await db.delete(branches).where(eq(branches.id, branchId));
    await db.delete(companies).where(eq(companies.id, companyId));
  });

  it("repetir el sync no duplica ni cambia identidades", async () => {
    const first = await sync();
    const afterFirst = await canonicalRows();

    const second = await sync();
    const afterSecond = await canonicalRows();

    expect(afterFirst.map(identity).sort()).toEqual([
      `incident:${incidentIds[0]}`,
      `incident:${incidentIds[1]}`,
      `cash_variance:${cutId}`,
    ].sort());
    expect(afterSecond.map(identity).sort()).toEqual(afterFirst.map(identity).sort());
    expect(afterSecond.map((row) => row.id).sort()).toEqual(
      afterFirst.map((row) => row.id).sort(),
    );

    // Los adaptadores vuelven a recorrer las mismas filas de dominio…
    expect(first.find((o) => o.adapter === "incident")?.raised).toBe(2);
    expect(second.find((o) => o.adapter === "incident")?.raised).toBe(2);
    // …sin crear excepciones nuevas ni errores.
    expect(second.every((outcome) => !outcome.error)).toBe(true);
    expect(afterSecond).toHaveLength(3);
  });

  it("el feed legacy declara el estado canónico cuando existe", async () => {
    await sync();
    const canonical = await canonicalRows();
    const incidentCanonical = canonical.find(
      (row) => row.subjectType === "incident" && row.subjectId === incidentIds[0],
    );
    const cutCanonical = canonical.find(
      (row) => row.subjectType === "cash_variance" && row.subjectId === cutId,
    );

    const feed = await legacyFeed();
    const incidentRow = feed.find(
      (row) => row.sourceTable === "incidents" && row.id === incidentIds[0],
    );
    const cutRow = feed.find(
      (row) => row.sourceTable === "daily_sales_cuts" && row.id === cutId,
    );

    expect(incidentRow?.canonical).toEqual({
      id: incidentCanonical!.id,
      status: "OPEN",
      ownerId: incidentCanonical!.ownerId,
      slaDueAt: incidentCanonical!.slaDueAt,
    });
    expect(cutRow?.canonical).toEqual({
      id: cutCanonical!.id,
      status: "OPEN",
      ownerId: cutCanonical!.ownerId,
      slaDueAt: cutCanonical!.slaDueAt,
    });

    // La fila sigue siendo legacy: su id y su estado son los del dominio.
    expect(incidentRow?.id).toBe(incidentIds[0]);
    expect(incidentRow?.status).toBe("DETECTED");
    expect(incidentRow?.lifecycle).toBeUndefined();
  });

  it("omite canonical cuando el sync todavía no alcanzó el sujeto", async () => {
    await sync();

    const lateIncident = randomUUID();
    await db.insert(incidents).values({
      id: lateIncident,
      instanceId: randomUUID(),
      stepId: "exc02-late",
      branchId,
      severity: "CRITICAL",
      status: "DETECTED",
      title: "Incidente posterior al sync",
    });

    const feed = await legacyFeed();
    const lateRow = feed.find((row) => row.id === lateIncident);
    expect(lateRow).toBeDefined();
    expect(lateRow?.canonical).toBeUndefined();

    // Tras el siguiente sync sí queda declarado, sin duplicar al anterior.
    await sync();
    const afterSync = (await legacyFeed()).find((row) => row.id === lateIncident);
    expect(afterSync?.canonical?.status).toBe("OPEN");
    expect(await canonicalRows()).toHaveLength(4);
  });

  it("conteos e identidades coinciden entre el feed legacy y el canónico", async () => {
    await sync();

    const feed = await legacyFeed();
    const legacyIdentities = feed
      .map((row) => {
        const subjectType = LEGACY_SUBJECT_TYPES[row.sourceTable];
        return subjectType ? `${subjectType}:${row.id}` : null;
      })
      .filter((value): value is string => Boolean(value))
      .sort();

    const projections = (await canonicalRows())
      .map(identity)
      .sort();

    expect(legacyIdentities).toEqual(projections);
    expect(feed.every((row) => row.canonical)).toBe(true);
  });

  it("la bandera de lectura es reversible y no muta la proyección", async () => {
    await sync();
    const before = await canonicalRows();

    process.env.EXCEPTIONS_CANONICAL_READ = "true";
    const canonicalFeed = await legacyFeed();
    expect(canonicalFeed.every((row) => Boolean(row.lifecycle))).toBe(true);
    expect(canonicalFeed.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );

    process.env.EXCEPTIONS_CANONICAL_READ = "false";
    const legacyFeedRows = await legacyFeed();
    expect(legacyFeedRows.every((row) => row.lifecycle === undefined)).toBe(true);
    expect(legacyFeedRows.map((row) => row.canonical?.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );

    // Apagar y encender el flag no escribe en `exceptions`.
    expect(await canonicalRows()).toHaveLength(before.length);
  });

  it("la ruta V3 declara el estado canónico sin sustituir la fila legacy", async () => {
    await sync();

    const res = await getGroupExceptions(
      new Request("http://localhost/api/group/exceptions"),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: GroupException[];
    };
    expect(body.success).toBe(true);

    const incidentRow = body.data.find(
      (row) => row.sourceTable === "incidents" && row.id === incidentIds[0],
    );
    expect(incidentRow).toBeDefined();
    // El estado que consume la UI legacy sigue siendo el del dominio…
    expect(incidentRow?.status).toBe("DETECTED");
    expect(incidentRow?.lifecycle).toBeUndefined();
    // …y el estado canónico viaja declarado, no inventado por la ruta.
    expect(incidentRow?.canonical?.status).toBe("OPEN");
    expect(incidentRow?.canonical?.id).toBeTruthy();

    // La ruta nunca proyecta: la tabla canónica no cambió por leerla.
    expect(await canonicalRows()).toHaveLength(3);
  });
});
