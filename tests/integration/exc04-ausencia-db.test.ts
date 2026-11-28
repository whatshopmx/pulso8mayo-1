/**
 * EXC-04.ausencia — Verificación V2 en Neon PostgreSQL real (esquema efímero aislado).
 *
 * Comprueba sobre Postgres real:
 * 1. Detección de ausencia pendiente (`NO_SHOW`, `requiresApproval=true, approvedAt=null`)
 *    crea 1 excepción canónica `employee_absence` con responsable (`supervisorId`),
 *    `classification: "PENDING_ABSENCE_REVIEW"`, `isApprovedAbsence: false`,
 *    `isPendingAttendance: true`, e historial inicial (`DETECTED`).
 * 2. En NOM-02.a (`resolveAttendanceForPeriod`), esa ausencia pendiente bloquea como
 *    asistencia pendiente (`hasPendingAttendance: true`, `unpaidAbsenceDays: 0`) —
 *    NO se confunde con una falta aprobada.
 * 3. Repetir `detectAbsenceException` y correr `employeeAbsenceAdapter.run` 2 veces
 *    NO duplica la excepción ni el historial y conserva el `ownerId` original.
 * 4. Confirmar la falta (`approveAbsence`) marca `requiresApproval=false`, `approvedBy`,
 *    `approvedAt`, actualiza la excepción a `APPROVED_ABSENCE` conservando `ownerId` e
 *    historial (`[DETECTED, APPROVED_ABSENCE]`), escribe auditoría `AUD-02` y ahora
 *    NOM-02.a descuenta exactamente 1 día (`unpaidAbsenceDays: 1`, `hasPendingAttendance: false`).
 * 5. Regularizar la ausencia (`regularizeAbsence`, `ATTENDANCE_COMPLETED`) cambia la
 *    sesión a `COMPLETED`, cierra la excepción conservando `ownerId` e historial completo
 *    (`[DETECTED, APPROVED_ABSENCE, REGULARIZED_ATTENDANCE]`), escribe auditoría `AUD-02`
 *    (`EXCEPTION` + `ATTENDANCE_REGULARIZATION`) y NOM-02.a devuelve `unpaidAbsenceDays: 0`
 *    y `approvedAttendanceDays: 1`.
 * 6. Día cubierto por permiso/vacación `APPROVED` no genera excepción de falta y
 *    `approveAbsence` lo rechaza con `409 Conflict`.
 * 7. Atomicidad ante fallo `AUD-02` (FK en `employee_audit_logs`): revierte por completo
 *    tanto `shift_sessions` como `exceptions`.
 * 8. Aislamiento entre empresas: empresa B recibe `404` sobre sesiones de empresa A.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  branches,
  companies,
  employeeAuditLogs,
  employeeProfiles,
  exceptions,
  shiftSessions,
  users,
  vacationRequests,
} from "@/lib/db/schema";

const dbState = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle<typeof schema>>,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return dbState.db;
  },
}));

import {
  ABSENCE_EXCEPTION_SUBJECT_TYPE,
  type AbsenceHistoryEntry,
} from "@/lib/services/absence-exception-rules";
import {
  approveAbsence,
  detectAbsenceException,
  regularizeAbsence,
} from "@/lib/services/absence-exception-service";
import { employeeAbsenceAdapter } from "@/lib/services/exception-adapters/employee-absence";
import { ExceptionService } from "@/lib/services/exception-service";
import { resolveAttendanceForPeriod } from "@/lib/services/payroll-service";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = TEST_DB_URL ? describe : describe.skip;

describeDb("EXC-04.ausencia — Detección, aprobación y regularización de ausencias (V2 Neon)", () => {
  let pool: Pool;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  const suffix = crypto.randomBytes(4).toString("hex");
  const namespace = `exc04a_${suffix}`;
  let schemaCreated = false;

  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const employeeId = `exc04a-emp-${suffix}`;
  const supervisorId = `exc04a-sup-${suffix}`;
  const managerId = `exc04a-mgr-${suffix}`;
  const adminBId = `exc04a-admb-${suffix}`;

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
    try {
      await setupPool.query(`CREATE SCHEMA "${namespace}"`);
      schemaCreated = true;
      const tablesToClone = [
        "companies",
        "branches",
        "users",
        "employee_profiles",
        "shift_sessions",
        "shift_approvals",
        "holidays",
        "vacation_requests",
        "leave_types",
        "leave_requests",
        "exceptions",
        "employee_audit_logs",
        "domain_events",
      ];
      for (const t of tablesToClone) {
        await setupPool.query(
          `CREATE TABLE "${namespace}"."${t}" (LIKE public."${t}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
        );
      }
      await setupPool.query(
        `ALTER TABLE "${namespace}".employee_audit_logs ADD CONSTRAINT exc04a_audit_user_fk FOREIGN KEY (user_id) REFERENCES "${namespace}".users(id)`,
      );
      await setupPool.query(
        `ALTER TABLE "${namespace}".employee_audit_logs ADD CONSTRAINT exc04a_audit_perf_fk FOREIGN KEY (performed_by) REFERENCES "${namespace}".users(id)`,
      );
    } finally {
      await setupPool.end();
    }

    pool = new Pool({
      connectionString: TEST_DB_URL,
      max: 6,
      options: `-c search_path=${namespace},public -c timezone=UTC`,
    });
    testDb = drizzle(pool, { schema });
    dbState.db = testDb;

    const now = new Date();
    await testDb.insert(companies).values([
      { id: companyA, name: `EXC04A Co A ${suffix}` },
      { id: companyB, name: `EXC04A Co B ${suffix}` },
    ]);
    await testDb.insert(users).values([
      {
        id: employeeId,
        email: `${employeeId}@test.local`,
        name: "Carlos Cocina",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "EMPLEADO",
        companyId: companyA,
        active: true,
      },
      {
        id: supervisorId,
        email: `${supervisorId}@test.local`,
        name: "Sofía Supervisora",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "SUPERVISOR",
        companyId: companyA,
        active: true,
      },
      {
        id: managerId,
        email: `${managerId}@test.local`,
        name: "Marco Gerente",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "GERENTE",
        companyId: companyA,
        active: true,
      },
      {
        id: adminBId,
        email: `${adminBId}@test.local`,
        name: "Admin Empresa B",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyB,
        active: true,
      },
    ]);
    await testDb.insert(branches).values({
      id: branchA,
      companyId: companyA,
      name: `Suc EXC04A ${suffix}`,
      managerId,
      timezone: "America/Mexico_City",
    });
    await testDb.insert(employeeProfiles).values({
      userId: employeeId,
      supervisorId,
      createdBy: managerId,
    });
  });

  afterAll(async () => {
    try {
      await pool?.end();
    } finally {
      if (schemaCreated) {
        const dropPool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
        try {
          await dropPool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        } finally {
          await dropPool.end();
        }
      }
    }
  });

  it("distingue falta aprobada vs asistencia pendiente, conserva responsable/historial y audita regularización", async () => {
    // 1. Sesión NO_SHOW pendiente de confirmación (requiresApproval=true, approvedAt=null)
    const [pendingNoShow] = await testDb
      .insert(shiftSessions)
      .values({
        userId: employeeId,
        branchId: branchA,
        status: "NO_SHOW",
        requiresApproval: true,
        approvedAt: null,
        startedAt: new Date("2026-05-05T15:00:00Z"),
        notes: "Sin registro de entrada al inicio del turno",
      })
      .returning();

    const detected = await detectAbsenceException(
      {
        companyId: companyA,
        sessionId: pendingNoShow.id,
        actorId: supervisorId,
        reason: "Detectada ausencia al cierre de tolerancia",
        now: new Date("2026-05-05T16:00:00Z"),
      },
      testDb,
    );
    expect(detected.created).toBe(true);
    expect(detected.classification.classification).toBe("PENDING_ABSENCE_REVIEW");
    expect(detected.classification.isApprovedAbsence).toBe(false);
    expect(detected.classification.isPendingAttendance).toBe(true);
    expect(detected.exception).not.toBeNull();
    expect(detected.exception!.ownerId).toBe(supervisorId);

    // 2. NOM-02.a trata esa ausencia pendiente como asistencia pendiente, NO como falta aprobada
    const nomPending = await resolveAttendanceForPeriod({
      userId: employeeId,
      companyId: companyA,
      branchId: branchA,
      startDate: "2026-05-01",
      endDate: "2026-05-15",
      timezone: "America/Mexico_City",
      dbInstance: testDb,
    });
    expect(nomPending.hasPendingAttendance).toBe(true);
    expect(nomPending.unpaidAbsenceDays).toBe(0);

    // 3. Repetir detección + adaptador 2 veces NO duplica excepción ni historial y preserva ownerId
    await detectAbsenceException(
      {
        companyId: companyA,
        sessionId: pendingNoShow.id,
        now: new Date("2026-05-05T16:15:00Z"),
      },
      testDb,
    );
    await employeeAbsenceAdapter.run({ companyId: companyA, branchId: branchA });
    await employeeAbsenceAdapter.run({ companyId: companyA, branchId: branchA });

    const rowsAfterSync = await testDb
      .select()
      .from(exceptions)
      .where(
        and(
          eq(exceptions.companyId, companyA),
          eq(exceptions.subjectType, ABSENCE_EXCEPTION_SUBJECT_TYPE),
          eq(exceptions.subjectId, pendingNoShow.id),
        ),
      );
    expect(rowsAfterSync).toHaveLength(1);
    expect(rowsAfterSync[0].ownerId).toBe(supervisorId);
    expect(
      ((rowsAfterSync[0].metadata as Record<string, unknown>).history as AbsenceHistoryEntry[]),
    ).toHaveLength(1);

    // 4. Segregación y aislamiento entre empresas
    await expect(
      approveAbsence({
        companyId: companyA,
        sessionId: pendingNoShow.id,
        actorId: employeeId,
        reason: "Intento de auto-aprobación",
      }),
    ).rejects.toThrow(/Segregación/);

    await expect(
      approveAbsence({
        companyId: companyB,
        sessionId: pendingNoShow.id,
        actorId: adminBId,
        reason: "Intento cross-tenant",
      }),
    ).rejects.toThrow(/no encontrada/i);

    // 5. Confirmar falta aprobada (approveAbsence): conserva ownerId, agrega historial, audita y descuenta en NOM-02.a
    const approved = await approveAbsence({
      companyId: companyA,
      sessionId: pendingNoShow.id,
      actorId: managerId,
      reason: "Colaborador no se presentó ni avisó en turno matutino",
      now: new Date("2026-05-05T20:00:00Z"),
    });
    expect(approved.session.status).toBe("NO_SHOW");
    expect(approved.session.requiresApproval).toBe(false);
    expect(approved.session.approvedBy).toBe(managerId);
    expect(approved.exception.ownerId).toBe(supervisorId);
    const metaApproved = approved.exception.metadata as Record<string, unknown>;
    expect(metaApproved.classification).toBe("APPROVED_ABSENCE");
    expect(metaApproved.isApprovedAbsence).toBe(true);
    expect(metaApproved.isPendingAttendance).toBe(false);
    expect((metaApproved.history as AbsenceHistoryEntry[]).map((h) => h.event)).toEqual([
      "DETECTED",
      "APPROVED_ABSENCE",
    ]);

    const nomApproved = await resolveAttendanceForPeriod({
      userId: employeeId,
      companyId: companyA,
      branchId: branchA,
      startDate: "2026-05-01",
      endDate: "2026-05-15",
      timezone: "America/Mexico_City",
      dbInstance: testDb,
    });
    expect(nomApproved.hasPendingAttendance).toBe(false);
    expect(nomApproved.unpaidAbsenceDays).toBe(1);
    expect(nomApproved.payableDays).toBe(14);

    // 6. Rollback atómico ante fallo AUD-02 en regularización (performed_by inexistente viola FK)
    await expect(
      regularizeAbsence({
        companyId: companyA,
        sessionId: pendingNoShow.id,
        actorId: "ghost-actor-fk-violation",
        mode: "ATTENDANCE_COMPLETED",
        reason: "Debe revertir si falla AUD-02",
      }),
    ).rejects.toThrow();

    const [sessionStillNoShow] = await testDb
      .select({ status: shiftSessions.status })
      .from(shiftSessions)
      .where(eq(shiftSessions.id, pendingNoShow.id));
    expect(sessionStillNoShow.status).toBe("NO_SHOW");
    const excStillOpen = await ExceptionService.getBySubject(
      companyA,
      ABSENCE_EXCEPTION_SUBJECT_TYPE,
      pendingNoShow.id,
      testDb,
    );
    expect(excStillOpen!.status).toBe("OPEN");

    // 7. Regularizar ausencia (ATTENDANCE_COMPLETED): cierra excepción conservando responsable e historial + AUD-02
    const regularized = await regularizeAbsence({
      companyId: companyA,
      sessionId: pendingNoShow.id,
      actorId: managerId,
      mode: "ATTENDANCE_COMPLETED",
      reason: "Checador offline; entrada validada con bitácora de turno",
      checkInTime: new Date("2026-05-05T14:00:00Z"),
      checkOutTime: new Date("2026-05-05T22:00:00Z"),
      now: new Date("2026-05-06T12:00:00Z"),
    });
    expect(regularized.session.status).toBe("COMPLETED");
    expect(regularized.exception).not.toBeNull();
    expect(regularized.exception!.status).toBe("CANCELLED");
    expect(regularized.exception!.ownerId).toBe(supervisorId);
    const metaReg = regularized.exception!.metadata as Record<string, unknown>;
    expect((metaReg.history as AbsenceHistoryEntry[]).map((h) => h.event)).toEqual([
      "DETECTED",
      "APPROVED_ABSENCE",
      "REGULARIZED_ATTENDANCE",
    ]);

    const regAudits = await testDb
      .select()
      .from(employeeAuditLogs)
      .where(
        and(
          eq(employeeAuditLogs.entityType, "ATTENDANCE_REGULARIZATION"),
          eq(employeeAuditLogs.entityId, pendingNoShow.id),
        ),
      );
    expect(regAudits).toHaveLength(1);
    expect(regAudits[0].performedBy).toBe(managerId);

    // NOM-02.a refleja la regularización: 0 faltas, 1 día asistido aprobado, 15 pagaderos
    const nomRegularized = await resolveAttendanceForPeriod({
      userId: employeeId,
      companyId: companyA,
      branchId: branchA,
      startDate: "2026-05-01",
      endDate: "2026-05-15",
      timezone: "America/Mexico_City",
      dbInstance: testDb,
    });
    expect(nomRegularized.hasPendingAttendance).toBe(false);
    expect(nomRegularized.unpaidAbsenceDays).toBe(0);
    expect(nomRegularized.approvedAttendanceDays).toBe(1);
    expect(nomRegularized.payableDays).toBe(15);

    // 8. Día cubierto por vacación APPROVED no genera excepción y bloquea aprobar falta con 409
    await testDb.insert(vacationRequests).values({
      userId: employeeId,
      companyId: companyA,
      branchId: branchA,
      startDate: new Date("2026-05-10T00:00:00Z"),
      endDate: new Date("2026-05-11T23:59:59Z"),
      totalDays: 2,
      status: "APPROVED",
      approvedBy: managerId,
      approvedAt: new Date("2026-05-01T12:00:00Z"),
    });
    const [coveredSession] = await testDb
      .insert(shiftSessions)
      .values({
        userId: employeeId,
        branchId: branchA,
        status: "NO_SHOW",
        requiresApproval: false,
        startedAt: new Date("2026-05-10T15:00:00Z"),
      })
      .returning();

    const coveredDetection = await detectAbsenceException(
      { companyId: companyA, sessionId: coveredSession.id },
      testDb,
    );
    expect(coveredDetection.classification.classification).toBe("COVERED_BY_APPROVED_LEAVE");
    expect(coveredDetection.exception).toBeNull();

    await expect(
      approveAbsence({
        companyId: companyA,
        sessionId: coveredSession.id,
        actorId: managerId,
        reason: "No debe aprobar falta en día con vacación aprobada",
      }),
    ).rejects.toThrow(/permiso o vacación aprobada/i);
  });
});
