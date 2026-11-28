/**
 * EXC-04.ausencia — Servicio canónico para detección, aprobación de falta y
 * regularización de ausencias laborales (`employee_absence`).
 *
 * Garantías:
 * 1. Distingue `APPROVED_ABSENCE` (falta aprobada que descuenta en NOM-02.a)
 *    de `PENDING_ABSENCE_REVIEW` / `PENDING_ATTENDANCE` (asistencia pendiente)
 *    y de días cubiertos por vacación o permiso aprobado (`COVERED_BY_APPROVED_LEAVE`).
 * 2. Conserva el responsable (`ownerId`) y el historial append-only en
 *    `exceptions.metadata.history` a través de detección, aprobación y regularización.
 * 3. Repetir la detección o el adaptador nunca duplica la excepción ni el historial.
 * 4. La confirmación de falta aprobada y la regularización auditan en `AUD-02`
 *    dentro de la misma transacción: si la auditoría falla, todo revierte.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  branches,
  employeeProfiles,
  exceptions,
  leaveRequests,
  shiftSessions,
  users,
  vacationRequests,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { AuditService } from "./audit-service";
import { isTerminal } from "./exception-lifecycle";
import {
  ExceptionService,
  type DbExecutor,
  type ExceptionRow,
} from "./exception-service";
import {
  ABSENCE_EXCEPTION_SUBJECT_TYPE,
  appendAbsenceHistory,
  buildAbsenceAuditReason,
  buildAbsenceExceptionInput,
  classifyShiftAbsenceState,
  resolveAbsenceOwnerId,
  toCivilDate,
  type AbsenceClassificationResult,
  type AbsenceHistoryEntry,
} from "./absence-exception-rules";

export type AbsenceRegularizationMode =
  | "ATTENDANCE_COMPLETED"
  | "JUSTIFIED_LEAVE"
  | "CANCELLED";

async function loadScopedSession(
  companyId: string,
  sessionId: string,
  executor: DbExecutor,
) {
  const [row] = await executor
    .select({
      session: shiftSessions,
      branchCompanyId: branches.companyId,
      branchManagerId: branches.managerId,
      employeeName: users.name,
    })
    .from(shiftSessions)
    .innerJoin(branches, eq(shiftSessions.branchId, branches.id))
    .leftJoin(users, eq(shiftSessions.userId, users.id))
    .where(
      and(eq(shiftSessions.id, sessionId), eq(branches.companyId, companyId)),
    )
    .limit(1);

  if (!row) {
    throw ApiError.notFound("Sesión de asistencia no encontrada en esta empresa.");
  }
  return row;
}

async function loadApprovedLeaveRanges(
  companyId: string,
  employeeUserId: string,
  executor: DbExecutor,
) {
  const [vacRows, leaveRows] = await Promise.all([
    executor
      .select({
        startDate: vacationRequests.startDate,
        endDate: vacationRequests.endDate,
        status: vacationRequests.status,
      })
      .from(vacationRequests)
      .where(
        and(
          eq(vacationRequests.companyId, companyId),
          eq(vacationRequests.userId, employeeUserId),
          eq(vacationRequests.status, "APPROVED"),
        ),
      ),
    executor
      .select({
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        status: leaveRequests.status,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.userId, employeeUserId),
          eq(leaveRequests.status, "APPROVED"),
        ),
      ),
  ]);

  return [...vacRows, ...leaveRows];
}

export async function resolveAbsenceOwnerInDb(
  params: {
    companyId: string;
    branchId: string;
    employeeUserId: string;
    branchManagerId?: string | null;
  },
  executor: DbExecutor = db,
): Promise<string | null> {
  const [[profile], branchRow, companyUsers] = await Promise.all([
    executor
      .select({ supervisorId: employeeProfiles.supervisorId })
      .from(employeeProfiles)
      .where(eq(employeeProfiles.userId, params.employeeUserId))
      .limit(1),
    params.branchManagerId !== undefined
      ? Promise.resolve([{ managerId: params.branchManagerId }])
      : executor
          .select({ managerId: branches.managerId })
          .from(branches)
          .where(
            and(
              eq(branches.id, params.branchId),
              eq(branches.companyId, params.companyId),
            ),
          )
          .limit(1),
    executor
      .select({
        id: users.id,
        role: users.role,
        branchId: users.branchId,
        active: users.active,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, params.companyId),
          eq(users.active, true),
          isNull(users.deletedAt),
        ),
      ),
  ]);

  return resolveAbsenceOwnerId(companyUsers, {
    branchId: params.branchId,
    employeeUserId: params.employeeUserId,
    supervisorId: profile?.supervisorId ?? null,
    branchManagerId: branchRow[0]?.managerId ?? null,
  });
}

/**
 * Detecta y proyecta una ausencia en `exceptions` de forma idempotente,
 * respetando vacaciones/permisos aprobados, conservando `ownerId` e historial.
 */
