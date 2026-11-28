/**
 * EXC-04.presupuesto — Reglas puras para excepciones de gasto fuera de presupuesto.
 *
 * Módulo sin acceso a DB: evalúa el cruce del 100% de la partida presupuestal,
 * construye la instantánea inmutable de la regla (`ruleSnapshot`), resuelve el
 * responsable determinista (respetando autoridad y segregación de funciones) y
 * forma el payload canónico para `exceptions` y el motivo de cierre `AUD-02`.
 */
import { roleIsAtLeast } from "@/lib/permissions";
import type { ExceptionSeverity } from "./exception-types";
import type { RaiseExceptionInput } from "./exception-service";

export const BUDGET_OVERRUN_SUBJECT_TYPE = "budget_overrun" as const;
export const BUDGET_OVERRUN_RULE_CODE = "BUDGET_EXCEEDED_100_PCT" as const;
export const BUDGET_OVERRUN_MIN_ROLE = "ADMIN" as const;
export const BUDGET_OVERRUN_CRITICAL_PERCENT = 120;

export interface BudgetOverrunRuleSnapshot {
  ruleCode: typeof BUDGET_OVERRUN_RULE_CODE;
  thresholdPercent: 100;
  month: string;
  costCenterId: string;
  costCenterCode: string | null;
  costCenterName: string | null;
  budgetedCents: number;
  committedBeforeCents: number;
  expenseAmountCents: number;
  committedAfterCents: number;
  overByCents: number;
  consumedPercent: number;
  requiredApproverRole: string;
  baseAmountRuleRole: string;
  baseAmountRuleId: string | null;
}

export interface OverbudgetRuleEvaluation {
  isOverbudget: boolean;
  budgetedCents: number;
  committedBeforeCents: number;
  committedAfterCents: number;
  overByCents: number;
  consumedPercent: number | null;
  requiredApproverRole: string;
  severity: ExceptionSeverity;
  ruleSnapshot: BudgetOverrunRuleSnapshot | null;
}

export interface BudgetExceptionOwnerCandidate {
  id: string;
  role: string | null;
  branchId: string | null;
  active?: boolean | null;
}

export interface BudgetExceptionClosureRecord {
  decision: "APPROVED" | "REJECTED";
  actorId: string;
  actorRole: string;
  reason: string;
  closedAt: string;
}

/**
 * Un gasto fuera de presupuesto exige al menos `ADMIN`, o el rol exigido por
 * la regla de monto si éste es más alto (p. ej. `OWNER` o `SUPER_ADMIN`).
 */
export function resolveEffectiveOverbudgetRole(amountRuleRole: string | null | undefined): string {
  const base = amountRuleRole || BUDGET_OVERRUN_MIN_ROLE;
  return roleIsAtLeast(base, BUDGET_OVERRUN_MIN_ROLE) ? base : BUDGET_OVERRUN_MIN_ROLE;
}

/**
 * Evalúa si un gasto de `expenseAmountCents` supera el 100% del presupuesto
 * mensual capturado para `(branchId, costCenterId, month)`.
 * Sin partida (`costCenterId === null`) o sin presupuesto (`budgetedCents <= 0`)
 * no se inventa una excepción de sobre-presupuesto.
 */
