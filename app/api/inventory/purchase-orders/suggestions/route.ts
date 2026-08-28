import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { InventoryReportsService } from "@/lib/services/inventory-reports-service";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";

/**
 * GET /api/inventory/purchase-orders/suggestions?branchId=...
 *
 * Retorna las sugerencias de compra de insumos calculadas contra los par levels
 * configurados y el consumo histórico de la sucursal (finzasordenes.md §3 / Módulo 1).
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, "inventory", "read")) {
      throw ApiError.forbidden("No tienes permisos para consultar sugerencias de inventario.");
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");

    if (!branchId) {
      throw ApiError.badRequest("El parámetro branchId es requerido.");
    }

    const report = await InventoryReportsService.getParLevelReport(branchId);
    const suggestions = report.rows.filter((r) => r.suggestedOrderQty > 0);

    return ApiHandler.success({
      branchId,
      totalBelowPar: report.belowParCount,
      suggestions,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
