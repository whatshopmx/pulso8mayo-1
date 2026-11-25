/**
 * NOM-06 — Bloqueo de resultados incompletos y justificación explícita de ceros.
 *
 * Reglas:
 * - Todo importe cero en percepciones/deducciones debe tener una causa válida y
 *   verificable (`SIN_HORAS_EXTRA`, `SIN_VACACIONES`, `BASE_GRAVABLE_CERO`,
 *   `CUBIERTO_POR_SUBSIDIO_EMPLEO`, `ART_36_LSS_SALARIO_MINIMO_EXENTO`, etc.).
 * - Cualquier ausencia de datos, fallo de lectura (`QUERY_ERROR`), conflicto
 *   histórico (`CONFLICT`) o falta de tabla oficial (`MISSING_CONFIG` / `MISSING_BASE`)
 *   bloquea aprobación y timbrado con código, dominio y acción recuperable.
 */

import type { OrdinaryIsrBreakdown } from "./payroll-isr-service";
import type {
  EmployerSocialSecurityBreakdown,
  WorkerImssBreakdown,
} from "./payroll-imss-service";
import type { PayrollAdjustmentsBreakdown } from "./payroll-adjustments-service";
import type { PayrollLoansBreakdown } from "./payroll-loans-service";

export interface PayrollBlockingIssue {
  code: string;
  domain:
    | "VACATIONS"
    | "LEAVES"
    | "ADJUSTMENTS"
    | "ISR"
    | "IMSS_WORKER"
    | "LOANS"
    | "EMPLOYER_BURDEN";
  message: string;
  recoveryAction: string;
}

export interface PayrollZeroJustification {
  concept: string;
  amountCents: 0;
  justification: string;
  valid: boolean;
}

export interface PayrollCompletenessReport {
  canApprove: boolean;
  canStamp: boolean;
  blockingIssues: PayrollBlockingIssue[];
  zeroJustifications: PayrollZeroJustification[];
}

export interface EvaluatePayrollCompletenessInput {
  overtimeBreakdown?: {
    totalPayCents: number;
    justification: string;
  };
  vacationBreakdown?: {
    hasVacations: boolean;
    vacationPrimeCents: number;
    vacationBalanceStatus: "AVAILABLE" | "MISSING" | "QUERY_ERROR" | "CONFLICT";
    vacationRequestsStatus?: "AVAILABLE" | "QUERY_ERROR";
    vacationSource?: "VERIFIED_HISTORY" | "LEGACY" | "LEGACY_BALANCE";
    justification: string;
  };
  leaveBreakdown?: {
    leavesStatus: "AVAILABLE" | "QUERY_ERROR";
  };
  adjustmentsBreakdown?: Pick<PayrollAdjustmentsBreakdown, "status">;
  isrBreakdown?: Pick<
    OrdinaryIsrBreakdown,
    "status" | "isrRetenidoCents" | "justification" | "blockingReason"
  >;
  imssWorkerBreakdown?: Pick<
    WorkerImssBreakdown,
    "status" | "totalWorkerImssCents" | "justification" | "blockingReason"
  >;
  loansBreakdown?: Pick<PayrollLoansBreakdown, "status">;
  employerSocialSecurityBreakdown?: Pick<
    EmployerSocialSecurityBreakdown,
    "status" | "blockingReason"
  >;
}

