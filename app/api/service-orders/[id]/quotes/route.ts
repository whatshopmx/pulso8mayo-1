import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import { addQuote } from "@/lib/services/service-order-service";

const quoteSchema = z.object({
    // URL devuelta por POST /api/upload (R2 presignado o fallback local).
    url: z.string().min(1).max(2048),
    supplierName: z.string().max(200).nullable().optional(),
    amount: z.number().int().min(0).nullable().optional(), // centavos
    notes: z.string().max(4000).nullable().optional(),
});

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "update")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const { id } = await params;
        const data = quoteSchema.parse(await req.json());
        const quote = await addQuote(tenant.id!, id, data);

        return NextResponse.json({ quote }, { status: 201 });
    } catch (error: unknown) {
        console.error("Failed to add quote to service order", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 },
            );
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 },
        );
    }
}
