import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitive } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getAuditTrail } from "@/lib/services/control-interno-service";

/**
 * GET /api/finance/control-interno/audit-log
 *
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). The query `branchId` is passed as
 * `targetBranchId` so ABAC step 2 can 403 a branch-scoped role that passes a
 * foreign branch id (docs §3 Brecha 1). Audit trails are aggregates by
 * action/severity — no PII fields, so allow+redact is plaintext-equivalent.
 *
 * Query params:
 *   - branchId   (optional)
 *   - action     (optional: CREATED | APPROVED | REJECTED | PAID)
 *   - startDate  (optional)
 *   - endDate    (optional)
 *   - limit      (optional, default 50)
 *   - offset     (optional, default 0)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;
    const action =
      (searchParams.get("action") as
        | "CREATED"
        | "APPROVED"
        | "REJECTED"
        | "PAID"
        | "EDITED"
        | undefined) || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      targetBranchId: branchId,
      audit: { action: "READ", req },
    });

    // Ver `kpis`: omitir `branchId` dejaba la bitácora sin filtro para un rol
    // acotado a sucursal. Una bitácora vacía se lee bien como "sin
    // movimientos", así que `NONE` devuelve vacío en vez de 403.
    const alcance = resolveBranchScope(ctx.userRole, ctx.userBranchId, branchId);

    const result =
      alcance.kind === "NONE"
        ? { entries: [], total: 0 }
        : await getAuditTrail(ctx.userCompanyId, {
            branchId: alcance.kind === "BRANCH" ? alcance.branchId : undefined,
            action,
            startDate,
            endDate,
            limit,
            offset,
          });

    return ApiHandler.success(maskSensitive(result, decision));
  } catch (error) {
    return ApiHandler.error(error);
  }
}