/**
 * EXC-04.ausencia — Reglas puras para clasificación, responsable e historial de
 * excepciones de ausencia laboral (`employee_absence`).
 *
 * Módulo sin acceso a DB:
 * - Distingue explícitamente una **falta aprobada** (`APPROVED_ABSENCE`: `NO_SHOW`
 *   confirmada que impacta días pagaderos en NOM-02.a) de **asistencia pendiente**
 *   (`PENDING_ATTENDANCE` o `PENDING_ABSENCE_REVIEW`: sesión abierta, en curso o
 *   requiriendo aprobación sin `approvedAt`), y de ausencias cubiertas por permiso
 *   o vacación aprobados (`COVERED_BY_APPROVED_LEAVE`).
 * - Selecciona un responsable determinista distinto del colaborador ausente.
 * - Mantiene historial append-only sin duplicar detecciones repetidas y conserva
 *   `ownerId` e historial original en cada detección/regularización.
 */
import type { ExceptionSeverity } from "./exception-types";
import type { RaiseExceptionInput } from "./exception-service";

export const ABSENCE_EXCEPTION_SUBJECT_TYPE = "employee_absence" as const;

export type AbsenceClassification =
  | "APPROVED_ABSENCE"
  | "PENDING_ABSENCE_REVIEW"
  | "PENDING_ATTENDANCE"
  | "COVERED_BY_APPROVED_LEAVE"
  | "REGULARIZED_ATTENDANCE";

export type AbsenceHistoryEvent =
  | "DETECTED"
  | "APPROVED_ABSENCE"
  | "REGULARIZED_ATTENDANCE"
  | "JUSTIFIED_LEAVE"
  | "CANCELLED";

export interface AbsenceHistoryEntry {
  at: string;
  event: AbsenceHistoryEvent;
  actorId: string | null;
  previousStatus: string | null;
  newStatus: string;
  classification: AbsenceClassification;
  ownerId: string | null;
  reason: string;
  leaveRequestId?: string | null;
}

export interface AbsenceClassificationResult {
  classification: AbsenceClassification;
  /** Solo true cuando la falta ya está confirmada/aprobada para descontar en NOM-02.a. */
  isApprovedAbsence: boolean;
  /** True cuando la sesión aún está pendiente de cierre o aprobación de manager. */
  isPendingAttendance: boolean;
  /** True cuando corresponde mantener una excepción canónica de ausencia abierta. */
  shouldRaiseException: boolean;
  severity: ExceptionSeverity;
  label: string;
  payrollImpact: "DEDUCT_UNPAID_ABSENCE" | "BLOCK_PENDING_ATTENDANCE" | "COVERED_LEAVE" | "NONE";
}

export interface AbsenceOwnerCandidate {
  id: string;
  role: string | null;
  branchId: string | null;
  active?: boolean | null;
}

/** Convierte Date o string ISO a fecha civil `YYYY-MM-DD`. */
export function toCivilDate(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === "string") {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return value.toISOString().slice(0, 10);
}

/** Verifica si `civilDate` cae dentro de alguno de los rangos inclusivos aprobados. */
export function isDateCoveredByApprovedRange(
  civilDate: string,
  ranges: Array<{ startDate: Date | string; endDate: Date | string; status?: string | null }>,
): boolean {
  for (const r of ranges) {
    if (r.status && r.status.toUpperCase() !== "APPROVED") continue;
    const start = toCivilDate(r.startDate);
    const end = toCivilDate(r.endDate);
    if (civilDate >= start && civilDate <= end) {
      return true;
    }
  }
  return false;
}

/**
 * Clasifica una sesión de turno alineado con NOM-02.a (`resolveAttendanceForPeriod`):
 * - Si el día está cubierto por vacación o permiso `APPROVED` → `COVERED_BY_APPROVED_LEAVE`
 *   (no es falta injustificada).
 * - `NO_SHOW` confirmado (`!requiresApproval || approvedAt != null`) → `APPROVED_ABSENCE`
 *   (descuenta en NOM-02.a; distinto de asistencia pendiente).
 * - `NO_SHOW` con `requiresApproval === true && !approvedAt` → `PENDING_ABSENCE_REVIEW`
 *   (asistencia pendiente de confirmación/regularización; NO cuenta como falta aprobada).
 * - `PENDING`, `ACTIVE`, o `COMPLETED` con `requiresApproval && !approvedAt` → `PENDING_ATTENDANCE`
 *   (asistencia pendiente; nunca se confunde con falta aprobada).
 * - `COMPLETED` aprobado o `CANCELLED` → `REGULARIZED_ATTENDANCE`.
 */
