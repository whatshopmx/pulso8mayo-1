/**
 * REC-03A — Revalidación por lote de la anomalía histórica de recepción (H01).
 *
 * Antes de REC-01 (`bff8a8d`, 2026-10-17) cada recepción creaba el lote con
 * `current_quantity = qty` y además registraba un movimiento `RECEIVING` de
 * `+qty`, así que el saldo quedaba `qty` por encima de su ledger. El
 * diagnóstico original (`receiving-overcount.ts`) sólo comparaba el delta con
 * lo recibido; aquí se exige un expediente completo por lote y se clasifica la
 * evidencia en dos grupos:
 *
 * - `SUFFICIENT`: todas las pruebas del doble incremento concurren; se propone
 *   un ajuste exacto de `-delta` que deja el saldo igual a su ledger.
 * - `AMBIGUOUS`: falta al menos una prueba. NO se propone cantidad: el lote
 *   queda retenido para conteo físico (REC-03B / INV-03). No se fabrican saldos.
 *
 * `ALREADY_CORRECTED` distingue el lote que ya lleva el ajuste marcado y cuadra
 * con su ledger (repetir no vuelve a ajustar).
 *
 * Lógica pura, sin base de datos. El servicio
 * (`lib/services/receiving-overcount-service.ts`) arma las entradas.
 */

/** Tolerancia de `numeric(12,4)` serializado como texto. */
export const REVALIDATION_EPS = 0.00005;

/** Marcador histórico del ajuste (compatible con el script REC-03 anterior). */
export const REC03_ADJUSTMENT_MARKER = "[REC-03/H01] ajuste por doble incremento de recepción";

/** `reference_id` determinista por lote: identifica el ajuste sin texto libre. */
export function rec03AdjustmentReference(batchId: string): string {
  return `REC-03:H01:${batchId}`;
}

/**
 * Corte conservador: fecha del commit de REC-01. Un lote creado en o después
 * de este instante ya nació en cero; si muestra delta, la causa no es H01.
 * Si el despliegue fue posterior, los lotes intermedios quedan AMBIGUOUS
 * (seguro: van a conteo, nunca a un ajuste supuesto).
 */
export const REC01_FIX_CUTOFF = "2026-10-17T00:00:00.000Z";

export type RevalidationEvidence = "SUFFICIENT" | "AMBIGUOUS" | "ALREADY_CORRECTED";

export type RevalidationReason =
  | "SCOPE_MISMATCH"
  | "NO_RECEIVING_MOVEMENT"
  | "MULTIPLE_RECEIVING_MOVEMENTS"
  | "RECEIVING_NOT_INITIAL"
  | "NEGATIVE_DELTA"
  | "DELTA_NOT_RECEIVED_QUANTITY"
  | "CORRECTED_BALANCE_NEGATIVE"
  | "REPORT_MISSING"
  | "REPORT_SCOPE_MISMATCH"
  | "REPORT_LINE_MISSING"
  | "REPORT_LINE_QUANTITY_MISMATCH"
  | "CREATED_AT_UNKNOWN"
  | "CREATED_AFTER_FIX"
  | "MARKER_WITH_RESIDUAL";

export interface BatchRevalidationInput {
  batchId: string;
  branchId: string;
  itemId: string;
  unit?: string | null;
  status: string | null;
  createdAt: Date | null;
  initialQuantity: number;
  currentQuantity: number;
  branchCompanyId: string | null;
  itemCompanyId: string | null;
  /** Suma de todos los movimientos del lote. */
  ledger: number;
  receivingQuantity: number;
  receivingCount: number;
  /** Movimientos posteriores distintos de RECEIVING y del ajuste marcado. */
  laterMovementCount: number;
  markerCount: number;
  /** `supplier_batch_info->>'receivingReportId'`, tal como está guardado. */
  reportReference: string | null;
  report: { id: string; branchId: string; companyId: string } | null;
  /** `received_quantity` de las líneas del reporte para el mismo ítem. */
  reportLineQuantities: number[];
}

export interface BatchRevalidation {
  batchId: string;
  branchId: string;
  itemId: string;
  unit: string | null;
  companyId: string | null;
  status: string | null;
  createdAt: string | null;
  observed: number;
  ledger: number;
  delta: number;
  receivingQuantity: number;
  receivingCount: number;
  laterMovementCount: number;
  reportId: string | null;
  evidence: RevalidationEvidence;
  reasons: RevalidationReason[];
  /** Sólo SUFFICIENT: cambio exacto propuesto (`-delta`). */
  proposedAdjustment: number | null;
  /** Sólo SUFFICIENT: saldo que dejaría el ajuste (= ledger). */
  correctedBalance: number | null;
  action: "PROPOSE_ADJUSTMENT" | "RETAIN_FOR_PHYSICAL_COUNT" | "NONE";
}