export function evaluatePayrollCompleteness(
  input: EvaluatePayrollCompletenessInput
): PayrollCompletenessReport {
  const blockingIssues: PayrollBlockingIssue[] = [];
  const zeroJustifications: PayrollZeroJustification[] = [];

  // 1. Horas extra
  if (input.overtimeBreakdown && input.overtimeBreakdown.totalPayCents === 0) {
    zeroJustifications.push({
      concept: "OVERTIME",
      amountCents: 0,
      justification: input.overtimeBreakdown.justification,
      valid: input.overtimeBreakdown.justification === "SIN_HORAS_EXTRA",
    });
  }

  // 2. Vacaciones
  if (input.vacationBreakdown) {
    const v = input.vacationBreakdown;
    if (v.vacationRequestsStatus === "QUERY_ERROR") {
      blockingIssues.push({
        code: "VACATION_REQUESTS_QUERY_ERROR",
        domain: "VACATIONS",
        message: "No se pudieron consultar las solicitudes de vacaciones del empleado.",
        recoveryAction:
          "Reintenta la validación una vez restablecida la lectura de vacaciones antes de aprobar.",
      });
    }
    if (v.vacationBalanceStatus === "QUERY_ERROR") {
      blockingIssues.push({
        code: "VACATION_BALANCE_QUERY_ERROR",
        domain: "VACATIONS",
        message: "Error al consultar el saldo o historial de vacaciones del empleado.",
        recoveryAction:
          "Verifica permisos y disponibilidad de la fuente de vacaciones y vuelve a calcular.",
      });
    } else if (v.vacationBalanceStatus === "CONFLICT") {
      blockingIssues.push({
        code: "VACATION_HISTORY_CONFLICT",
        domain: "VACATIONS",
        message: "Existe un conflicto en el historial verificado de vacaciones del empleado.",
        recoveryAction:
          "Registra un sucesor o corrige el solapamiento en /dashboard/labor antes de aprobar.",
      });
    } else if (
      v.vacationBalanceStatus === "MISSING" &&
      (v.hasVacations || v.vacationSource === "VERIFIED_HISTORY")
    ) {
      blockingIssues.push({
        code: "VACATION_BALANCE_MISSING",
        domain: "VACATIONS",
        message:
          "Falta apertura o cobertura verificada de saldo de vacaciones para el período consultado.",
        recoveryAction:
          "Captura la apertura y créditos de vacaciones del empleado en Administración de Vacaciones.",
      });
    } else if (v.vacationPrimeCents === 0) {
      zeroJustifications.push({
        concept: "VACATION_PRIME",
        amountCents: 0,
        justification: v.justification,
        valid:
          v.justification === "SIN_VACACIONES" ||
          v.justification === "EXCEEDED_VACATION_BALANCE",
      });
    }
  }

  // 3. Permisos / licencias
  if (input.leaveBreakdown && input.leaveBreakdown.leavesStatus === "QUERY_ERROR") {
    blockingIssues.push({
      code: "LEAVES_QUERY_ERROR",
      domain: "LEAVES",
      message: "No se pudieron consultar los permisos/licencias del empleado.",
      recoveryAction: "Restablece la consulta de permisos y recalcula la nómina.",
    });
  }

  // 4. Bonos e incidencias
  if (input.adjustmentsBreakdown && input.adjustmentsBreakdown.status === "QUERY_ERROR") {
    blockingIssues.push({
      code: "ADJUSTMENTS_QUERY_ERROR",
      domain: "ADJUSTMENTS",
      message: "No se pudieron leer los bonos e incidencias aprobadas del período.",
      recoveryAction: "Verifica la tabla payroll_adjustments y vuelve a calcular el período.",
    });
  }

  // 5. ISR ordinario
  if (input.isrBreakdown) {
    if (input.isrBreakdown.status === "MISSING_CONFIG") {
      blockingIssues.push({
        code: "MISSING_ISR_CONFIG",
        domain: "ISR",
        message:
          input.isrBreakdown.blockingReason ??
          "Falta tarifa oficial de ISR Art. 96 LISR vigente para el período.",
        recoveryAction:
          "Actualiza el catálogo de tarifas oficiales SAT RMF del ejercicio antes de aprobar o timbrar.",
      });
    } else if (input.isrBreakdown.isrRetenidoCents === 0) {
      zeroJustifications.push({
        concept: "ISR",
        amountCents: 0,
        justification: input.isrBreakdown.justification,
        valid:
          input.isrBreakdown.justification === "BASE_GRAVABLE_CERO" ||
          input.isrBreakdown.justification === "CUBIERTO_POR_SUBSIDIO_EMPLEO",
      });
    }
  }

  // 6. IMSS obrero
  if (input.imssWorkerBreakdown) {
    if (input.imssWorkerBreakdown.status === "MISSING_CONFIG") {
      blockingIssues.push({
        code: "MISSING_IMSS_CONFIG",
        domain: "IMSS_WORKER",
        message:
          input.imssWorkerBreakdown.blockingReason ??
          "Falta UMA oficial vigente para calcular deducción obrera IMSS.",
        recoveryAction:
          "Registra la UMA oficial publicada por INEGI para el ejercicio del período.",
      });
    } else if (input.imssWorkerBreakdown.status === "MISSING_BASE") {
      blockingIssues.push({
        code: "MISSING_IMSS_BASE",
        domain: "IMSS_WORKER",
        message:
          input.imssWorkerBreakdown.blockingReason ??
          "Falta salario diario o salario mínimo válido para calcular el SBC.",
        recoveryAction:
          "Completa el salario diario en el contrato vigente del empleado y recalcula.",
      });
    } else if (input.imssWorkerBreakdown.totalWorkerImssCents === 0) {
      zeroJustifications.push({
        concept: "IMSS_WORKER",
        amountCents: 0,
        justification: input.imssWorkerBreakdown.justification,
        valid:
          input.imssWorkerBreakdown.justification === "ART_36_LSS_SALARIO_MINIMO_EXENTO" ||
          input.imssWorkerBreakdown.justification === "SIN_DIAS_COTIZADOS",
      });
    }
  }

  // 7. Préstamos y descuentos
  if (input.loansBreakdown && input.loansBreakdown.status === "QUERY_ERROR") {
    blockingIssues.push({
      code: "LOANS_QUERY_ERROR",
      domain: "LOANS",
      message: "No se pudieron consultar los préstamos o descuentos autorizados del empleado.",
      recoveryAction: "Verifica la disponibilidad de payroll_loans y vuelve a calcular.",
    });
  }

  // 8. Carga patronal
  if (input.employerSocialSecurityBreakdown) {
    if (input.employerSocialSecurityBreakdown.status === "MISSING_CONFIG") {
      blockingIssues.push({
        code: "MISSING_EMPLOYER_BURDEN_CONFIG",
        domain: "EMPLOYER_BURDEN",
        message:
          input.employerSocialSecurityBreakdown.blockingReason ??
          "Falta configuración oficial de UMA para calcular carga patronal.",
        recoveryAction:
          "Registra la UMA oficial vigente del ejercicio antes de aprobar el período.",
      });
    } else if (input.employerSocialSecurityBreakdown.status === "MISSING_BASE") {
      blockingIssues.push({
        code: "MISSING_EMPLOYER_BURDEN_BASE",
        domain: "EMPLOYER_BURDEN",
        message:
          input.employerSocialSecurityBreakdown.blockingReason ??
          "Falta base salarial válida para calcular carga patronal.",
        recoveryAction:
          "Completa el salario base del contrato activo del empleado y recalcula.",
      });
    }
  }

  const canApprove = blockingIssues.length === 0;
  return {
    canApprove,
    canStamp: canApprove,
    blockingIssues,
    zeroJustifications,
  };
}
