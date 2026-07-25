import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { UnitConversionService } from "@/lib/services/unit-conversion-service";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'delete')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    if (!tenant.id) {
      return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
    }

    const deleted = await UnitConversionService.deleteConversion(id, tenant.id);

    if (!deleted) {
      return NextResponse.json({ error: "Conversión no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ message: "Conversión eliminada", id: deleted.id });
  } catch (error) {
    console.error("Failed to delete conversion", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
