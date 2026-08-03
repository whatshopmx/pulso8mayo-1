import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getCashFlowProjection } from "@/lib/services/cash-flow-service";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const daysStr = searchParams.get("days");
    const days = daysStr ? parseInt(daysStr, 10) : 30;

    const projection = await getCashFlowProjection(tenant.id, days);
    return ApiHandler.success(projection);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