export function classifyShiftAbsenceState(params: {
  status: string | null | undefined;
  requiresApproval?: boolean | null;
  approvedAt?: Date | string | null;
  sessionDate: string;
  approvedLeaveRanges?: Array<{
    startDate: Date | string;
    endDate: Date | string;
    status?: string | null;
  }>;
}): AbsenceClassificationResult {
  const normalized = (params.status || "PENDING").toUpperCase();
  const isApproved = params.approvedAt != null;
  const needsApproval = Boolean(params.requiresApproval);
  const covered =
    params.approvedLeaveRanges && params.approvedLeaveRanges.length > 0
      ? isDateCoveredByApprovedRange(params.sessionDate, params.approvedLeaveRanges)
      : false;

  if (normalized === "NO_SHOW") {
    if (covered) {
      return {
        classification: "COVERED_BY_APPROVED_LEAVE",
        isApprovedAbsence: false,
        isPendingAttendance: false,
        shouldRaiseException: false,
        severity: "info",
        label: "Ausencia cubierta por permiso o vacación aprobada",
        payrollImpact: "COVERED_LEAVE",
      };
    }

    if (needsApproval && !isApproved) {
      return {
        classification: "PENDING_ABSENCE_REVIEW",
        isApprovedAbsence: false,
        isPendingAttendance: true,
        shouldRaiseException: true,
        severity: "warning",
        label: "Ausencia detectada pendiente de aprobación o regularización",
        payrollImpact: "BLOCK_PENDING_ATTENDANCE",
      };
    }

    return {
      classification: "APPROVED_ABSENCE",
      isApprovedAbsence: true,
      isPendingAttendance: false,
      shouldRaiseException: true,
      severity: "high",
      label: "Falta aprobada (NO_SHOW confirmado)",
      payrollImpact: "DEDUCT_UNPAID_ABSENCE",
    };
  }

  if (
    normalized === "PENDING" ||
    normalized === "ACTIVE" ||
    (normalized === "COMPLETED" && needsApproval && !isApproved)
  ) {
    return {
      classification: "PENDING_ATTENDANCE",
      isApprovedAbsence: false,
      isPendingAttendance: true,
      shouldRaiseException: false,
      severity: "warning",
      label: "Asistencia pendiente de cierre o aprobación",
      payrollImpact: "BLOCK_PENDING_ATTENDANCE",
    };
  }

  return {
    classification: "REGULARIZED_ATTENDANCE",
    isApprovedAbsence: false,
    isPendingAttendance: false,
    shouldRaiseException: false,
    severity: "info",
    label: "Asistencia regularizada",
    payrollImpact: "NONE",
  };
}

const ABSENCE_OWNER_ROLE_RANK: Record<string, number> = {
  GERENTE: 0,
  SUPERVISOR: 1,
  ADMIN: 2,
  OWNER: 3,
  SUPER_ADMIN: 4,
};

/**
 * Selecciona el responsable determinista de una excepción de ausencia dentro
 * de la empresa (nunca el propio empleado ausente):
 * 1. Supervisor directo activo (`supervisorId`).
 * 2. Gerente de sucursal activo (`branchManagerId`).
 * 3. Usuario operativo activo de la sucursal (`GERENTE`/`SUPERVISOR`) o empresa (`ADMIN`/`OWNER`).
 */
export function resolveAbsenceOwnerId(
  candidates: AbsenceOwnerCandidate[],
  opts: {
    branchId: string;
    employeeUserId: string;
    supervisorId?: string | null;
    branchManagerId?: string | null;
  },
): string | null {
  const activeDistinct = candidates.filter(
    (u) => u.active !== false && u.id !== opts.employeeUserId,
  );

  if (opts.supervisorId && opts.supervisorId !== opts.employeeUserId) {
    const sup = activeDistinct.find((u) => u.id === opts.supervisorId);
    if (sup) return sup.id;
  }

  if (opts.branchManagerId && opts.branchManagerId !== opts.employeeUserId) {
    const mgr = activeDistinct.find((u) => u.id === opts.branchManagerId);
    if (mgr) return mgr.id;
  }

  const ranked = activeDistinct
    .filter((u) => u.role && u.role in ABSENCE_OWNER_ROLE_RANK)
    .filter((u) => {
      if (u.role === "GERENTE" || u.role === "SUPERVISOR") {
        return u.branchId === opts.branchId;
      }
      return true;
    })
    .sort((a, b) => {
      const ra = ABSENCE_OWNER_ROLE_RANK[a.role ?? ""] ?? 99;
      const rb = ABSENCE_OWNER_ROLE_RANK[b.role ?? ""] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });

  return ranked[0]?.id ?? null;
}

