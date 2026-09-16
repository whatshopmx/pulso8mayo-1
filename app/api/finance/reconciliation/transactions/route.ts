import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { GatewayReportService } from "@/lib/services/gateway-report-service";
import type { AcquirerType } from "@/lib/services/gateway-report-parser";

/**
 * GET /api/finance/reconciliation/transactions
 *
 * Consulta transacciones de pasarela importadas con filtros de sucursal, fechas y adquirente.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const searchParams = req.nextUrl.searchParams;
    const branchId = searchParams.get("branchId") || undefined;
    const acquirer = (searchParams.get("acquirer") as AcquirerType) || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : 100;
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!, 10)
      : 0;

    const result = await GatewayReportService.getTransactions({
      companyId: ctx.userCompanyId,
      branchId,
      acquirer,
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