export function evaluateOverbudgetRule(params: {
  budgetedCents: number | null;
  committedBeforeCents: number;
  expenseAmountCents: number;
  month: string;
  costCenterId: string | null;
  costCenterCode?: string | null;
  costCenterName?: string | null;
  amountRuleRole: string;
  amountRuleId?: string | null;
}): OverbudgetRuleEvaluation {
  const budgetedSafe = Math.max(0, params.budgetedCents ?? 0);
  const committedBefore = Math.max(0, params.committedBeforeCents);
  const amount = Math.max(0, params.expenseAmountCents);
  const committedAfter = committedBefore + amount;

  if (!params.costCenterId || budgetedSafe <= 0 || committedAfter <= budgetedSafe) {
    const consumedPercent =
      budgetedSafe > 0 ? Math.round((committedAfter / budgetedSafe) * 1000) / 10 : null;
    return {
      isOverbudget: false,
      budgetedCents: budgetedSafe,
      committedBeforeCents: committedBefore,
      committedAfterCents: committedAfter,
      overByCents: 0,
      consumedPercent,
      requiredApproverRole: params.amountRuleRole,
      severity: "warning",
      ruleSnapshot: null,
    };
  }

  const overByCents = committedAfter - budgetedSafe;
  const consumedPercent = Math.round((committedAfter / budgetedSafe) * 1000) / 10;
  const requiredApproverRole = resolveEffectiveOverbudgetRole(params.amountRuleRole);
  const severity: ExceptionSeverity =
    consumedPercent >= BUDGET_OVERRUN_CRITICAL_PERCENT ? "critical" : "high";

  return {
    isOverbudget: true,
    budgetedCents: budgetedSafe,
    committedBeforeCents: committedBefore,
    committedAfterCents: committedAfter,
    overByCents,
    consumedPercent,
    requiredApproverRole,
    severity,
    ruleSnapshot: {
      ruleCode: BUDGET_OVERRUN_RULE_CODE,
      thresholdPercent: 100,
      month: params.month,
      costCenterId: params.costCenterId,
      costCenterCode: params.costCenterCode ?? null,
      costCenterName: params.costCenterName ?? null,
      budgetedCents: budgetedSafe,
      committedBeforeCents: committedBefore,
      expenseAmountCents: amount,
      committedAfterCents: committedAfter,
      overByCents,
      consumedPercent,
      requiredApproverRole,
      baseAmountRuleRole: params.amountRuleRole,
      baseAmountRuleId: params.amountRuleId ?? null,
    },
  };
}

const ROLE_PREFERENCE: Record<string, number> = {
  ADMIN: 0,
  OWNER: 1,
  SUPER_ADMIN: 2,
  GERENTE: 3,
  SUPERVISOR: 4,
};

/**
 * Selecciona determinísticamente el responsable (`ownerId`) de la excepción de
 * presupuesto dentro de los usuarios activos de la misma empresa:
 * 1. Usuario con rol >= `requiredRole` distinto de quien registró el gasto
 *    (priorizando ADMIN operativo antes que OWNER/SUPER_ADMIN).
 * 2. Respaldo: gerente de la sucursal distinto de `requestedBy`.
 * 3. Respaldo ejecutivo: usuario con rol >= `requiredRole` (ej. único OWNER).
 * 4. Último respaldo: `branchManagerId` si está activo, si no `null`.
 */
export function resolveBudgetExceptionOwnerId(
  candidates: BudgetExceptionOwnerCandidate[],
  opts: {
    branchId: string;
    branchManagerId?: string | null;
    requiredRole: string;
    requestedBy: string;
  },
): string | null {
  const active = candidates.filter((u) => u.active !== false);

  const sortByAuthorityPreference = (
    a: BudgetExceptionOwnerCandidate,
    b: BudgetExceptionOwnerCandidate,
  ) => {
    const rankA = ROLE_PREFERENCE[a.role ?? ""] ?? 99;
    const rankB = ROLE_PREFERENCE[b.role ?? ""] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.id.localeCompare(b.id);
  };

  const eligibleAuthority = active
    .filter((u) => Boolean(u.role && roleIsAtLeast(u.role, opts.requiredRole)))
    .sort(sortByAuthorityPreference);

  const segregated = eligibleAuthority.find((u) => u.id !== opts.requestedBy);
  if (segregated) return segregated.id;

  if (opts.branchManagerId && opts.branchManagerId !== opts.requestedBy) {
    const mgr = active.find((u) => u.id === opts.branchManagerId);
    if (mgr) return mgr.id;
  }

  if (eligibleAuthority.length > 0) {
    return eligibleAuthority[0].id;
  }

  if (opts.branchManagerId) {
    const mgr = active.find((u) => u.id === opts.branchManagerId);
    if (mgr) return mgr.id;
  }

  return null;
}

function formatMxn(cents: number): string {
  return `$${(cents / 100).toFixed(2)} MXN`;
}

