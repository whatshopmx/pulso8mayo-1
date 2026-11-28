/**
 * REC-03A — Lectura y ajuste preparado de lotes con anomalía histórica (H01).
 *
 * - `readReceivingOvercountRevalidation`: dry-run. Arma el expediente de cada
 *   lote nacido en recepción con saldo ≠ ledger (o ya marcado) y lo clasifica
 *   con `evaluateBatchRevalidation`. No escribe; el llamador debe abrir una
 *   transacción READ ONLY.
 * - `applyReceivingOvercountAdjustment`: ajuste explícito de UN lote
 *   `SUFFICIENT`, dentro de la transacción del llamador. Bloquea el lote,
 *   reevalúa bajo el lock, exige que el delta coincida con el plan revisado,
 *   inserta un `ADJUSTMENT` marcado (nunca reescribe movimientos ni divide
 *   saldos), baja el saldo hasta su ledger y audita (AUD-02) en la misma
 *   transacción. Repetir devuelve `ALREADY_CORRECTED` sin efectos.
 *
 * La aplicación sobre datos operativos pertenece a REC-03B (conteo, actor,
 * aprobación separada y respaldo); REC-03A sólo la ejercita en copia aislada.
 */
import { sql } from "drizzle-orm";
import type { DbExecutor } from "./fefo-allocator";
import { AuditService } from "./audit-service";
import {
  REC01_FIX_CUTOFF,
  REC03_ADJUSTMENT_MARKER,
  REVALIDATION_EPS,
  buildRevalidationReport,
  evaluateBatchRevalidation,
  rec03AdjustmentReference,
  round4,
  type BatchRevalidation,
  type RevalidationReason,
  type RevalidationReport,
} from "@/lib/inventory/receiving-overcount-revalidation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CandidateRow {
  batch_id: string;
  branch_id: string;
  item_id: string;
  item_unit: string | null;
  status: string | null;
  created_at: string | Date | null;
  initial_quantity: string;
  current_quantity: string;
  branch_company_id: string | null;
  item_company_id: string | null;
  ledger: string;
  receiving_qty: string;
  receiving_count: number | string;
  later_count: number | string;
  marker_count: number | string;
  report_ref: string | null;
  report_id: string | null;
  report_branch_id: string | null;
  report_company_id: string | null;
  report_line_quantities: unknown;
}

const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : (result as { rows?: T[] }).rows ?? []) as T[];

function candidatesQuery(filter: { companyId?: string | null; batchId?: string | null }) {
  const company = filter.companyId ?? null;
  const batch = filter.batchId ?? null;
  return sql`
    WITH m AS (
      SELECT mv.batch_id,
        SUM(mv.quantity_change) AS ledger,
        COALESCE(SUM(mv.quantity_change) FILTER (WHERE mv.type = 'RECEIVING'), 0) AS receiving_qty,
        COUNT(*) FILTER (WHERE mv.type = 'RECEIVING') AS receiving_count,
        COUNT(*) FILTER (WHERE mv.type = 'ADJUSTMENT'
          AND (mv.reason = ${REC03_ADJUSTMENT_MARKER} OR mv.reference_id = 'REC-03:H01:' || mv.batch_id::text)) AS marker_count,
        COUNT(*) FILTER (WHERE mv.type <> 'RECEIVING' AND NOT (mv.type = 'ADJUSTMENT'
          AND (mv.reason = ${REC03_ADJUSTMENT_MARKER} OR mv.reference_id = 'REC-03:H01:' || mv.batch_id::text))) AS later_count
      FROM public.inventory_movements mv
      WHERE mv.batch_id IS NOT NULL
      GROUP BY mv.batch_id
    )
    SELECT b.id::text AS batch_id, b.branch_id::text AS branch_id, b.item_id::text AS item_id,
      i.unit::text AS item_unit,
      b.status::text AS status, b.created_at,
      b.initial_quantity::text AS initial_quantity, b.current_quantity::text AS current_quantity,
      br.company_id::text AS branch_company_id, i.company_id::text AS item_company_id,
      COALESCE(m.ledger, 0)::text AS ledger, COALESCE(m.receiving_qty, 0)::text AS receiving_qty,
      COALESCE(m.receiving_count, 0)::int AS receiving_count, COALESCE(m.later_count, 0)::int AS later_count,
      COALESCE(m.marker_count, 0)::int AS marker_count,
      b.supplier_batch_info->>'receivingReportId' AS report_ref,
      rr.id::text AS report_id, rr.branch_id::text AS report_branch_id, rr.company_id::text AS report_company_id,
      COALESCE((SELECT json_agg(rri.received_quantity ORDER BY rri.received_quantity)
        FROM public.receiving_report_items rri
        WHERE rri.receiving_report_id = rr.id AND rri.item_id = b.item_id), '[]'::json) AS report_line_quantities
    FROM public.inventory_batches b
    LEFT JOIN m ON m.batch_id = b.id
    LEFT JOIN public.branches br ON br.id = b.branch_id
    LEFT JOIN public.inventory_items i ON i.id = b.item_id
    LEFT JOIN public.receiving_reports rr ON rr.id::text = b.supplier_batch_info->>'receivingReportId'
    WHERE b.supplier_batch_info->>'receivingReportId' IS NOT NULL
      AND (ABS(b.current_quantity - COALESCE(m.ledger, 0)) > ${REVALIDATION_EPS} OR COALESCE(m.marker_count, 0) > 0)
      AND (${company}::uuid IS NULL OR br.company_id = ${company}::uuid)
      AND (${batch}::uuid IS NULL OR b.id = ${batch}::uuid)
    ORDER BY b.created_at NULLS FIRST, b.id`;
}

