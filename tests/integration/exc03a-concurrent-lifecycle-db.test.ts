/**
 * EXC-03.a — Verificación V2 de lifecycle concurrente en Neon PostgreSQL real.
 *
 * Comprueba sobre base real (con dos conexiones independientes para carreras reales
 * y limpieza determinista en `afterAll`):
 * 1. Dos acciones simultáneas sobre la misma excepción (`RESOLVE` vs `CANCEL` en
 *    `IN_ACTION`, y doble `VERIFY` en `RESOLVED`) se serializan mediante
 *    `pg_advisory_xact_lock` + guarda optimista `(status, updatedAt)`: exactamente
 *    1 gana y 1 falla con `409 Conflict`, sin pisar estado ni duplicar auditoría.
 * 2. Segregación de funciones: `VERIFY` por el mismo usuario que resolvió falla
 *    con `409 Conflict` y no altera la fila ni escribe auditoría parcial.
 * 3. Transición inválida (`OPEN -> CLOSE`) y fallo de auditoría (`AUD-02` con actor
 *    inexistente violando FK) no dejan cambios parciales ni bitácora huérfana.
 * 4. Aislamiento entre empresas: empresa B recibe `404` al intentar transicionar una
 *    excepción de empresa A, sin revelar existencia ni mutar estado/auditoría.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { branches, companies, domainEvents, employeeAuditLogs, exceptions, users } from "@/lib/db/schema";
import { ExceptionService } from "@/lib/services/exception-service";
import { ApiError } from "@/lib/api/error";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = TEST_DB_URL ? describe : describe.skip;

describeDb("EXC-03.a — Lifecycle concurrente y atomicidad de auditoría (V2 Neon)", () => {
  let pool: Pool;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  const suffix = crypto.randomBytes(4).toString("hex");
  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const resolverId = `exc03a-resolver-${suffix}`;
  const verifier1Id = `exc03a-ver1-${suffix}`;
  const verifier2Id = `exc03a-ver2-${suffix}`;
  const adminBId = `exc03a-adminb-${suffix}`;
  const createdExceptionIds: string[] = [];

  async function runInTx<T>(fn: (tx: typeof testDb) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tx = drizzle(client, { schema });
      const res = await fn(tx);
      await client.query("COMMIT");
      return res;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async function auditCountFor(exceptionId: string): Promise<number> {
    const rows = await testDb
      .select({ id: employeeAuditLogs.id })
      .from(employeeAuditLogs)
      .where(
        and(
          eq(employeeAuditLogs.entityType, "EXCEPTION"),
          eq(employeeAuditLogs.entityId, exceptionId),
        ),
      );
    return rows.length;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL, max: 6 });
    testDb = drizzle(pool, { schema });

    const now = new Date();
    await testDb.insert(companies).values([
      { id: companyA, name: `EXC03A Co A ${suffix}` },
      { id: companyB, name: `EXC03A Co B ${suffix}` },
    ]);
    await testDb.insert(branches).values({
      id: branchA,
      companyId: companyA,
      name: `Suc EXC03A ${suffix}`,
    });
    await testDb.insert(users).values([
      {
        id: resolverId,
        email: `${resolverId}@test.local`,
        name: "Resolver EXC03A",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "GERENTE",
        companyId: companyA,
        branchId: branchA,
      },
      {
        id: verifier1Id,
        email: `${verifier1Id}@test.local`,
        name: "Verifier 1 EXC03A",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyA,
      },
      {
        id: verifier2Id,
        email: `${verifier2Id}@test.local`,
        name: "Verifier 2 EXC03A",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyA,
      },
      {
        id: adminBId,
        email: `${adminBId}@test.local`,
        name: "Admin B EXC03A",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyB,
      },
    ]);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (createdExceptionIds.length > 0) {
        await testDb
          .delete(employeeAuditLogs)
          .where(
            and(
              eq(employeeAuditLogs.entityType, "EXCEPTION"),
              inArray(employeeAuditLogs.entityId, createdExceptionIds),
            ),
          );
        await testDb.delete(exceptions).where(inArray(exceptions.id, createdExceptionIds));
      }
      await testDb.delete(domainEvents).where(eq(domainEvents.branchId, branchA));
      await testDb
        .delete(users)
        .where(inArray(users.id, [resolverId, verifier1Id, verifier2Id, adminBId]));
      await testDb.delete(branches).where(eq(branches.id, branchA));
      await testDb.delete(companies).where(inArray(companies.id, [companyA, companyB]));
    } finally {
      await pool.end();
    }
  });

  it("serializa acciones simultáneas (RESOLVE vs CANCEL y doble VERIFY) sin pisar estado ni duplicar auditoría", async () => {
    // 1. Crear excepción y llevarla a IN_ACTION
    const exc1 = await runInTx((tx) =>
      ExceptionService.raise(
        {
          companyId: companyA,
          branchId: branchA,
          domain: "finanzas",
          qsrCategory: "DINERO",
          severity: "high",
          subjectType: "EXC03A_RACE_1",
          subjectId: `subj-race1-${suffix}`,
          reason: "Diferencia de corte para prueba de carrera concurrente",
          actorId: verifier1Id,
        },
        tx,
      ),
    );
    createdExceptionIds.push(exc1.id);

    await runInTx((tx) =>
      ExceptionService.assign(exc1.id, companyA, resolverId, verifier1Id, tx),
    );
    await runInTx((tx) => ExceptionService.startAction(exc1.id, companyA, resolverId, tx));
    const auditsBeforeRace1 = await auditCountFor(exc1.id);

    // Carrera real en dos conexiones PostgreSQL independientes: RESOLVE vs CANCEL
    // sobre el mismo estado observado (`expectedStatus: "IN_ACTION"`) -> sin sobrescritura.
    const [resResolve, resCancel] = await Promise.allSettled([
      runInTx((tx) =>
        ExceptionService.resolve(
          exc1.id,
          companyA,
          resolverId,
          "Se ajustó el corte con comprobante bancario",
          tx,
          { expectedStatus: "IN_ACTION" },
        ),
      ),
      runInTx((tx) =>
        ExceptionService.cancel(
          exc1.id,
          companyA,
          verifier1Id,
          "Cancelada por duplicidad de alerta operativa",
          tx,
          { expectedStatus: "IN_ACTION" },
        ),
      ),
    ]);

    const winners1 = [resResolve, resCancel].filter((r) => r.status === "fulfilled");
    const losers1 = [resResolve, resCancel].filter((r) => r.status === "rejected");
    expect(winners1).toHaveLength(1);
    expect(losers1).toHaveLength(1);
    const loserErr1 = (losers1[0] as PromiseRejectedResult).reason as ApiError;
    expect(loserErr1.statusCode).toBe(409);

    const final1 = await ExceptionService.getById(exc1.id, companyA, testDb);
    expect(["RESOLVED", "CANCELLED"]).toContain(final1.status);
    // Exactamente 1 fila nueva de auditoría (la del ganador)
    expect(await auditCountFor(exc1.id)).toBe(auditsBeforeRace1 + 1);

    // 2. Segunda excepción en RESOLVED: segregación de funciones + carrera doble VERIFY
    const exc2 = await runInTx((tx) =>
      ExceptionService.raise(
        {
          companyId: companyA,
          branchId: branchA,
          domain: "inventario",
          qsrCategory: "ABASTO",
          severity: "warning",
          subjectType: "EXC03A_RACE_2",
          subjectId: `subj-race2-${suffix}`,
          reason: "Merma fuera de tolerancia para segregación y carrera VERIFY",
          actorId: verifier1Id,
        },
        tx,
      ),
    );
    createdExceptionIds.push(exc2.id);

    await runInTx((tx) =>
      ExceptionService.assign(exc2.id, companyA, resolverId, verifier1Id, tx),
    );
    await runInTx((tx) => ExceptionService.startAction(exc2.id, companyA, resolverId, tx));
    await runInTx((tx) =>
      ExceptionService.resolve(
        exc2.id,
        companyA,
        resolverId,
        "Conteo físico recalibrado con evidencia fotográfica",
        tx,
      ),
    );

    const auditsBeforeSelfVerify = await auditCountFor(exc2.id);

    // Verificador === Resolvedor -> 409 Conflict sin mutar ni escribir auditoría
    await expect(
      runInTx((tx) => ExceptionService.verify(exc2.id, companyA, resolverId, tx)),
    ).rejects.toMatchObject({ statusCode: 409 });

    const afterSelfVerify = await ExceptionService.getById(exc2.id, companyA, testDb);
    expect(afterSelfVerify.status).toBe("RESOLVED");
    expect(afterSelfVerify.verifiedBy).toBeNull();
    expect(await auditCountFor(exc2.id)).toBe(auditsBeforeSelfVerify);

    // Carrera real doble VERIFY por dos verificadores distintos
    const [ver1, ver2] = await Promise.allSettled([
      runInTx((tx) => ExceptionService.verify(exc2.id, companyA, verifier1Id, tx)),
      runInTx((tx) => ExceptionService.verify(exc2.id, companyA, verifier2Id, tx)),
    ]);

    const verWinners = [ver1, ver2].filter((r) => r.status === "fulfilled");
    const verLosers = [ver1, ver2].filter((r) => r.status === "rejected");
    expect(verWinners).toHaveLength(1);
    expect(verLosers).toHaveLength(1);
    expect(((verLosers[0] as PromiseRejectedResult).reason as ApiError).statusCode).toBe(409);

    const final2 = await ExceptionService.getById(exc2.id, companyA, testDb);
    expect(final2.status).toBe("VERIFIED");
    expect([verifier1Id, verifier2Id]).toContain(final2.verifiedBy);
    expect(await auditCountFor(exc2.id)).toBe(auditsBeforeSelfVerify + 1);
  });

  it("transición inválida, fallo de auditoría y cruce entre empresas no dejan cambios ni auditoría parcial", async () => {
    const exc = await runInTx((tx) =>
      ExceptionService.raise(
        {
          companyId: companyA,
          branchId: branchA,
          domain: "operacion",
          qsrCategory: "INOCUIDAD",
          severity: "warning",
          subjectType: "EXC03A_INVALID",
          subjectId: `subj-invalid-${suffix}`,
          reason: "Excepción abierta para validar transición ilegal y rollback de auditoría",
          actorId: verifier1Id,
        },
        tx,
      ),
    );
    createdExceptionIds.push(exc.id);

    const initialAudits = await auditCountFor(exc.id);

    // 1. Transición ilegal OPEN -> CLOSE (debe pasar por ASSIGNED -> IN_ACTION -> RESOLVED -> VERIFIED)
    await expect(
      runInTx((tx) => ExceptionService.close(exc.id, companyA, verifier1Id, tx)),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect((await ExceptionService.getById(exc.id, companyA, testDb)).status).toBe("OPEN");
    expect(await auditCountFor(exc.id)).toBe(initialAudits);

    // 2. Fallo real de auditoría (actorId inexistente rompe FK de employee_audit_logs):
    // la actualización OPEN -> ASSIGNED debe revertirse completamente en la misma transacción.
    await expect(
      runInTx((tx) =>
        ExceptionService.assign(exc.id, companyA, resolverId, "nonexistent-audit-actor", tx),
      ),
    ).rejects.toThrow();

    const afterAuditFailure = await ExceptionService.getById(exc.id, companyA, testDb);
    expect(afterAuditFailure.status).toBe("OPEN");
    expect(afterAuditFailure.ownerId).toBeNull();
    expect(await auditCountFor(exc.id)).toBe(initialAudits);

    // 3. Empresa B no puede leer ni transicionar la excepción de Empresa A (404 indistinto)
    await expect(
      runInTx((tx) => ExceptionService.cancel(exc.id, companyB, adminBId, "Cruce indebido", tx)),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect((await ExceptionService.getById(exc.id, companyA, testDb)).status).toBe("OPEN");
    expect(await auditCountFor(exc.id)).toBe(initialAudits);
  });
});