/**
 * Construye el `RaiseExceptionInput` canónico para un gasto fuera de
 * presupuesto. Si ya existe `existingMetadata.ruleSnapshot` o `existingOwnerId`,
 * los conserva sin sobrescribir la regla ni el responsable originales.
 */
export function buildBudgetOverrunExceptionInput(params: {
  companyId: string;
  branchId: string;
  expenseId: string;
  category: string;
  description: string;
  amountCents: number;
  requestedBy: string;
  sourceStatus: string;
  evaluation: OverbudgetRuleEvaluation;
  ownerId: string | null;
  actorId?: string | null;
  existingMetadata?: Record<string, unknown> | null;
  existingOwnerId?: string | null;
}): RaiseExceptionInput {
  const existingSnap =
    params.existingMetadata &&
    typeof params.existingMetadata.ruleSnapshot === "object" &&
    params.existingMetadata.ruleSnapshot !== null
      ? (params.existingMetadata.ruleSnapshot as BudgetOverrunRuleSnapshot)
      : null;

  const preservedRuleSnapshot = existingSnap ?? params.evaluation.ruleSnapshot;
  const preservedOwnerId = params.existingOwnerId ?? params.ownerId;

  const costCenterLabel = preservedRuleSnapshot?.costCenterCode
    ? `${preservedRuleSnapshot.costCenterCode}${preservedRuleSnapshot.costCenterName ? ` · ${preservedRuleSnapshot.costCenterName}` : ""}`
    : preservedRuleSnapshot?.costCenterId ?? "partida presupuestal";

  const overByCents = preservedRuleSnapshot?.overByCents ?? params.evaluation.overByCents;
  const month = preservedRuleSnapshot?.month ?? "";
  const requiredRole =
    preservedRuleSnapshot?.requiredApproverRole ?? params.evaluation.requiredApproverRole;

  const reason = `Gasto fuera de presupuesto en ${costCenterLabel}${month ? ` (${month})` : ""}: excede por ${formatMxn(overByCents)} — requiere autorización ${requiredRole}`;

  return {
    companyId: params.companyId,
    branchId: params.branchId,
    domain: "finanzas",
    qsrCategory: "DINERO",
    severity: params.evaluation.severity,
    subjectType: BUDGET_OVERRUN_SUBJECT_TYPE,
    subjectId: params.expenseId,
    reason,
    ownerId: preservedOwnerId,
    actorId: params.actorId ?? null,
    actionMeta: {
      type: "RESOLVE_ALERT",
      label: "Revisar Autorización de Sobre-presupuesto",
      url: `/dashboard/finance/expenses?focus=${params.expenseId}`,
    },
    metadata: {
      ...(params.existingMetadata ?? {}),
      title: `Gasto fuera de presupuesto (${params.category})`,
      description: params.description,
      expenseId: params.expenseId,
      category: params.category,
      amountCents: params.amountCents,
      requestedBy: params.requestedBy,
      responsibleOwnerId: preservedOwnerId,
      requiredApproverRole: requiredRole,
      sourceStatus: params.sourceStatus,
      ruleSnapshot: preservedRuleSnapshot,
      impact: `Excedente presupuestal de ${formatMxn(overByCents)}`,
    },
  };
}

/**
 * Genera el motivo obligatorio (>= 4 caracteres, AUD-02) para el cierre
 * auditado de una excepción de presupuesto al aprobar o rechazar el gasto.
 */
export function buildBudgetExceptionClosureReason(params: {
  decision: "APPROVED" | "REJECTED";
  approverRole: string;
  notes?: string | null;
  expenseId: string;
}): string {
  const cleanNotes = params.notes?.trim();
  if (params.decision === "APPROVED") {
    return cleanNotes && cleanNotes.length >= 4
      ? `Autorización de gasto fuera de presupuesto (${params.approverRole}): ${cleanNotes}`
      : `Autorización de gasto fuera de presupuesto por ${params.approverRole} (gasto ${params.expenseId})`;
  }
  return cleanNotes && cleanNotes.length >= 4
    ? `Rechazo de gasto fuera de presupuesto (${params.approverRole}): ${cleanNotes}`
    : `Rechazo de gasto fuera de presupuesto por ${params.approverRole} (gasto ${params.expenseId})`;
}
