import { NextRequest } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { getPayrollRuns } from "@/lib/services/payroll-service";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    await requireAuth();

    const runs = await getPayrollRuns(tenant.id);
    return ApiHandler.success(runs);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
