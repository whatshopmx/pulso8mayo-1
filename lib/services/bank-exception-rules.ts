/**
 * EXC-04.banco — Reglas puras para excepciones bancarias de pagos y depósitos
 * pendientes o discrepantes (`bank_reconciliation`).
 *
 * Garantías:
 * 1. Conserva la fuente original (`sourceKind`, `sourceTable`, `sourceId`,
 *    `sourceBankAccountId`, `direction`, `reference`, `description`) y la
 *    antigüedad (`valueDate`, `ageDays`, `firstDetectedAt`).
 * 2. Nunca oculta una diferencia aritmética o de monto (`differenceCents !== 0`):
 *    un cierre automático solo procede si `differenceCents === 0`; ante
 *    diferencia distinta de cero exige disposición explícita y motivo auditado
 *    (`AUD-02`), conservando siempre el valor exacto de `differenceCents`.
 */
import type { ExceptionSeverity } from "./exception-types";
import type { RaiseExceptionInput } from "./exception-service";

export const BANK_EXCEPTION_SUBJECT_TYPE = "bank_reconciliation" as const;
export const DEFAULT_BANK_PENDING_THRESHOLD_DAYS = 3;

export type BankExceptionSourceKind =
  | "BANK_OUTFLOW"
  | "BANK_DEPOSIT"
  | "PAYMENT_RUN_ITEM"
  | "GATEWAY_TRANSACTION";

export type BankDiscrepancyCode =
  | "PENDING_OVERDUE"
  | "AMOUNT_DIFFERENCE"
  | "GROUPED_DEPOSIT_UNSUPPORTED"
  | "MISSING_DESTINATION_ACCOUNT"
  | "ARITHMETIC_NET_MISMATCH"
  | "UNMATCHED_AFTER_CORRECTION";

export type BankDifferenceDisposition =
  | "EXACT_MATCH"
  | "EXPLAINED_FEE"
  | "WRITE_OFF"
  | "PENDING_ADJUSTMENT"
  | "IGNORED_WITH_REASON";

export interface BankSourceSnapshot {
  sourceKind: BankExceptionSourceKind;
  sourceTable: "bank_transactions" | "payment_run_items" | "gateway_transactions";
  sourceId: string;
  sourceBankAccountId: string | null;
  direction: "OUTFLOW" | "INFLOW";
  valueDate: string;
  amountCents: number;
  expectedAmountCents: number | null;
  differenceCents: number;
  discrepancyCode: BankDiscrepancyCode;
  reference: string | null;
  description: string | null;
}

export interface BankReconciliationTrace {
  reconciledAt: string;
  reconciledBy: string;
  matchedTargetType: "PAYMENT_RUN_ITEM" | "GATEWAY_TRANSACTION" | "MANUAL_DISPOSITION";
  matchedTargetId: string | null;
  bankAmountCents: number;
  targetAmountCents: number;
  differenceCents: number;
  disposition: BankDifferenceDisposition;
  notes: string;
}

export interface BankOwnerCandidate {
  id: string;
  role: string | null;
  active?: boolean | null;
}

export function buildBankSubjectId(
  sourceKind: BankExceptionSourceKind,
  sourceId: string,
): string {
  switch (sourceKind) {
    case "BANK_OUTFLOW":
    case "BANK_DEPOSIT":
      return `bank_tx:${sourceId}`;
    case "PAYMENT_RUN_ITEM":
      return `payment_item:${sourceId}`;
    case "GATEWAY_TRANSACTION":
      return `gateway_tx:${sourceId}`;
  }
}

/** Días calendario enteros transcurridos entre `valueDate` (YYYY-MM-DD) y `now`. */
export function computeBankAgingDays(valueDate: string, now: Date = new Date()): number {
  const isoDay = valueDate.slice(0, 10);
  const startMs = Date.parse(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(startMs)) return 0;
  const nowDay = now.toISOString().slice(0, 10);
  const nowMs = Date.parse(`${nowDay}T00:00:00Z`);
  return Math.max(0, Math.floor((nowMs - startMs) / 86_400_000));
}

