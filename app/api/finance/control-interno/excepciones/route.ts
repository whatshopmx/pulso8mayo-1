import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { detectViolations } from "@/lib/services/control-interno-service";

/**
 * GET /api/finance/control-interno/excepciones
 * Returns detected control violations sorted by severity.
 *
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). Returns violation aggregates — no PII
 * fields, so the allow+redact path is plaintext-equivalent to the prior behavior.
 */
export async function GET(_req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
    });

    const violations = await detectViolations(ctx.userCompanyId);
    return ApiHandler.success({
      violations,
      total: violations.length,
      highSeverity: violations.filter((v) => v.severity === "HIGH").length,
      mediumSeverity: violations.filter((v) => v.severity === "MEDIUM").length,
      lowSeverity: violations.filter((v) => v.severity === "LOW").length,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}