/**
 * Pilar 3 / §9 — General audit log for access to classified data.
 *
 * Source: docs/pulso-executive-os-security.md §9.1.
 *
 * `data_access_logs` records READ/EXPORT/UPDATE/DELETE/APPROVE on classified
 * data (FINANCIAL/SENSITIVE). This is distinct from `employeeAuditLogs`
 * (which traces employee-record mutations) — `dataAccessLogs` is for the
 * *access decision* itself, including denies (attack signal, §9).
 *
 * Usage: routes migrated to `requirePermissionApi` pass `audit: { action, req }`
 * to the guard; the guard logs the decision (allow or deny) here at a single
 * chokepoint so denies — which throw before the route body runs — are still
 * recorded. Functions may also call `logDataAccess` directly for non-guard
 * access paths.
 *
 * AUD-02 Extension:
 * For critical administrative operations (Frente D: aprobaciones financieras APR-01,
 * cierre de períodos FIN-02.a, o correcciones de depósitos BAN-06.b), se expone
 * `logCriticalDataAccess`:
 * - Exige `reason` explícito y no vacío.
 * - Exige ejecutarse dentro de la transacción activa (`DbExecutor`).
 * - Propaga el error para revertir la acción financiera si la bitácora falla.
 */
import { db } from "@/lib/db";
import { dataAccessLogs } from "@/lib/db/schema/security";
import type { AccessDecision } from "@/lib/rbac/abac";
import type { NextRequest } from "next/server";
import type { DbExecutor } from "@/lib/services/fefo-allocator";
import { validateAuditReason, assertTransactionExecutor } from "@/lib/services/audit-service";

export type DataAccessAction =
  | "READ"
  | "EXPORT"
  | "UPDATE"
  | "DELETE"
  | "APPROVE";

export interface LogDataAccessInput {
  userId: string;
  companyId: string;
  branchId?: string | null;
  action: DataAccessAction;
  /** Resource accessed (ABAC resource name or table.column). */
  resource: string;
  resourceId?: string;
  /** Snapshot of the AccessDecision (incl. `reason` on deny). */
  decision: AccessDecision;
  /** Fields masked in the response (CSV); derived from `decision.redactFields`. */
  redactedFields?: string[];
  /** The inbound request — provides ipAddress/userAgent. */
  req?: NextRequest | null;
  /** Reason for the critical access/mutation (AUD-02). */
  reason?: string | null;
  /** Transacción activa para persistencia atómica (AUD-02). */
  executor?: DbExecutor;
}

export interface LogCriticalDataAccessInput extends LogDataAccessInput {
  reason: string;
}

/** Extract ipAddress + userAgent from a NextRequest (best-effort). */
export function extractRequestMeta(req?: NextRequest | null): {
  ipAddress?: string;
  userAgent?: string;
} {
  if (!req) return {};
  const forwarded = req.headers.get("x-forwarded-for");
  const ipAddress = forwarded
    ? forwarded.split(",")[0]?.trim()
    : req.headers.get("x-real-ip") ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  return { ipAddress, userAgent };
}

/**
 * AUD-02: Persiste una bitácora de acceso o mutación crítica de datos clasificados
 * dentro de la misma transacción Postgres. Si la inserción falla, el error propaga
 * y revierte la mutación del llamador.
 */
export async function logCriticalDataAccess(
  input: LogCriticalDataAccessInput,
  executor: DbExecutor,
): Promise<void> {
  const tx = assertTransactionExecutor(executor);
  const validatedReason = validateAuditReason(input.reason, true)!;

  const { ipAddress, userAgent } = extractRequestMeta(input.req);
  const decisionPayload = {
    ...(input.decision as unknown as Record<string, unknown>),
    reason: validatedReason,
  };

  await tx.insert(dataAccessLogs).values({
    userId: input.userId,
    companyId: input.companyId,
    branchId: input.branchId ?? null,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    accessDecision: decisionPayload,
    redactedFields: input.redactedFields?.length
      ? input.redactedFields.join(",")
      : null,
    ipAddress,
    userAgent,
    performedAt: new Date(),
  });
}

/**
 * Persist a data-access audit row.
 * - Si se suministra `executor` transaccional y la acción es crítica con `reason`,
 *   ejecuta atómicamente y propaga errores (AUD-02).
 * - Para rutas de guardia y accesos de lectura no transaccionales, conserva la semántica
 *   best-effort original (nunca interrumpe la petición; registra error en consola).
 */
export async function logDataAccess(
  input: LogDataAccessInput,
): Promise<void> {
  if (input.executor && input.executor !== db && input.reason) {
    return logCriticalDataAccess(input as LogCriticalDataAccessInput, input.executor);
  }

  try {
    const { ipAddress, userAgent } = extractRequestMeta(input.req);
    await db.insert(dataAccessLogs).values({
      userId: input.userId,
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      accessDecision: input.decision as unknown as Record<string, unknown>,
      redactedFields: input.redactedFields?.length
        ? input.redactedFields.join(",")
        : null,
      ipAddress,
      userAgent,
      performedAt: new Date(),
    });
  } catch (error) {
    // Non-critical audit must never break the request. Log and continue.
    console.error("[logDataAccess] failed to write data_access_logs:", error);
  }
}
