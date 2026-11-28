/**
 * REC-03B — Protocolo de corrección histórica de lotes afectados por H01.
 *
 * Exige explícitamente antes de escribir sobre un lote respaldado:
 *  1. Conteo físico (`countedQuantity`) coherente con el ledger esperado.
 *  2. Unidad explícita (`unit`) coincidente con `inventory_items.unit`.
 *  3. Actor que contó (`countedBy`) distinto del aprobador (`approverId`), con
 *     rol de aprobación `>= ADMIN` y dentro del mismo `companyId`.
 *  4. Motivo explícito (`reason >= 10` caracteres) y referencia de respaldo
 *     (`backupReference >= 6` caracteres) persistidos en auditoría `AUD-02`.
 *  5. Evidencia `SUFFICIENT` en `REC-03A`: los lotes `AMBIGUOUS` permanecen
 *     retenidos sin mutación.
 *  6. Repetición idempotente (`ALREADY_CORRECTED`, sin duplicar movimiento ni
 *     auditoría) incluso bajo concurrencia (`FOR UPDATE`).
 */
import { roleIsAtLeast } from "@/lib/permissions";
import type { DbExecutor } from "./fefo-allocator";
import {
  REC01_FIX_CUTOFF,
  REVALIDATION_EPS,
  round4,
  type RevalidationReason,
} from "@/lib/inventory/receiving-overcount-revalidation";
import {
  applyReceivingOvercountAdjustment,
  lockAndEvaluateBatchForOvercount,
  type ApplyReceivingOvercountResult,
} from "./receiving-overcount-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HistoricalCorrectionErrorCode =
  | "INVALID_INPUT"
  | "BACKUP_REQUIRED"
  | "UNIT_MISMATCH"
  | "SELF_APPROVAL"
  | "INSUFFICIENT_ROLE"
  | "SCOPE_MISMATCH"
  | "BATCH_NOT_FOUND"
  | "NOT_SUFFICIENT"
  | "STALE_PLAN"
  | "COUNT_MISMATCH";

export class HistoricalCorrectionProtocolError extends Error {
  constructor(
    readonly code: HistoricalCorrectionErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly reasons: RevalidationReason[] = [],
  ) {
    super(message);
    this.name = "HistoricalCorrectionProtocolError";
  }
}

export interface HistoricalCorrectionProtocolInput {
  companyId: string;
  batchId: string;
  /** Delta positivo revisado en dry-run REC-03A. */
  expectedDelta: number;
  /** Cantidad física contada en piso (debe concordar con el ledger esperado). */
  countedQuantity: number;
  /** Unidad física declarada en el conteo (debe coincidir con `inventory_items.unit`). */
  unit: string;
  /** Actor que ejecutó el conteo físico. */
  countedBy: string;
  /** Aprobador independiente (derivado de sesión). */
  approverId: string;
  /** Rol efectivo del aprobador (debe ser >= ADMIN). */
  approverRole: string;
  /** Motivo explícito (>= 10 caracteres). */
  reason: string;
  /** Referencia obligatoria de respaldo/snapshot previo del lote/entorno (>= 6 caracteres). */
  backupReference: string;
  fixCutoff?: string;
}

export type HistoricalCorrectionProtocolResult = ApplyReceivingOvercountResult & {
  protocol: "REC-03B";
  unit: string;
  countedBy: string;
  approverId: string;
  backupReference: string;
};

const normalizeUnit = (u: string) => u.trim().toUpperCase();

/** Validación pura de precondiciones del protocolo REC-03B (sin acceso a DB). */
export function validateHistoricalCorrectionProtocolInput(
  input: HistoricalCorrectionProtocolInput,
): void {
  if (!UUID_RE.test(input.companyId)) {
    throw new HistoricalCorrectionProtocolError("INVALID_INPUT", 400, "companyId inválido.");
  }
  if (!UUID_RE.test(input.batchId)) {
    throw new HistoricalCorrectionProtocolError("INVALID_INPUT", 400, "batchId inválido.");
  }
  if (!(Number.isFinite(input.expectedDelta) && input.expectedDelta > 0)) {
    throw new HistoricalCorrectionProtocolError(
      "INVALID_INPUT",
      400,
      "expectedDelta debe ser un número positivo.",
    );
  }
  if (!(Number.isFinite(input.countedQuantity) && input.countedQuantity >= 0)) {
    throw new HistoricalCorrectionProtocolError(
      "INVALID_INPUT",
      400,
      "countedQuantity debe ser un número mayor o igual a cero.",
    );
  }
  if (!input.unit?.trim()) {
    throw new HistoricalCorrectionProtocolError("INVALID_INPUT", 400, "La unidad es obligatoria.");
  }
  if (!input.countedBy?.trim()) {
    throw new HistoricalCorrectionProtocolError(
      "INVALID_INPUT",
      400,
      "Se requiere identificar al actor que realizó el conteo físico (countedBy).",
    );
  }
  if (!input.approverId?.trim()) {
    throw new HistoricalCorrectionProtocolError(
      "INVALID_INPUT",
      400,
      "Se requiere identificar al aprobador (approverId).",
    );
  }
  if (!input.approverRole || !roleIsAtLeast(input.approverRole, "ADMIN")) {
    throw new HistoricalCorrectionProtocolError(
      "INSUFFICIENT_ROLE",
      403,
      `Aprobar correcciones históricas REC-03B requiere rol >= ADMIN (rol actual: ${input.approverRole || "NINGUNO"}).`,
    );
  }
  if (input.countedBy.trim() === input.approverId.trim()) {
    throw new HistoricalCorrectionProtocolError(
      "SELF_APPROVAL",
      403,
      "Segregación de funciones (REC-03B): quien ejecuta el conteo no puede aprobar la corrección histórica.",
    );
  }
  if (!(input.reason?.trim().length >= 10)) {
    throw new HistoricalCorrectionProtocolError(
      "INVALID_INPUT",
      400,
      "El motivo explícito debe tener al menos 10 caracteres.",
    );
  }
  if (!(input.backupReference?.trim().length >= 6)) {
    throw new HistoricalCorrectionProtocolError(
      "BACKUP_REQUIRED",
      400,
      "REC-03B exige referencia de respaldo verificado (backupReference, mínimo 6 caracteres) antes de modificar datos.",
    );
  }
}