const close = (a: number, b: number) => Math.abs(a - b) < REVALIDATION_EPS;
/** Redondeo a la escala de `numeric(12,4)` para no arrastrar ruido binario. */
export const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function evaluateBatchRevalidation(
  input: BatchRevalidationInput,
  options: { fixCutoff?: string | Date } = {},
): BatchRevalidation {
  const cutoff = new Date(options.fixCutoff ?? REC01_FIX_CUTOFF);
  if (Number.isNaN(cutoff.getTime())) throw new Error("Invalid REC-01 fix cutoff");
  const delta = round4(input.currentQuantity - input.ledger);
  const base = {
    batchId: input.batchId,
    branchId: input.branchId,
    itemId: input.itemId,
    unit: input.unit ?? null,
    companyId: input.branchCompanyId,
    status: input.status,
    createdAt: input.createdAt ? input.createdAt.toISOString() : null,
    observed: round4(input.currentQuantity),
    ledger: round4(input.ledger),
    delta,
    receivingQuantity: round4(input.receivingQuantity),
    receivingCount: input.receivingCount,
    laterMovementCount: input.laterMovementCount,
    reportId: input.report?.id ?? null,
  };

  if (input.markerCount > 0 && close(delta, 0)) {
    return { ...base, evidence: "ALREADY_CORRECTED", reasons: [], proposedAdjustment: null,
      correctedBalance: null, action: "NONE" };
  }

  const reasons: RevalidationReason[] = [];
  if (!input.branchCompanyId || !input.itemCompanyId || input.branchCompanyId !== input.itemCompanyId) {
    reasons.push("SCOPE_MISMATCH");
  }
  if (input.markerCount > 0) reasons.push("MARKER_WITH_RESIDUAL");
  if (input.receivingCount === 0) reasons.push("NO_RECEIVING_MOVEMENT");
  else if (input.receivingCount > 1) reasons.push("MULTIPLE_RECEIVING_MOVEMENTS");
  if (input.receivingCount === 1
    && (!(input.receivingQuantity > 0) || !close(input.receivingQuantity, input.initialQuantity))) {
    reasons.push("RECEIVING_NOT_INITIAL");
  }
  if (delta < 0) reasons.push("NEGATIVE_DELTA");
  else if (input.receivingCount > 0 && !close(delta, input.receivingQuantity)) {
    reasons.push("DELTA_NOT_RECEIVED_QUANTITY");
  }
  if (input.ledger < -REVALIDATION_EPS) reasons.push("CORRECTED_BALANCE_NEGATIVE");
  if (!input.report) reasons.push("REPORT_MISSING");
  else {
    if (input.report.branchId !== input.branchId || input.report.companyId !== input.branchCompanyId) {
      reasons.push("REPORT_SCOPE_MISMATCH");
    }
    if (input.reportLineQuantities.length === 0) reasons.push("REPORT_LINE_MISSING");
    else if (!input.reportLineQuantities.some(quantity => close(quantity, input.receivingQuantity))) {
      reasons.push("REPORT_LINE_QUANTITY_MISMATCH");
    }
  }
  if (!input.createdAt) reasons.push("CREATED_AT_UNKNOWN");
  else if (input.createdAt.getTime() >= cutoff.getTime()) reasons.push("CREATED_AFTER_FIX");

  if (reasons.length > 0) {
    return { ...base, evidence: "AMBIGUOUS", reasons, proposedAdjustment: null, correctedBalance: null,
      action: "RETAIN_FOR_PHYSICAL_COUNT" };
  }
  return { ...base, evidence: "SUFFICIENT", reasons, proposedAdjustment: round4(-delta),
    correctedBalance: round4(input.ledger), action: "PROPOSE_ADJUSTMENT" };
}

export interface RevalidationReport {
  protocol: "REC-03A";
  mode: "DRY_RUN";
  generatedAt: string;
  fixCutoff: string;
  scope: { companyId: string | null };
  summary: {
    candidates: number;
    sufficient: number;
    ambiguous: number;
    alreadyCorrected: number;
    byReason: Partial<Record<RevalidationReason, number>>;
    /** Lotes sin recepción con saldo ≠ ledger: fuera de H01, sólo informativo. */
    nonReceivingMismatches: number;
  };
  batches: BatchRevalidation[];
}

export function buildRevalidationReport(
  rows: BatchRevalidation[],
  context: { generatedAt: Date; fixCutoff: string; companyId: string | null; nonReceivingMismatches: number },
): RevalidationReport {
  const byReason: Partial<Record<RevalidationReason, number>> = {};
  for (const row of rows) for (const reason of row.reasons) byReason[reason] = (byReason[reason] ?? 0) + 1;
  return {
    protocol: "REC-03A",
    mode: "DRY_RUN",
    generatedAt: context.generatedAt.toISOString(),
    fixCutoff: new Date(context.fixCutoff).toISOString(),
    scope: { companyId: context.companyId },
    summary: {
      candidates: rows.length,
      sufficient: rows.filter(row => row.evidence === "SUFFICIENT").length,
      ambiguous: rows.filter(row => row.evidence === "AMBIGUOUS").length,
      alreadyCorrected: rows.filter(row => row.evidence === "ALREADY_CORRECTED").length,
      byReason,
      nonReceivingMismatches: context.nonReceivingMismatches,
    },
    batches: rows,
  };
}
