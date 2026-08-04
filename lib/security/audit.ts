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
 */
import { db } from "@/lib/db";
import { dataAccessLogs } from "@/lib/db/schema/security";
import type { AccessDecision } from "@/lib/rbac/abac";
import type { NextRequest } from "next/server";

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
 * Persist a data-access audit row. Best-effort: never throws (audit must not
 * break the request path). Mirrors the convention in `lib/services/audit-service.ts`.
 */
export async function logDataAccess(
  input: LogDataAccessInput,
): Promise<void> {
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
    // Audit must never break the request. Log and continue.
    console.error("[logDataAccess] failed to write data_access_logs:", error);
  }
}