function toEvaluation(row: CandidateRow, fixCutoff: string): BatchRevalidation {
  const lines = Array.isArray(row.report_line_quantities)
    ? row.report_line_quantities
    : JSON.parse(String(row.report_line_quantities ?? "[]"));
  return evaluateBatchRevalidation({
    batchId: row.batch_id,
    branchId: row.branch_id,
    itemId: row.item_id,
    unit: row.item_unit,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    initialQuantity: Number(row.initial_quantity),
    currentQuantity: Number(row.current_quantity),
    branchCompanyId: row.branch_company_id,
    itemCompanyId: row.item_company_id,
    ledger: Number(row.ledger),
    receivingQuantity: Number(row.receiving_qty),
    receivingCount: Number(row.receiving_count),
    laterMovementCount: Number(row.later_count),
    markerCount: Number(row.marker_count),
    reportReference: row.report_ref,
    report: row.report_id && row.report_branch_id && row.report_company_id
      ? { id: row.report_id, branchId: row.report_branch_id, companyId: row.report_company_id }
      : null,
    reportLineQuantities: (lines as unknown[]).map(Number),
  }, { fixCutoff });
}

export interface RevalidationOptions {
  companyId?: string | null;
  fixCutoff?: string;
  now?: Date;
}

/** Dry-run. Ejecutar dentro de una transacción `READ ONLY`. */
export async function readReceivingOvercountRevalidation(
  executor: DbExecutor,
  options: RevalidationOptions = {},
): Promise<RevalidationReport> {
  if (options.companyId && !UUID_RE.test(options.companyId)) throw new Error("Invalid companyId");
  const fixCutoff = options.fixCutoff ?? REC01_FIX_CUTOFF;
  const rows = rowsOf<CandidateRow>(await executor.execute(candidatesQuery({ companyId: options.companyId })));
  const company = options.companyId ?? null;
  const [other] = rowsOf<{ n: number | string }>(await executor.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM public.inventory_batches b
    LEFT JOIN (SELECT batch_id, SUM(quantity_change) AS ledger FROM public.inventory_movements
      WHERE batch_id IS NOT NULL GROUP BY batch_id) m ON m.batch_id = b.id
    LEFT JOIN public.branches br ON br.id = b.branch_id
    WHERE b.supplier_batch_info->>'receivingReportId' IS NULL
      AND ABS(b.current_quantity - COALESCE(m.ledger, 0)) > ${REVALIDATION_EPS}
      AND (${company}::uuid IS NULL OR br.company_id = ${company}::uuid)`));
  return buildRevalidationReport(rows.map(row => toEvaluation(row, fixCutoff)), {
    generatedAt: options.now ?? new Date(),
    fixCutoff,
    companyId: company,
    nonReceivingMismatches: Number(other?.n ?? 0),
  });
}

export type ReceivingOvercountApplyErrorCode =
  | "INVALID_INPUT"
  | "BATCH_NOT_FOUND"
  | "NOT_SUFFICIENT"
  | "STALE_PLAN"
  | "POSTCONDITION_FAILED";

export class ReceivingOvercountApplyError extends Error {
  constructor(
    readonly code: ReceivingOvercountApplyErrorCode,
    message: string,
    readonly reasons: RevalidationReason[] = [],
  ) {
    super(message);
    this.name = "ReceivingOvercountApplyError";
  }
}

export interface ApplyReceivingOvercountInput {
  batchId: string;
  /** Delta revisado en el dry-run (positivo). Si cambió, se rechaza. */
  expectedDelta: number;
  actorId: string;
  reason: string;
  fixCutoff?: string;
  /** Permite a REC-03B etiquetar la auditoría y añadir respaldo/aprobador/conteo. */
  protocol?: "REC-03A" | "REC-03B";
  auditMetadata?: Record<string, unknown>;
}

export type ApplyReceivingOvercountResult =
  | { status: "APPLIED"; batchId: string; adjustment: number; before: number; after: number; movementId: string; auditId: string }
  | { status: "ALREADY_CORRECTED"; batchId: string };

/**
 * Bloquea un lote (`FOR UPDATE`) y devuelve su evaluación REC-03A más el
 * `companyId` real de sucursal/ítem y unidad para validación en REC-03B.
 */
export async function lockAndEvaluateBatchForOvercount(
  tx: DbExecutor,
  batchId: string,
  fixCutoff: string = REC01_FIX_CUTOFF,
): Promise<
  | { found: false }
  | {
      found: true;
      branchCompanyId: string | null;
      itemCompanyId: string | null;
      itemUnit: string | null;
      evaluation: BatchRevalidation | null;
    }
> {
  const [locked] = rowsOf<{
    id: string;
    branch_company_id: string | null;
    item_company_id: string | null;
    item_unit: string | null;
  }>(
    await tx.execute(sql`
      SELECT b.id::text AS id,
             br.company_id::text AS branch_company_id,
             i.company_id::text AS item_company_id,
             i.unit::text AS item_unit
        FROM public.inventory_batches b
        LEFT JOIN public.branches br ON br.id = b.branch_id
        LEFT JOIN public.inventory_items i ON i.id = b.item_id
       WHERE b.id = ${batchId}::uuid
         FOR UPDATE OF b`),
  );
  if (!locked) return { found: false };

  const [row] = rowsOf<CandidateRow>(await tx.execute(candidatesQuery({ batchId })));
  return {
    found: true,
    branchCompanyId: locked.branch_company_id,
    itemCompanyId: locked.item_company_id,
    itemUnit: locked.item_unit,
    evaluation: row ? toEvaluation(row, fixCutoff) : null,
  };
}

/** Ajuste de un lote SUFFICIENT. `tx` debe ser una transacción del llamador. */
export async function applyReceivingOvercountAdjustment(
  tx: DbExecutor,
  input: ApplyReceivingOvercountInput,
): Promise<ApplyReceivingOvercountResult> {
  if (!UUID_RE.test(input.batchId)) throw new ReceivingOvercountApplyError("INVALID_INPUT", "batchId inválido");
  if (!input.actorId?.trim()) throw new ReceivingOvercountApplyError("INVALID_INPUT", "Se requiere actor");
  if (!(input.reason?.trim().length >= 10)) {
    throw new ReceivingOvercountApplyError("INVALID_INPUT", "Se requiere motivo explícito (mínimo 10 caracteres)");
  }
  if (!(Number.isFinite(input.expectedDelta) && input.expectedDelta > 0)) {
    throw new ReceivingOvercountApplyError("INVALID_INPUT", "expectedDelta debe ser positivo");
  }
  const fixCutoff = input.fixCutoff ?? REC01_FIX_CUTOFF;

  // Serializa con cualquier otro ajuste/consumo del mismo lote.
  const locked = rowsOf<{ id: string }>(await tx.execute(
    sql`SELECT id::text AS id FROM public.inventory_batches WHERE id = ${input.batchId}::uuid FOR UPDATE`));
  if (locked.length === 0) throw new ReceivingOvercountApplyError("BATCH_NOT_FOUND", "Lote inexistente");

  // Reevaluación bajo el lock (lectura posterior al bloqueo: ve lo ya confirmado).
  const [row] = rowsOf<CandidateRow>(await tx.execute(candidatesQuery({ batchId: input.batchId })));
  if (!row) {
    throw new ReceivingOvercountApplyError("NOT_SUFFICIENT", "El lote ya no presenta diferencia de recepción");
  }
  const evaluation = toEvaluation(row, fixCutoff);
  if (evaluation.evidence === "ALREADY_CORRECTED") return { status: "ALREADY_CORRECTED", batchId: input.batchId };
  if (evaluation.evidence !== "SUFFICIENT") {
    throw new ReceivingOvercountApplyError("NOT_SUFFICIENT", "Evidencia ambigua: el lote queda retenido para conteo físico",
      evaluation.reasons);
  }
  if (Math.abs(evaluation.delta - input.expectedDelta) >= REVALIDATION_EPS) {
    throw new ReceivingOvercountApplyError("STALE_PLAN",
      `El delta cambió desde el dry-run (${input.expectedDelta} → ${evaluation.delta}); revalidar`);
  }

  const adjustment = round4(-evaluation.delta);
  // En H01 el excedente (+delta) solo infló `inventory_batches.current_quantity`
  // al crear el lote; `inventory_movements` ya suma el ledger real. Por eso el
  // movimiento marcador registra `quantity_change = 0` (conservando intacta la
  // suma del ledger append-only) mientras `current_quantity` baja `-delta` hasta
  // quedar igual al ledger y la auditoría AUD-02 documenta `before`/`after`/`-delta`.
  const [movement] = rowsOf<{ id: string }>(await tx.execute(sql`
    INSERT INTO public.inventory_movements
      (branch_id, item_id, batch_id, type, quantity_change, reason, performed_by, reference_id, timestamp)
    VALUES (${row.branch_id}::uuid, ${row.item_id}::uuid, ${input.batchId}::uuid, 'ADJUSTMENT',
      '0'::numeric, ${REC03_ADJUSTMENT_MARKER}, ${input.actorId},
      ${rec03AdjustmentReference(input.batchId)}, now())
    RETURNING id::text AS id`));
  await tx.execute(sql`
    UPDATE public.inventory_batches
       SET current_quantity = current_quantity + ${String(adjustment)}::numeric, updated_at = now()
     WHERE id = ${input.batchId}::uuid`);

  const audit = await AuditService.logCriticalInventoryAction({
    companyId: row.branch_company_id!,
    branchId: row.branch_id,
    action: "CREATE",
    entityType: "ADJUSTMENT",
    entityId: movement.id,
    oldValue: { batchId: input.batchId, currentQuantity: evaluation.observed, ledger: evaluation.ledger },
    newValue: { batchId: input.batchId, currentQuantity: evaluation.ledger, quantityChange: adjustment },
    performedBy: input.actorId,
    reason: input.reason.trim(),
    metadata: {
      protocol: input.protocol ?? "REC-03A",
      cause: "H01_DOUBLE_RECEIVING_INCREMENT",
      reference: rec03AdjustmentReference(input.batchId),
      receivingReportId: evaluation.reportId,
      receivingQuantity: evaluation.receivingQuantity,
      unit: evaluation.unit,
      ledgerQuantityChange: 0,
      balanceAdjustment: adjustment,
      fixCutoff: new Date(fixCutoff).toISOString(),
      ...(input.auditMetadata ?? {}),
    },
  }, tx);

  const [after] = rowsOf<{ current_quantity: string; ledger: string }>(await tx.execute(sql`
    SELECT b.current_quantity::text AS current_quantity,
      COALESCE((SELECT SUM(quantity_change) FROM public.inventory_movements WHERE batch_id = b.id), 0)::text AS ledger
    FROM public.inventory_batches b WHERE b.id = ${input.batchId}::uuid`));
  if (!after || Math.abs(Number(after.current_quantity) - Number(after.ledger)) >= REVALIDATION_EPS) {
    throw new ReceivingOvercountApplyError("POSTCONDITION_FAILED", "El saldo no quedó igual a su ledger");
  }
  return { status: "APPLIED", batchId: input.batchId, adjustment, before: evaluation.observed,
    after: round4(Number(after.current_quantity)), movementId: movement.id, auditId: String(audit.id) };
}