/**
 * Ejecuta el protocolo completo REC-03B dentro de la transacción `tx` del llamador:
 * bloquea el lote (`FOR UPDATE`), verifica alcance de empresa, unidad, evidencia
 * `SUFFICIENT` de `REC-03A`, concordancia del conteo físico con el ledger y delega
 * el ajuste atómico + auditoría `AUD-02` a `applyReceivingOvercountAdjustment`.
 */
export async function applyHistoricalCorrectionProtocol(
  tx: DbExecutor,
  input: HistoricalCorrectionProtocolInput,
): Promise<HistoricalCorrectionProtocolResult> {
  validateHistoricalCorrectionProtocolInput(input);
  const fixCutoff = input.fixCutoff ?? REC01_FIX_CUTOFF;

  const locked = await lockAndEvaluateBatchForOvercount(tx, input.batchId, fixCutoff);
  if (!locked.found) {
    throw new HistoricalCorrectionProtocolError("BATCH_NOT_FOUND", 404, "Lote inexistente.");
  }

  if (
    locked.branchCompanyId !== input.companyId ||
    locked.itemCompanyId !== input.companyId
  ) {
    throw new HistoricalCorrectionProtocolError(
      "SCOPE_MISMATCH",
      403,
      "El lote no pertenece a la empresa autorizada.",
    );
  }

  if (!locked.itemUnit || normalizeUnit(input.unit) !== normalizeUnit(locked.itemUnit)) {
    throw new HistoricalCorrectionProtocolError(
      "UNIT_MISMATCH",
      400,
      `La unidad declarada (${input.unit}) no coincide con la unidad del ítem (${locked.itemUnit ?? "N/A"}).`,
    );
  }

  const evaluation = locked.evaluation;
  if (!evaluation) {
    throw new HistoricalCorrectionProtocolError(
      "NOT_SUFFICIENT",
      409,
      "El lote ya no presenta diferencia de recepción atribuible a H01.",
    );
  }

  if (evaluation.evidence === "ALREADY_CORRECTED") {
    return {
      status: "ALREADY_CORRECTED",
      batchId: input.batchId,
      protocol: "REC-03B",
      unit: locked.itemUnit,
      countedBy: input.countedBy.trim(),
      approverId: input.approverId.trim(),
      backupReference: input.backupReference.trim(),
    };
  }

  if (evaluation.evidence !== "SUFFICIENT") {
    throw new HistoricalCorrectionProtocolError(
      "NOT_SUFFICIENT",
      409,
      "Lote ambiguo retenido: requiere conteo físico y resolución fuera de H01 (no se aplican saldos supuestos).",
      evaluation.reasons,
    );
  }

  if (Math.abs(evaluation.delta - input.expectedDelta) >= REVALIDATION_EPS) {
    throw new HistoricalCorrectionProtocolError(
      "STALE_PLAN",
      409,
      `El delta cambió desde el dry-run (${input.expectedDelta} → ${evaluation.delta}); revalidar antes de aplicar.`,
    );
  }

  const counted = round4(input.countedQuantity);
  if (Math.abs(counted - evaluation.ledger) >= REVALIDATION_EPS) {
    throw new HistoricalCorrectionProtocolError(
      "COUNT_MISMATCH",
      409,
      `El conteo físico (${counted} ${locked.itemUnit}) no concuerda con el ledger esperado (${evaluation.ledger} ${locked.itemUnit}); el lote permanece retenido para revisión.`,
    );
  }

  const applied = await applyReceivingOvercountAdjustment(tx, {
    batchId: input.batchId,
    expectedDelta: input.expectedDelta,
    actorId: input.approverId.trim(),
    reason: input.reason.trim(),
    fixCutoff,
    protocol: "REC-03B",
    auditMetadata: {
      companyId: input.companyId,
      countedBy: input.countedBy.trim(),
      approverId: input.approverId.trim(),
      approverRole: input.approverRole,
      countedQuantity: counted,
      declaredUnit: locked.itemUnit,
      backupReference: input.backupReference.trim(),
    },
  });

  return {
    ...applied,
    protocol: "REC-03B",
    unit: locked.itemUnit,
    countedBy: input.countedBy.trim(),
    approverId: input.approverId.trim(),
    backupReference: input.backupReference.trim(),
  };
}
