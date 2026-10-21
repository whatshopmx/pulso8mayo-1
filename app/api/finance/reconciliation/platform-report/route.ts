import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { GatewayReportService } from "@/lib/services/gateway-report-service";
import type { AcquirerType } from "@/lib/services/gateway-report-parser";

/**
 * GET /api/finance/reconciliation/platform-report
 *
 * Reporte de cruce de plataforma: venta cobrada por la plataforma vs neto
 * aterrizado, por adquirente y período, contra los movimientos MATCHED de la
 * conciliación de entradas.
 */
export async function GET(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("reports", "read", {
            classification: "FINANCIAL",
            audit: { action: "READ", req },
        });

        const sp = req.nextUrl.searchParams;
        const rows = await GatewayReportService.getPlatformCrossReport({
            companyId: ctx.userCompanyId,
            acquirer: (sp.get("acquirer") as AcquirerType) || undefined,
            startDate: sp.get("startDate") || undefined,
            endDate: sp.get("endDate") || undefined,
        });

        return ApiHandler.success(rows);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
