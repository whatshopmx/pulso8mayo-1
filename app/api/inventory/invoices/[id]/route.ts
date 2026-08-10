import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { InvoiceMatchingService } from "@/lib/services/invoice-matching-service";

const associateSchema = z.object({
    receivingReportId: z.string().uuid(),
    // Opcional: permite corregir la OC a la que queda ligada la factura.
    purchaseOrderId: z.string().uuid().optional().nullable(),
});

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * PATCH /api/inventory/invoices/[id]
 * Asocia una factura ya registrada a un reporte de recepción existente y
 * ejecuta la conciliación (3-way con OC, 2-way sin ella). Cubre el flujo:
 * mercancía recibida primero, CFDI subido después.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const { id } = await params;
        const body = await req.json().catch(() => ({}));
        const parsed = associateSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: "Datos inválidos", details: parsed.error.issues },
                { status: 400 }
            );
        }

        const detail = await InvoiceMatchingService.associateToReceiving(
            id,
            parsed.data.receivingReportId,
            parsed.data.purchaseOrderId ?? undefined,
        );

        return NextResponse.json({ success: true, ...detail });
    } catch (error) {
        console.error("Associate invoice error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Error al asociar la factura" },
            { status: 500 }
        );
    }
}