import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { maskSensitiveList } from "@/lib/rbac/masking";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { detectViolations } from "@/lib/services/control-interno-service";

/**
 * GET /api/finance/control-interno/excepciones
 * Returns detected control violations sorted by severity.
 *
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). Returns violation aggregates — no PII
 * fields, so the allow+redact path is plaintext-equivalent to the prior behavior.
 *
 * Query params:
 *   - branchId (optional) — se pasa como `targetBranchId` para que ABAC pueda
 *     403 a un rol acotado a sucursal que solicite una ajena.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;

    const { ctx, decision } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      targetBranchId: branchId,
      audit: { action: "READ", req },
    });

    // Ver `kpis`: omitir `branchId` dejaba la consulta sin filtro para un rol
    // acotado a sucursal.
    const alcance = resolveBranchScope(ctx.userRole, ctx.userBranchId, branchId);

    // Aquí sí se devuelve vacío, a diferencia de los agregados de dinero: una
    // lista de excepciones sin filas se lee correctamente como "ninguna", y es
    // la verdad para quien no alcanza ninguna sucursal.
    const violations =
      alcance.kind === "NONE"
        ? []
        : await detectViolations(
            ctx.userCompanyId,
            alcance.kind === "BRANCH" ? alcance.branchId : undefined
          );
    const payload = {
      violations: maskSensitiveList(violations, decision),
      total: violations.length,
      highSeverity: violations.filter((v) => v.severity === "HIGH").length,
      mediumSeverity: violations.filter((v) => v.severity === "MEDIUM").length,
      lowSeverity: violations.filter((v) => v.severity === "LOW").length,
    };
    return ApiHandler.success(payload);
  } catch (error) {
    return ApiHandler.error(error);
  }
}