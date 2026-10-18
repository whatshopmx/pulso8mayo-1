import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { branches, companies, evidence, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";

/**
 * SEC-04 (Fase 2) — RLS piloto sobre `evidence` contra base Postgres real.
 *
 * Comprueba las tres aceptaciones:
 * (1) el contexto viaja con la TRANSACCIÓN y no se filtra entre peticiones que
 *     reutilizan la misma conexión del pool;
 * (2) un rol de runtime SIN bypass no ve ni escribe sin contexto (rechazo por
 *     defecto), separado del rol dueño que sí migra;
 * (3) un job sin sesión HTTP opera con el `companyId` explícito del evento.
 *
 * Requiere `TEST_DATABASE_URL` (ver `tests/integration/setup.ts`) y permiso
 * CREATEROLE en la base aislada para provisionar `pulso_app`.
 */

neonConfig.webSocketConstructor = ws;

const RUNTIME_ROLE = "pulso_app";
const RUNTIME_PASSWORD = "test-pulso-app";

type Tenant = { companyId: string; branchId: string; userId: string };

async function seedTenant(label: string): Promise<Tenant> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `RLS ${label} ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: `Sucursal ${label}` });
  await db.insert(users).values({
    id: userId,
    name: `Usuario ${label}`,
    email: `${userId}@rls.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    companyId,
    branchId,
    role: "ADMIN",
  });

  return { companyId, branchId, userId };
}

async function insertEvidence(t: Tenant, url: string) {
  const [row] = await db
    .insert(evidence)
    .values({
      companyId: t.companyId,
      branchId: t.branchId,
      entityType: "GENERAL",
      entityId: randomUUID(),
      kind: "PHOTO",
      url,
    })
    .returning();
  return row;
}

/** URL del pool de runtime con el rol sin bypass. */
function runtimeUrl(): string {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  base.username = RUNTIME_ROLE;
  base.password = RUNTIME_PASSWORD;
  return base.toString();
}

/**
 * Provisiona el rol de runtime del piloto. No se hace en la migración para no
 * sembrar credenciales en el historial; en operación lo hace el aprovisionador
 * del entorno con la misma secuencia. Rol y contraseña son constantes de este
 * archivo (sólo base aislada), por eso `sql.raw` no interpola entrada externa.
 */
async function provisionRuntimeRole() {
  const existing = await db.execute(
    sql`SELECT 1 FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}`,
  );
  if (existing.rows.length === 0) {
    await db.execute(
      sql.raw(
        `CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${RUNTIME_PASSWORD}' NOBYPASSRLS NOSUPERUSER NOCREATEROLE`,
      ),
    );
  } else {
    await db.execute(
      sql.raw(`ALTER ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${RUNTIME_PASSWORD}'`),
    );
  }
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA "public" TO "${RUNTIME_ROLE}"`));
  await db.execute(
    sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "evidence" TO "${RUNTIME_ROLE}"`),
  );
}

// Pool max 1 a propósito: si el ajuste de sesión se filtrara, la segunda
// consulta reutilizaría la MISMA conexión y vería la empresa anterior.
const runtimePool = new Pool({ connectionString: runtimeUrl(), max: 1, allowExitOnIdle: true });
const runtime = drizzle(runtimePool, { schema });

describe("SEC-04 sobre base real: contexto de tenant y RLS en `evidence`", () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    await provisionRuntimeRole();
    a = await seedTenant("A");
    b = await seedTenant("B");
    await insertEvidence(a, "companies/rls/a.jpg");
    await insertEvidence(b, "companies/rls/b.jpg");
  }, 60_000);

  afterAll(async () => {
    await runtimePool.end();
  });

  it("la política está activa y el rol runtime no tiene bypass", async () => {
    const [{ relrowsecurity }] = (
      await db.execute(
        sql`SELECT relrowsecurity FROM pg_class WHERE relname = 'evidence'`,
      )
    ).rows as Array<{ relrowsecurity: boolean }>;
    expect(relrowsecurity).toBe(true);

    const [{ rolbypassrls, rolsuper }] = (
      await db.execute(
        sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}`,
      )
    ).rows as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
    expect(rolbypassrls).toBe(false);
    expect(rolsuper).toBe(false);
  }, 60_000);

  it("reutiliza la conexión del pool entre dos empresas sin filtrar contexto", async () => {
    const seenA = await withCompanyContext(
      { companyId: a.companyId },
      (tx) => tx.select({ companyId: evidence.companyId }).from(evidence),
      runtime,
    );
    const seenB = await withCompanyContext(
      { companyId: b.companyId },
      (tx) => tx.select({ companyId: evidence.companyId }).from(evidence),
      runtime,
    );

    expect(seenA.map((r) => r.companyId)).toEqual([a.companyId]);
    expect(seenB.map((r) => r.companyId)).toEqual([b.companyId]);
  }, 60_000);

  it("sin contexto, el rol runtime no ve ni escribe (rechazo por defecto)", async () => {
    // Lectura sin ajuste: la política compara contra NULL y no devuelve filas.
    const visible = await runtime.select({ id: evidence.id }).from(evidence);
    expect(visible).toHaveLength(0);

    // Escritura sin ajuste: WITH CHECK evalúa NULL y rechaza.
    await expect(
      runtime.insert(evidence).values({
        companyId: a.companyId,
        entityType: "GENERAL",
        entityId: randomUUID(),
        kind: "PHOTO",
        url: "companies/rls/denied.jpg",
      }),
    ).rejects.toBeTruthy();

    // El helper tampoco deja pasar una petición sin empresa.
    await expect(
      withCompanyContext({ companyId: "" }, async () => undefined, runtime),
    ).rejects.toThrow(/companyId/);
  }, 60_000);

  it("un filtro explícito por otra empresa sigue sin devolver filas", async () => {
    const cross = await withCompanyContext(
      { companyId: a.companyId },
      (tx) => tx.select({ id: evidence.id }).from(evidence).where(eq(evidence.companyId, b.companyId)),
      runtime,
    );
    expect(cross).toHaveLength(0);
  }, 60_000);

  it("un job con alcance explícito escribe y lee sólo ese tenant", async () => {
    const entityId = randomUUID();

    // Sin sesión HTTP: el `companyId` viene del evento, no de un rol privilegiado.
    await withCompanyContext(
      { companyId: b.companyId, actorId: b.userId },
      (tx) =>
        tx.insert(evidence).values({
          companyId: b.companyId,
          branchId: b.branchId,
          entityType: "DOCUMENT",
          entityId,
          kind: "FILE",
          url: "companies/rls/job.pdf",
        }),
      runtime,
    );

    const fromJob = await withCompanyContext(
      { companyId: b.companyId },
      (tx) =>
        tx
          .select({ id: evidence.id, url: evidence.url })
          .from(evidence)
          .where(eq(evidence.entityId, entityId)),
      runtime,
    );
    expect(fromJob).toHaveLength(1);
    expect(fromJob[0].url).toBe("companies/rls/job.pdf");

    // La otra empresa no puede verla aunque conozca el entityId.
    const cross = await withCompanyContext(
      { companyId: a.companyId },
      (tx) => tx.select({ id: evidence.id }).from(evidence).where(eq(evidence.entityId, entityId)),
      runtime,
    );
    expect(cross).toHaveLength(0);
  }, 60_000);
});