/**
 * Anexa un evento al historial inmutable de la ausencia.
 * Evita duplicar detecciones repetidas consecutivas idénticas (idempotencia de sync).
 */
export function appendAbsenceHistory(
  existing: unknown,
  entry: AbsenceHistoryEntry,
): AbsenceHistoryEntry[] {
  const list: AbsenceHistoryEntry[] = Array.isArray(existing)
    ? (existing.filter(
        (e): e is AbsenceHistoryEntry =>
          typeof e === "object" && e !== null && typeof (e as AbsenceHistoryEntry).event === "string",
      ) as AbsenceHistoryEntry[])
    : [];

  const last = list[list.length - 1];
  if (
    last &&
    entry.event === "DETECTED" &&
    last.event === "DETECTED" &&
    last.classification === entry.classification &&
    last.newStatus === entry.newStatus
  ) {
    return list;
  }

  return [...list, entry];
}

export function buildAbsenceExceptionInput(params: {
  companyId: string;
  branchId: string;
  sessionId: string;
  employeeId: string;
  employeeName?: string | null;
  shiftDate: string;
  sourceStatus: string;
  classification: AbsenceClassificationResult;
  ownerId: string | null;
  actorId?: string | null;
  historyEntry: AbsenceHistoryEntry;
  existingMetadata?: Record<string, unknown> | null;
  existingOwnerId?: string | null;
}): RaiseExceptionInput {
  const preservedOwnerId = params.existingOwnerId ?? params.ownerId;
  const existingMeta = params.existingMetadata ?? {};
  const nextHistory = appendAbsenceHistory(existingMeta.history, {
    ...params.historyEntry,
    ownerId: preservedOwnerId,
  });

  const employeeLabel = params.employeeName?.trim() || params.employeeId;
  const reason =
    params.classification.classification === "APPROVED_ABSENCE"
      ? `Falta aprobada de ${employeeLabel} (${params.shiftDate}): ${params.historyEntry.reason}`
      : `Ausencia pendiente de revisión de ${employeeLabel} (${params.shiftDate}): ${params.historyEntry.reason}`;

  return {
    companyId: params.companyId,
    branchId: params.branchId,
    domain: "personal",
    qsrCategory: "PERSONAL",
    severity: params.classification.severity,
    subjectType: ABSENCE_EXCEPTION_SUBJECT_TYPE,
    subjectId: params.sessionId,
    reason,
    ownerId: preservedOwnerId,
    actorId: params.actorId ?? null,
    actionMeta: {
      type: "AUTHORIZE_SHIFT",
      label: "Revisar o Regularizar Ausencia",
      url: `/dashboard/labor/attendance?sessionId=${params.sessionId}`,
    },
    metadata: {
      ...existingMeta,
      title:
        params.classification.classification === "APPROVED_ABSENCE"
          ? `Falta aprobada: ${employeeLabel}`
          : `Ausencia por revisar: ${employeeLabel}`,
      sessionId: params.sessionId,
      employeeId: params.employeeId,
      employeeName: employeeLabel,
      shiftDate: params.shiftDate,
      sourceStatus: params.sourceStatus,
      classification: params.classification.classification,
      isApprovedAbsence: params.classification.isApprovedAbsence,
      isPendingAttendance: params.classification.isPendingAttendance,
      payrollImpact: params.classification.payrollImpact,
      responsibleOwnerId: preservedOwnerId,
      detectedAt: existingMeta.detectedAt ?? params.historyEntry.at,
      history: nextHistory,
      impact:
        params.classification.classification === "APPROVED_ABSENCE"
          ? "Falta confirmada que descuenta día pagadero en nómina (NOM-02.a)"
          : "Asistencia pendiente de confirmación o regularización antes de nómina",
    },
  };
}

export function buildAbsenceAuditReason(params: {
  action: "DETECT" | "APPROVE_ABSENCE" | "REGULARIZE";
  mode?: string;
  notes?: string | null;
  sessionId: string;
}): string {
  const clean = params.notes?.trim();
  if (params.action === "DETECT") {
    return clean && clean.length >= 4
      ? `Detección de ausencia: ${clean}`
      : `Detección de ausencia laboral en sesión ${params.sessionId}`;
  }
  if (params.action === "APPROVE_ABSENCE") {
    return clean && clean.length >= 4
      ? `Confirmación de falta aprobada: ${clean}`
      : `Confirmación de falta aprobada en sesión ${params.sessionId}`;
  }
  const modeLabel = params.mode ? ` (${params.mode})` : "";
  return clean && clean.length >= 4
    ? `Regularización de ausencia${modeLabel}: ${clean}`
    : `Regularización de ausencia${modeLabel} en sesión ${params.sessionId}`;
}
