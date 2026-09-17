import { NextRequest } from "next/server";
import { equipmentService } from "@/lib/services/equipment-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant } from "@/lib/tenant-context";

export async function GET(request: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId") || tenant.branchId || null;

    const stats = await equipmentService.getEquipmentStats(branchId, tenant.id);

    return ApiHandler.success(stats);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
