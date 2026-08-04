import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { calculateFinancialKPIs } from "@/lib/services/financial-kpi-service";

/**
 * GET /api/finance/kpis
 * Returns Food Cost % and Labor Cost % with semaphore statuses
 * for the selected branch and date range.
 *
 * Query params:
 *   - branchId (optional, defaults to all branches)
 *   - startDate (optional, ISO date string)
 *   - endDate   (optional, ISO date string)
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const kpis = await calculateFinancialKPIs({
      companyId: tenant.id,
      branchId,
      startDate,
      endDate,
    });

    return ApiHandler.success(kpis);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
