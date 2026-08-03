import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  getSalesSummary,
  getChannelBreakdown,
  getDailySalesTrend,
} from "@/lib/services/sales-analytics-service";

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

    const filter = {
      companyId: tenant.id,
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
}
