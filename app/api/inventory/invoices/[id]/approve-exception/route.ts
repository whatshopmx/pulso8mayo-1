import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission, roleIsAtLeast } from "@/lib/permissions";
import { InvoiceMatchingService } from "@/lib/services/invoice-matching-service";
import { z } from "zod";

const approveExceptionSchema = z.object({
  reason: z.string().min(5, "El motivo de la excepción debe tener al menos 5 caracteres"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    // Solo roles con permisos de gestión de inventario/auditoría pueden autorizar excepciones (Módulo 5.2)
    if (!hasPermission(user.role, "inventory", "manage") && !roleIsAtLeast(user.role, "GERENTE")) {
      return NextResponse.json(
        { error: "No tienes permisos de auditoría para autorizar excepciones en 3-Way Match" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const validated = approveExceptionSchema.parse(body);

    const updated = await InvoiceMatchingService.approveMatchException(
      invoiceId,
      tenant.id,
      user.id,
      validated.reason
    );

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error: any) {
    console.error("Approve match exception error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Datos inválidos", details: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error?.message || "Error al autorizar la excepción" },
      { status: 500 }
    );
  }
}
