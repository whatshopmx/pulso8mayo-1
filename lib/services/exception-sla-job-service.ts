/**
 * EXC-03.b — Servicio recuperable e idempotente de escalamiento por SLA vencido.
 *
 * Reglas:
 * 1. Reutiliza `isEligibleForSlaEscalation` / `isSlaBreached` (`exception-sla.ts`)
 *    y `ExceptionService.escalate` (`exception-service.ts`, serializado con
 *    `pg_advisory_xact_lock` + `expectedStatus`).
 * 2. Acepta reloj controlado (`now`) para evaluación determinista y reintentos.
 * 3. Acotado estrictamente por `companyId`; nunca muta estados terminales
 *    (`CLOSED`, `CANCELLED`) ni re-escala filas ya `ESCALATED`.
 * 4. Tolerante a caída/reintento: si una corrida se interrumpe a mitad del lote
 *    o dos corridas compiten, un conflicto `409` se contabiliza como
 *    `skippedAlreadyHandled` y el reintento continúa únicamente con las filas
 *    pendientes, sin duplicar escalamientos.
 */
import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { exceptions } from "@/lib/db/schema";
import { isApiError } from "@/lib/api/error";
import {
  ExceptionService,
  type DbExecutor,
  type ExceptionRow,
} from "./exception-service";
import {
  SLA_ESCALATABLE_STATUSES,
  isEligibleForSlaEscalation,
} from "./exception-sla";

export interface SlaSweepParams {
  companyId: string;
  /** Reloj controlado (default: `new Date()`). */
  now?: Date;
  /** Tamaño máximo de lote por ejecución (default: 200). */
  limit?: number;
  /** Executor/transacción opcional (permite Neon aislado / rollback / `pulso_app`). */
  executor?: DbExecutor;
  /**
   * Hook opcional tras cada escalamiento exitoso (notificación, métrica o
   * inyección de falla transitoria para probar caída y recuperación).
   */
  onEscalated?: (row: ExceptionRow) => Promise<void> | void;
  /**
   * Si es `true`, una excepción en `onEscalated` aborta inmediatamente el lote
   * (simulando caída del worker tras persistir el escalamiento anterior).
   */
  abortOnHookError?: boolean;
}

export interface SlaSweepResult {
  companyId: string;
  checkedAt: string;
  scanned: number;
  escalated: number;
  skippedAlreadyHandled: number;
  failed: number;
  escalatedIds: string[];
  errors: Array<{ exceptionId: string; message: string }>;
}

export async function sweepCompanyExceptionSla(
  params: SlaSweepParams,
): Promise<SlaSweepResult> {
  const now = params.now ?? new Date();
  const limit = Math.max(1, Math.min(params.limit ?? 200, 1000));
  const exec = params.executor ?? db;

  const candidates = await exec
    .select()
    .from(exceptions)
    .where(
      and(
        eq(exceptions.companyId, params.companyId),
        inArray(exceptions.status, [...SLA_ESCALATABLE_STATUSES]),
        isNotNull(exceptions.slaDueAt),
        lt(exceptions.slaDueAt, now),
      ),
    )
    .orderBy(asc(exceptions.slaDueAt), asc(exceptions.id))
    .limit(limit);

  const escalatedIds: string[] = [];
  const errors: Array<{ exceptionId: string; message: string }> = [];
  let skippedAlreadyHandled = 0;

  for (const row of candidates) {
    if (!isEligibleForSlaEscalation(row, now)) {
      skippedAlreadyHandled += 1;
      continue;
    }

    try {
      const updated = await ExceptionService.escalate(
        row.id,
        params.companyId,
        null,
        `SLA vencido al ${now.toISOString()}`,
        exec,
        { expectedStatus: row.status },
      );
      escalatedIds.push(updated.id);

      if (params.onEscalated) {
        try {
          await params.onEscalated(updated);
        } catch (hookError) {
          if (params.abortOnHookError) {
            throw hookError;
          }
          errors.push({
            exceptionId: updated.id,
            message: hookError instanceof Error ? hookError.message : String(hookError),
          });
        }
      }
    } catch (error) {
      if (isApiError(error) && error.statusCode === 409) {
        // Otra corrida concurrente o un reintento ya escaló/cerró esta fila.
        skippedAlreadyHandled += 1;
        continue;
      }
      if (params.abortOnHookError) {
        throw error;
      }
      errors.push({
        exceptionId: row.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    companyId: params.companyId,
    checkedAt: now.toISOString(),
    scanned: candidates.length,
    escalated: escalatedIds.length,
    skippedAlreadyHandled,
    failed: errors.length,
    escalatedIds,
    errors,
  };
}
