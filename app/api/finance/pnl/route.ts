import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getPnLByBranch } from "@/lib/services/pnl-service";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const pnl = await getPnLByBranch(tenant.id, startDate, endDate);
    return ApiHandler.success(pnl);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
