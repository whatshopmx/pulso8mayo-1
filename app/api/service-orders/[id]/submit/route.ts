import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import { submitOrder } from "@/lib/services/service-order-service";

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * Submit de OS a aprobación (finzasordenes.md §4).
 *
 * Dentro del servicio, en UNA transacción: valida matriz de autorización
 * (cadena vacía → 400), cotizaciones mínimas según el nivel más exigente,
 * presupuesto por sucursal×centro×mes (o tope de emergencias), emite el folio
 * real reemplazando el placeholder DRAFT-*, crea los approval_requests y pasa
 * la orden a PENDING_APPROVAL.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "create")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const { id } = await params;
        const result = await submitOrder(tenant.id!, id);

        return NextResponse.json(result);
    } catch (error: unknown) {
        console.error("Failed to submit service order", error);
        if (isApiError(error)) {
            return NextResponse.json(
                { error: error.message, details: error.details },
                { status: error.statusCode },
            );
        }
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 },
        );
    }
}