export async function detectAbsenceException(
  params: {
    companyId: string;
    sessionId: string;
    actorId?: string | null;
    reason?: string | null;
    now?: Date;
  },
  executor: DbExecutor = db,
): Promise<{
  exception: ExceptionRow | null;
  classification: AbsenceClassificationResult;
  created: boolean;
}> {
  const loaded = await loadScopedSession(params.companyId, params.sessionId, executor);
  const { session, branchManagerId, employeeName } = loaded;
  const shiftDate = toCivilDate(session.startedAt);
  const approvedRanges = await loadApprovedLeaveRanges(
    params.companyId,
    session.userId,
    executor,
  );

  const classification = classifyShiftAbsenceState({
    status: session.status,
    requiresApproval: session.requiresApproval,
    approvedAt: session.approvedAt,
    sessionDate: shiftDate,
    approvedLeaveRanges: approvedRanges,
  });

  const existing = await ExceptionService.getBySubject(
    params.companyId,
    ABSENCE_EXCEPTION_SUBJECT_TYPE,
    session.id,
    executor,
  );

  if (!classification.shouldRaiseException) {
    return { exception: existing, classification, created: false };
  }

  if (existing && isTerminal(existing.status)) {
    return { exception: existing, classification, created: false };
  }

  const ownerId =
    existing?.ownerId ??
    (await resolveAbsenceOwnerInDb(
      {
        companyId: params.companyId,
        branchId: session.branchId,
        employeeUserId: session.userId,
        branchManagerId,
      },
      executor,
    ));

  const nowIso = (params.now ?? new Date()).toISOString();
  const auditReason = buildAbsenceAuditReason({
    action: "DETECT",
    notes: params.reason ?? session.notes,
    sessionId: session.id,
  });

  const historyEntry: AbsenceHistoryEntry = {
    at: nowIso,
    event: "DETECTED",
    actorId: params.actorId ?? null,
    previousStatus: existing
      ? String((existing.metadata as Record<string, unknown> | null)?.sourceStatus ?? session.status)
      : null,
    newStatus: session.status ?? "NO_SHOW",
    classification: classification.classification,
    ownerId,
    reason: auditReason,
  };

  const existingMeta =
    existing && typeof existing.metadata === "object" && existing.metadata !== null
      ? (existing.metadata as Record<string, unknown>)
      : null;

  const raiseInput = buildAbsenceExceptionInput({
    companyId: params.companyId,
    branchId: session.branchId,
    sessionId: session.id,
    employeeId: session.userId,
    employeeName,
    shiftDate,
    sourceStatus: session.status ?? "NO_SHOW",
    classification,
    ownerId,
    actorId: existing ? null : (params.actorId ?? null),
    historyEntry,
    existingMetadata: existingMeta,
    existingOwnerId: existing?.ownerId ?? null,
  });

  const row = await ExceptionService.raise(raiseInput, executor);
  return { exception: row, classification, created: !existing };
}

