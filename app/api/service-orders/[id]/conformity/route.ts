import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission, roleIsAtLeast } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import { signConformity } from "@/lib/services/service-order-service";

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * Firma de conformidad del gerente (finzasordenes.md §5): cierra la OS.
 * Solo GERENTE+ y solo con la orden en PENDING_CONFORMITY. Registro simple
 * usuario+timestamp — sin firma digital (open question del plan).
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "update")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }
        if (!roleIsAtLeast(user.role, "GERENTE")) {
            return NextResponse.json(
                { error: "Solo un GERENTE o rol superior puede firmar la conformidad" },
                { status: 403 },
            );
        }

        const { id } = await params;
        const order = await signConformity(tenant.id!, id, {
            id: user.id,
            role: user.role,
            displayName: user.name || user.email || user.id,
        });

        return NextResponse.json({ order });
    } catch (error: unknown) {
        console.error("Failed to sign conformity for service order", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 },
        );
    }
}
