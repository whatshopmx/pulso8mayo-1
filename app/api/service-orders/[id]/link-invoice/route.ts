import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import { linkInvoice } from "@/lib/services/service-order-service";

const linkSchema = z.object({
    invoiceId: z.string().uuid("La factura es obligatoria."),
});

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * PATCH /api/service-orders/[id]/link-invoice
 *
 * Enlace manual de respaldo al auto-match de captura de CFDI
 * (`app/api/inventory/invoices/upload/route.ts`): cubre el candidato
 * ambiguo y la OS que usa `serviceProviderId` en vez de `supplierId`, que el
 * matcher automático no toca.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "update")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const { id } = await params;
        const { invoiceId } = linkSchema.parse(await req.json());

        const order = await linkInvoice(tenant.id!, id, invoiceId);
        return NextResponse.json({ order });
    } catch (error: unknown) {
        console.error("Failed to link invoice to service order", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 },
            );
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