/**
 * Confirma una ausencia detectada (o turno `PENDING`) como **falta aprobada**
 * (`status = 'NO_SHOW'`, `requiresApproval = false`, `approvedBy`, `approvedAt`),
 * conservando responsable e historial en `exceptions` y escribiendo auditoría
 * crítica `AUD-02` dentro de la misma transacción.
 */
export async function approveAbsence(
  params: {
    companyId: string;
    sessionId: string;
    actorId: string;
    reason: string;
    now?: Date;
  },
  executor?: DbExecutor,
): Promise<{
  session: typeof shiftSessions.$inferSelect;
  exception: ExceptionRow;
}> {
  const auditReason = buildAbsenceAuditReason({
    action: "APPROVE_ABSENCE",
    notes: params.reason,
    sessionId: params.sessionId,
  });

  const run = async (tx: DbExecutor) => {
    const loaded = await loadScopedSession(params.companyId, params.sessionId, tx);
    const { session, branchManagerId, employeeName } = loaded;

    if (params.actorId === session.userId) {
      throw ApiError.forbidden(
        "Segregación de funciones: un colaborador no puede aprobar su propia falta.",
      );
    }

    const shiftDate = toCivilDate(session.startedAt);
    const approvedRanges = await loadApprovedLeaveRanges(
      params.companyId,
      session.userId,
      tx,
    );
    const preCheck = classifyShiftAbsenceState({
      status: "NO_SHOW",
      requiresApproval: false,
      approvedAt: params.now ?? new Date(),
      sessionDate: shiftDate,
      approvedLeaveRanges: approvedRanges,
    });
    if (preCheck.classification === "COVERED_BY_APPROVED_LEAVE") {
      throw ApiError.conflict(
        `El colaborador cuenta con permiso o vacación aprobada para ${shiftDate}; no procede marcar falta aprobada.`,
      );
    }

    const now = params.now ?? new Date();
    const [updatedSession] = await tx
      .update(shiftSessions)
      .set({
        status: "NO_SHOW",
        requiresApproval: false,
        approvedBy: params.actorId,
        approvedAt: now,
        notes: params.reason.trim() || session.notes,
      })
      .where(
        and(
          eq(shiftSessions.id, session.id),
          eq(shiftSessions.branchId, session.branchId),
        ),
      )
      .returning();

    const existing = await ExceptionService.getBySubject(
      params.companyId,
      ABSENCE_EXCEPTION_SUBJECT_TYPE,
      session.id,
      tx,
    );

    const ownerId =
      existing?.ownerId ??
      (await resolveAbsenceOwnerInDb(
        {
          companyId: params.companyId,
          branchId: session.branchId,
          employeeUserId: session.userId,
          branchManagerId,
        },
        tx,
      ));

    const historyEntry: AbsenceHistoryEntry = {
      at: now.toISOString(),
      event: "APPROVED_ABSENCE",
      actorId: params.actorId,
      previousStatus: session.status ?? "PENDING",
      newStatus: "NO_SHOW",
      classification: "APPROVED_ABSENCE",
      ownerId,
      reason: auditReason,
    };

    const existingMeta =
      existing && typeof existing.metadata === "object" && existing.metadata !== null
        ? (existing.metadata as Record<string, unknown>)
        : null;

    const raiseInput = buildAbsenceExceptionInput({
      companyId: params.companyId,
      branchId: session.branchId,
      sessionId: session.id,
      employeeId: session.userId,
      employeeName,
      shiftDate,
      sourceStatus: "NO_SHOW",
      classification: preCheck,
      ownerId,
      actorId: existing ? null : params.actorId,
      historyEntry,
      existingMetadata: existingMeta,
      existingOwnerId: existing?.ownerId ?? null,
    });

    const exception = await ExceptionService.raise(raiseInput, tx);

    await AuditService.logCriticalEmployeeAction(
      {
        userId: session.userId,
        performedBy: params.actorId,
        action: "UPDATE",
        entityType: "EXCEPTION",
        entityId: exception.id,
        oldValue: {
          sessionStatus: session.status,
          requiresApproval: session.requiresApproval,
          approvedAt: session.approvedAt,
          exceptionOwnerId: existing?.ownerId ?? null,
        },
        newValue: {
          sessionStatus: updatedSession.status,
          requiresApproval: updatedSession.requiresApproval,
          approvedBy: updatedSession.approvedBy,
          approvedAt: updatedSession.approvedAt,
          classification: "APPROVED_ABSENCE",
          exceptionOwnerId: exception.ownerId,
        },
        reason: auditReason,
        isCritical: true,
      },
      tx,
    );

    return { session: updatedSession, exception };
  };

  if (executor && executor !== db) return run(executor);
  return db.transaction(async (tx) => run(tx));
}