export function classifyBankExceptionSeverity(params: {
  ageDays: number;
  differenceCents: number;
  discrepancyCode: BankDiscrepancyCode;
}): ExceptionSeverity {
  const absDiff = Math.abs(params.differenceCents);
  if (
    absDiff >= 50_000 ||
    params.ageDays >= 14 ||
    (params.discrepancyCode === "ARITHMETIC_NET_MISMATCH" && absDiff > 100)
  ) {
    return "critical";
  }
  if (
    absDiff > 0 ||
    params.ageDays >= 7 ||
    params.discrepancyCode === "GROUPED_DEPOSIT_UNSUPPORTED" ||
    params.discrepancyCode === "MISSING_DESTINATION_ACCOUNT" ||
    params.discrepancyCode === "AMOUNT_DIFFERENCE"
  ) {
    return "high";
  }
  return "warning";
}

const BANK_OWNER_ROLE_RANK: Record<string, number> = {
  ADMIN: 0,
  OWNER: 1,
  SUPER_ADMIN: 2,
  GERENTE: 3,
};

export function resolveBankExceptionOwnerId(
  candidates: BankOwnerCandidate[],
): string | null {
  const ranked = candidates
    .filter((u) => u.active !== false && u.role && u.role in BANK_OWNER_ROLE_RANK)
    .sort((a, b) => {
      const ra = BANK_OWNER_ROLE_RANK[a.role ?? ""] ?? 99;
      const rb = BANK_OWNER_ROLE_RANK[b.role ?? ""] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });
  return ranked[0]?.id ?? null;
}

/**
 * Evalúa si una conciliación bancaria puede cerrar la excepción sin ocultar
 * ninguna diferencia:
 * - `differenceCents === 0` → cierre exacto permitido (`EXACT_MATCH`).
 * - `differenceCents !== 0` → NUNCA cierra en silencio; solo permite cierre si
 *   se declara una disposición explícita distinta de `EXACT_MATCH` y un motivo
 *   auditado >= 4 caracteres (conservando `differenceCents` en la traza).
 */
export function evaluateReconciliationDifferencePolicy(params: {
  bankAmountCents: number;
  targetAmountCents: number;
  priorDifferenceCents?: number;
  disposition?: BankDifferenceDisposition | null;
  reason?: string | null;
}): {
  canClose: boolean;
  differenceCents: number;
  effectiveDisposition: BankDifferenceDisposition | null;
  blockingReason: string | null;
} {
  const computedDiff = Math.abs(params.bankAmountCents) - Math.abs(params.targetAmountCents);
  const differenceCents =
    computedDiff !== 0 ? computedDiff : (params.priorDifferenceCents ?? 0);

  if (differenceCents === 0) {
    return {
      canClose: true,
      differenceCents: 0,
      effectiveDisposition: "EXACT_MATCH",
      blockingReason: null,
    };
  }

  const trimmedReason = params.reason?.trim() ?? "";
  if (
    !params.disposition ||
    params.disposition === "EXACT_MATCH" ||
    trimmedReason.length < 4
  ) {
    return {
      canClose: false,
      differenceCents,
      effectiveDisposition: null,
      blockingReason: `Diferencia bancaria de $${(differenceCents / 100).toFixed(2)} MXN no puede ocultarse: requiere disposición explícita y motivo auditado (>= 4 caracteres).`,
    };
  }

  return {
    canClose: true,
    differenceCents,
    effectiveDisposition: params.disposition,
    blockingReason: null,
  };
}

