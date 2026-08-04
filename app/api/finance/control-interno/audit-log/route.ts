import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getAuditTrail } from "@/lib/services/control-interno-service";

/**
 * GET /api/finance/control-interno/audit-log
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
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;
    const action = searchParams.get("action") as any || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const result = await getAuditTrail(tenant.id, {
      branchId,
      action,
      startDate,
      endDate,
      limit,
      offset,
    });

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