/**
 * Regulariza una ausencia (por asistencia completada, permiso justificado o
 * cancelación administrativa) dentro de una única transacción:
 * - Actualiza `shift_sessions` (deja de descontar como `NO_SHOW`).
 * - Conserva el responsable (`ownerId`) y agrega la regularización al historial
 *   inmutable (`metadata.history`).
 * - Cierra la excepción canónica con auditoría `AUD-02` (`EXCEPTION` +
 *   registro de regularización); si falla la auditoría, revierte todo.
 */
export async function regularizeAbsence(
  params: {
    companyId: string;
    sessionId: string;
    actorId: string;
    mode: AbsenceRegularizationMode;
    reason: string;
    checkInTime?: Date | null;
    checkOutTime?: Date | null;
    leaveRequestId?: string | null;
    now?: Date;
  },
  executor?: DbExecutor,
): Promise<{
  session: typeof shiftSessions.$inferSelect;
  exception: ExceptionRow | null;
}> {
  const auditReason = buildAbsenceAuditReason({
    action: "REGULARIZE",
    mode: params.mode,
    notes: params.reason,
    sessionId: params.sessionId,
  });

  const run = async (tx: DbExecutor) => {
    const loaded = await loadScopedSession(params.companyId, params.sessionId, tx);
    const { session } = loaded;

    if (params.actorId === session.userId) {
      throw ApiError.forbidden(
        "Segregación de funciones: un colaborador no puede regularizar su propia ausencia.",
      );
    }

    const now = params.now ?? new Date();
    const targetStatus =
      params.mode === "ATTENDANCE_COMPLETED" ? "COMPLETED" : "CANCELLED";

    const existingFlags =
      session.complianceFlags && typeof session.complianceFlags === "object"
        ? (session.complianceFlags as Record<string, unknown>)
        : {};

    const [updatedSession] = await tx
      .update(shiftSessions)
      .set({
        status: targetStatus,
        requiresApproval: false,
        approvedBy: params.actorId,
        approvedAt: now,
        ...(params.checkInTime ? { checkInTime: params.checkInTime } : {}),
        ...(params.checkOutTime ? { checkOutTime: params.checkOutTime, endedAt: params.checkOutTime } : {}),
        notes: auditReason,
        complianceFlags: {
          ...existingFlags,
          absenceRegularized: true,
          regularizationMode: params.mode,
          regularizedBy: params.actorId,
          regularizedAt: now.toISOString(),
          ...(params.leaveRequestId ? { leaveRequestId: params.leaveRequestId } : {}),
        },
      })
      .where(
        and(
          eq(shiftSessions.id, session.id),
          eq(shiftSessions.branchId, session.branchId),
        ),
      )
      .returning();

    const existing = await ExceptionService.getBySubject(
      params.companyId,
      ABSENCE_EXCEPTION_SUBJECT_TYPE,
      session.id,
      tx,
    );

    let closedException: ExceptionRow | null = existing;

    if (existing) {
      const existingMeta =
        typeof existing.metadata === "object" && existing.metadata !== null
          ? (existing.metadata as Record<string, unknown>)
          : {};

      const historyEvent =
        params.mode === "ATTENDANCE_COMPLETED"
          ? "REGULARIZED_ATTENDANCE"
          : params.mode === "JUSTIFIED_LEAVE"
            ? "JUSTIFIED_LEAVE"
            : "CANCELLED";

      const targetClassification =
        params.mode === "JUSTIFIED_LEAVE"
          ? "COVERED_BY_APPROVED_LEAVE"
          : "REGULARIZED_ATTENDANCE";

      const nextHistory = appendAbsenceHistory(existingMeta.history, {
        at: now.toISOString(),
        event: historyEvent,
        actorId: params.actorId,
        previousStatus: session.status ?? "NO_SHOW",
        newStatus: targetStatus,
        classification: targetClassification,
        ownerId: existing.ownerId,
        reason: auditReason,
        leaveRequestId: params.leaveRequestId ?? null,
      });

      await tx
        .update(exceptions)
        .set({
          metadata: {
            ...existingMeta,
            sourceStatus: targetStatus,
            classification: targetClassification,
            isApprovedAbsence: false,
            isPendingAttendance: false,
            payrollImpact: params.mode === "JUSTIFIED_LEAVE" ? "COVERED_LEAVE" : "NONE",
            responsibleOwnerId: existing.ownerId,
            regularizedBy: params.actorId,
            regularizedAt: now.toISOString(),
            regularizationMode: params.mode,
            leaveRequestId: params.leaveRequestId ?? null,
            history: nextHistory,
          },
          updatedAt: now,
        })
        .where(
          and(
            eq(exceptions.id, existing.id),
            eq(exceptions.companyId, params.companyId),
          ),
        );

      if (!isTerminal(existing.status)) {
        if (existing.status === "VERIFIED") {
          closedException = await ExceptionService.close(
            existing.id,
            params.companyId,
            params.actorId,
            tx,
            { expectedStatus: "VERIFIED" },
          );
        } else if (
          existing.status === "RESOLVED" &&
          existing.resolvedBy &&
          existing.resolvedBy !== params.actorId
        ) {
          await ExceptionService.verify(
            existing.id,
            params.companyId,
            params.actorId,
            tx,
            { expectedStatus: "RESOLVED" },
          );
          closedException = await ExceptionService.close(
            existing.id,
            params.companyId,
            params.actorId,
            tx,
            { expectedStatus: "VERIFIED" },
          );
        } else {
          closedException = await ExceptionService.cancel(
            existing.id,
            params.companyId,
            params.actorId,
            auditReason,
            tx,
            { expectedStatus: existing.status },
          );
        }
      } else {
        closedException = await ExceptionService.getById(
          existing.id,
          params.companyId,
          tx,
        );
      }
    }

    await AuditService.logCriticalEmployeeAction(
      {
        userId: session.userId,
        performedBy: params.actorId,
        action: "UPDATE",
        entityType: "ATTENDANCE_REGULARIZATION",
        entityId: session.id,
        oldValue: {
          status: session.status,
          requiresApproval: session.requiresApproval,
          approvedBy: session.approvedBy,
          approvedAt: session.approvedAt,
          exceptionId: existing?.id ?? null,
          exceptionOwnerId: existing?.ownerId ?? null,
        },
        newValue: {
          status: updatedSession.status,
          mode: params.mode,
          approvedBy: updatedSession.approvedBy,
          approvedAt: updatedSession.approvedAt,
          leaveRequestId: params.leaveRequestId ?? null,
          exceptionId: closedException?.id ?? null,
          exceptionStatus: closedException?.status ?? null,
          exceptionOwnerId: closedException?.ownerId ?? null,
        },
        reason: auditReason,
        isCritical: true,
      },
      tx,
    );

    return { session: updatedSession, exception: closedException };
  };

  if (executor && executor !== db) return run(executor);
  return db.transaction(async (tx) => run(tx));
}