function formatMxn(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)} MXN`;
}

export function buildBankExceptionInput(params: {
  companyId: string;
  branchId?: string | null;
  source: BankSourceSnapshot;
  now: Date;
  ownerId: string | null;
  actorId?: string | null;
  existingMetadata?: Record<string, unknown> | null;
  existingOwnerId?: string | null;
}): RaiseExceptionInput {
  const existingMeta = params.existingMetadata ?? {};
  const existingSource =
    typeof existingMeta.sourceSnapshot === "object" && existingMeta.sourceSnapshot !== null
      ? (existingMeta.sourceSnapshot as Partial<BankSourceSnapshot>)
      : null;

  // Conservar la fecha valor, fuente e importe originales de la detección.
  const preservedValueDate = existingSource?.valueDate ?? params.source.valueDate;
  const ageDays = computeBankAgingDays(preservedValueDate, params.now);
  const preservedOwnerId = params.existingOwnerId ?? params.ownerId;
  const effectiveDiff =
    params.source.differenceCents !== 0
      ? params.source.differenceCents
      : (existingSource?.differenceCents ?? 0);

  const severity = classifyBankExceptionSeverity({
    ageDays,
    differenceCents: effectiveDiff,
    discrepancyCode: params.source.discrepancyCode,
  });

  const subjectId = buildBankSubjectId(params.source.sourceKind, params.source.sourceId);
  const kindLabel =
    params.source.sourceKind === "BANK_OUTFLOW"
      ? "Egreso bancario"
      : params.source.sourceKind === "BANK_DEPOSIT"
        ? "Depósito bancario"
        : params.source.sourceKind === "PAYMENT_RUN_ITEM"
          ? "Pago confirmado pendiente en banco"
          : "Liquidación de pasarela pendiente/discrepante";

  const diffText =
    effectiveDiff !== 0
      ? ` · diferencia ${effectiveDiff > 0 ? "+" : "-"}${formatMxn(effectiveDiff)}`
      : "";
  const reason = `${kindLabel} (${params.source.discrepancyCode}) del ${preservedValueDate} (${ageDays}d antigüedad, ${formatMxn(params.source.amountCents)}${diffText})`;

  const mergedSource: BankSourceSnapshot = {
    ...params.source,
    valueDate: preservedValueDate,
    differenceCents: effectiveDiff,
  };

  return {
    companyId: params.companyId,
    branchId: params.branchId ?? null,
    domain: "finanzas",
    qsrCategory: "DINERO",
    severity,
    subjectType: BANK_EXCEPTION_SUBJECT_TYPE,
    subjectId,
    reason,
    ownerId: preservedOwnerId,
    actorId: params.actorId ?? null,
    actionMeta: {
      type: "AUDIT_DRAWER",
      label: "Conciliar Movimiento Bancario",
      url: `/dashboard/finance/bank-reconciliation?sourceId=${params.source.sourceId}`,
    },
    metadata: {
      ...existingMeta,
      title: `${kindLabel} (${ageDays}d)`,
      sourceKind: mergedSource.sourceKind,
      sourceTable: mergedSource.sourceTable,
      sourceId: mergedSource.sourceId,
      sourceBankAccountId: mergedSource.sourceBankAccountId,
      direction: mergedSource.direction,
      valueDate: preservedValueDate,
      ageDays,
      amountCents: mergedSource.amountCents,
      expectedAmountCents: mergedSource.expectedAmountCents,
      differenceCents: effectiveDiff,
      discrepancyCode: mergedSource.discrepancyCode,
      reference: mergedSource.reference,
      description: mergedSource.description,
      sourceSnapshot: mergedSource,
      responsibleOwnerId: preservedOwnerId,
      firstDetectedAt: existingMeta.firstDetectedAt ?? params.now.toISOString(),
      lastEvaluatedAt: params.now.toISOString(),
      reconciliationTrace: existingMeta.reconciliationTrace ?? null,
      impact:
        effectiveDiff !== 0
          ? `Diferencia bancaria sin explicar de ${formatMxn(effectiveDiff)} (${ageDays} días)`
          : `Partida bancaria sin conciliar por ${formatMxn(mergedSource.amountCents)} (${ageDays} días)`,
    },
  };
}
