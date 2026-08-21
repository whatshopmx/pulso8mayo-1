import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import {
  getSalesSummary,
  getChannelBreakdown,
  getDailySalesTrend,
} from "@/lib/services/sales-analytics-service";

/**
 * Mismos roles que el resto de Ventas y Finanzas: `EMPLEADO` y `READONLY`
 * quedan fuera. La razón está escrita en `app/api/sales/cuts/route.ts`.
 */
const ROLES_VENTAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

export const GET = withRoleAuth([...ROLES_VENTAS], async (req, { auth }) => {
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const filter = {
      companyId: auth.tenantId,
      branchId,
      startDate,
      endDate,
    };

    const [summary, channelBreakdown, trend] = await Promise.all([
      getSalesSummary(filter),
      getChannelBreakdown(filter),
      getDailySalesTrend(filter),
    ]);

    return ApiHandler.success({
      summary,
      channelBreakdown,
      trend,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
});
