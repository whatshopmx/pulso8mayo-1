import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { auditGatewayCommissions } from "@/lib/services/commission-service";

/**
 * GET /api/finance/commissions/audit
 *
 * Ejecuta auditoría matemática de comisiones retenidas vs. tarifas pactadas (Línea 214 propuesta finanzas).
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const searchParams = req.nextUrl.searchParams;
    const branchId = searchParams.get("branchId") || undefined;
    const acquirer = searchParams.get("acquirer") || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const result = await auditGatewayCommissions({
      companyId: ctx.userCompanyId,
      branchId,
      acquirer,
      startDate,
      endDate,
    });

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
