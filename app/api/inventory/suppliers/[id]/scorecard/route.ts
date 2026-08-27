// app/api/inventory/suppliers/[id]/scorecard/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { SupplierScorecardService } from "@/lib/services/supplier-scorecard-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: supplierId } = await params;
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, "inventory", "read")) {
      return NextResponse.json(
        { error: "No tienes permisos para ver el inventario" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || tenant.branchId || undefined;
    const daysParam = searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 90;

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const endDate = new Date();

    const scorecard = await SupplierScorecardService.calculateScorecard(
      tenant.id,
      supplierId,
      {
        startDate,
        endDate,
        branchId,
      }
    );

    return NextResponse.json({
      success: true,
      data: scorecard,
    });
  } catch (error) {
    console.error("Get supplier scorecard error:", error);
    return NextResponse.json(
      { error: "Error al calcular el scorecard del proveedor" },
      { status: 500 }
    );
  }
}
