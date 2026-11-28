/**
 * EXC-03.b — Verificación V2 del job recuperable de SLA en Neon PostgreSQL real.
 *
 * Comprueba sobre base real (con reloj controlado, caída/reintento simulados,
 * concurrencia real con dos conexiones y limpieza determinista en `afterAll`):
 * 1. Caída del worker a mitad del lote tras escalar la primera excepción +
 *    reintento con el mismo reloj controlado: completa solo las pendientes sin
 *    duplicar el escalamiento de la primera; una tercera corrida es no-op (`0`).
 * 2. Respeta empresa (`companyB` intacta) y estados terminales (`CLOSED`, `CANCELLED`
 *    con `slaDueAt` vencido nunca se escalan).
 * 3. Avanzar el reloj controlado escala únicamente la excepción cuyo SLA vence
 *    en la nueva marca de tiempo.
 * 4. Dos barridos simultáneos en conexiones separadas sobre una misma excepción
 *    vencida producen exactamente 1 escalamiento total (sin duplicar).
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { branches, companies, exceptions } from "@/lib/db/schema";
import { sweepCompanyExceptionSla } from "@/lib/services/exception-sla-job-service";
import { ExceptionService } from "@/lib/services/exception-service";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = TEST_DB_URL ? describe : describe.skip;

describeDb("EXC-03.b — Job recuperable de SLA con reloj controlado (V2 Neon)", () => {
  let pool: Pool;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  const suffix = crypto.randomBytes(4).toString("hex");
  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  const createdIds: string[] = [];

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

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL, max: 6 });
    testDb = drizzle(pool, { schema });

    await testDb.insert(companies).values([
      { id: companyA, name: `EXC03B Co A ${suffix}` },
      { id: companyB, name: `EXC03B Co B ${suffix}` },
    ]);
    await testDb.insert(branches).values([
      { id: branchA, companyId: companyA, name: `Suc A ${suffix}` },
      { id: branchB, companyId: companyB, name: `Suc B ${suffix}` },
    ]);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (createdIds.length > 0) {
        await testDb.delete(exceptions).where(inArray(exceptions.id, createdIds));
      }
      await testDb.delete(branches).where(inArray(branches.id, [branchA, branchB]));
      await testDb.delete(companies).where(inArray(companies.id, [companyA, companyB]));
    } finally {
      await pool.end();
    }
  });

  it("caída a mitad del lote + reintento no duplica escalamiento y respeta empresa, reloj y estados terminales", async () => {
    const T0 = new Date("2026-11-26T15:00:00.000Z");
    const T0Minus10m = new Date("2026-11-26T14:50:00.000Z");
    const T0Minus5m = new Date("2026-11-26T14:55:00.000Z");
    const T0Minus60m = new Date("2026-11-26T14:00:00.000Z");
    const T0Plus30m = new Date("2026-11-26T15:30:00.000Z");
    const T0Plus45m = new Date("2026-11-26T15:45:00.000Z");

    const idBreached1 = crypto.randomUUID();
    const idBreached2 = crypto.randomUUID();
    const idFuture = crypto.randomUUID();
    const idClosed = crypto.randomUUID();
    const idCancelled = crypto.randomUUID();
    const idCompanyB = crypto.randomUUID();
    createdIds.push(idBreached1, idBreached2, idFuture, idClosed, idCancelled, idCompanyB);

    await testDb.insert(exceptions).values([
      {
        id: idBreached1,
        companyId: companyA,
        branchId: branchA,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: "critical",
        subjectType: "EXC03B_SLA",
        subjectId: `b1-${suffix}`,
        reason: "Vencida 1 para prueba de caída/reintento",
        status: "OPEN",
        slaDueAt: T0Minus10m,
      },
      {
        id: idBreached2,
        companyId: companyA,
        branchId: branchA,
        domain: "inventario",
        qsrCategory: "ABASTO",
        severity: "high",
        subjectType: "EXC03B_SLA",
        subjectId: `b2-${suffix}`,
        reason: "Vencida 2 pendiente tras caída",
        status: "IN_ACTION",
        slaDueAt: T0Minus5m,
      },
      {
        id: idFuture,
        companyId: companyA,
        branchId: branchA,
        domain: "operacion",
        qsrCategory: "INOCUIDAD",
        severity: "warning",
        subjectType: "EXC03B_SLA",
        subjectId: `fut-${suffix}`,
        reason: "Vigente en T0, vencida en T0+45m",
        status: "OPEN",
        slaDueAt: T0Plus30m,
      },
      {
        id: idClosed,
        companyId: companyA,
        branchId: branchA,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: "high",
        subjectType: "EXC03B_SLA",
        subjectId: `closed-${suffix}`,
        reason: "Terminal CLOSED con SLA antiguo",
        status: "CLOSED",
        slaDueAt: T0Minus60m,
      },
      {
        id: idCancelled,
        companyId: companyA,
        branchId: branchA,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: "high",
        subjectType: "EXC03B_SLA",
        subjectId: `cancelled-${suffix}`,
        reason: "Terminal CANCELLED con SLA antiguo",
        status: "CANCELLED",
        slaDueAt: T0Minus60m,
      },
      {
        id: idCompanyB,
        companyId: companyB,
        branchId: branchB,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: "critical",
        subjectType: "EXC03B_SLA",
        subjectId: `other-co-${suffix}`,
        reason: "Vencida de otra empresa",
        status: "OPEN",
        slaDueAt: T0Minus60m,
      },
    ]);

    // Corrida 1: simula caída del worker justo después de escalar la primera fila (sin rollback
    // de la primera porque cada escalamiento usa su propia transacción o commit previo en el job).
    // Aquí ejecutamos con `testDb` (pool-backed) para que cada `ExceptionService.escalate`
    // confirme su fila y el hook aborte antes de la segunda.
    const seenInRun1: string[] = [];
    await expect(
      sweepCompanyExceptionSla({
        companyId: companyA,
        now: T0,
        executor: testDb,
        abortOnHookError: true,
        onEscalated: (row) => {
          seenInRun1.push(row.id);
          throw new Error("SIMULATED_WORKER_CRASH_AFTER_FIRST");
        },
      }),
    ).rejects.toThrow("SIMULATED_WORKER_CRASH_AFTER_FIRST");

    expect(seenInRun1).toEqual([idBreached1]);
    expect((await ExceptionService.getById(idBreached1, companyA, testDb)).status).toBe("ESCALATED");
    expect((await ExceptionService.getById(idBreached2, companyA, testDb)).status).toBe("IN_ACTION");

    // Corrida 2 (reintento en el mismo T0): solo escala b2, NO duplica b1
    const run2 = await sweepCompanyExceptionSla({
      companyId: companyA,
      now: T0,
      executor: testDb,
    });
    expect(run2.escalated).toBe(1);
    expect(run2.escalatedIds).toEqual([idBreached2]);
    expect(run2.failed).toBe(0);

    // Corrida 3 (repetición idempotente en T0): 0 escaneadas, 0 escaladas
    const run3 = await sweepCompanyExceptionSla({
      companyId: companyA,
      now: T0,
      executor: testDb,
    });
    expect(run3.scanned).toBe(0);
    expect(run3.escalated).toBe(0);

    // Verificar que terminales, futura y empresa B siguen intactas
    expect((await ExceptionService.getById(idClosed, companyA, testDb)).status).toBe("CLOSED");
    expect((await ExceptionService.getById(idCancelled, companyA, testDb)).status).toBe("CANCELLED");
    expect((await ExceptionService.getById(idFuture, companyA, testDb)).status).toBe("OPEN");
    expect((await ExceptionService.getById(idCompanyB, companyB, testDb)).status).toBe("OPEN");

    // Corrida 4: avanzar reloj controlado a T0 + 45m -> escala únicamente `idFuture`
    const run4 = await sweepCompanyExceptionSla({
      companyId: companyA,
      now: T0Plus45m,
      executor: testDb,
    });
    expect(run4.escalated).toBe(1);
    expect(run4.escalatedIds).toEqual([idFuture]);
    expect((await ExceptionService.getById(idCompanyB, companyB, testDb)).status).toBe("OPEN");

    // Corrida 5: dos barridos simultáneos en dos conexiones sobre una misma excepción vencida
    const idRace = crypto.randomUUID();
    createdIds.push(idRace);
    await testDb.insert(exceptions).values({
      id: idRace,
      companyId: companyA,
      branchId: branchA,
      domain: "finanzas",
      qsrCategory: "DINERO",
      severity: "critical",
      subjectType: "EXC03B_SLA_RACE",
      subjectId: `race-${suffix}`,
      reason: "Carrera concurrente de dos barridos SLA",
      status: "OPEN",
      slaDueAt: T0Minus10m,
    });

    const [sweepA, sweepB] = await Promise.all([
      runInTx((tx) => sweepCompanyExceptionSla({ companyId: companyA, now: T0, executor: tx })),
      runInTx((tx) => sweepCompanyExceptionSla({ companyId: companyA, now: T0, executor: tx })),
    ]);

    expect(sweepA.escalated + sweepB.escalated).toBe(1);
    expect(sweepA.failed + sweepB.failed).toBe(0);
    const [raceRow] = await testDb
      .select({ status: exceptions.status })
      .from(exceptions)
      .where(eq(exceptions.id, idRace));
    expect(raceRow.status).toBe("ESCALATED");
  });
});
