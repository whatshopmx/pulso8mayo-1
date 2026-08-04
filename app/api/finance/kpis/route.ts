import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { calculateFinancialKPIs } from "@/lib/services/financial-kpi-service";

/**
 * GET /api/finance/kpis
 * Returns Food Cost % and Labor Cost % with semaphore statuses
 * for the selected branch and date range.
 *
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). The query `branchId` is passed as
 * `targetBranchId` so ABAC step 2 (branch scoping) can 403 a branch-scoped
 * role (GERENTE/SUPERVISOR/EMPLEADO) that passes a foreign branch's id
 * (docs §3 Brecha 1, §5.1 step 2). When `branchId` is omitted the gate skips
 * step 2 → the aggregate read proceeds as before (no regression); tightening
 * the all-branches default is a CrossBranchService concern (§10.1 item 4).
 *
 * Query params:
 *   - branchId (optional, defaults to all branches)
 *   - startDate (optional, ISO date string)
 *   - endDate   (optional, ISO date string)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      targetBranchId: branchId,
      audit: { action: "READ", req },
    });

    const kpis = await calculateFinancialKPIs({
      companyId: ctx.userCompanyId,
      branchId,
      startDate,
      endDate,
    });

    return ApiHandler.success(kpis);
  } catch (error) {
    return ApiHandler.error(error);
  }
}