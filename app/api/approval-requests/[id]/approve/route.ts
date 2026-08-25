import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { isApiError } from "@/lib/api/error";
import { approveRequest, type ApprovalDenial } from "@/lib/services/approval-matrix-service";

interface RouteParams {
    params: Promise<{ id: string }>;
}

const DENIAL_MESSAGES: Record<Exclude<ApprovalDenial, null>, { status: number; message: string }> = {
    ROLE: {
        status: 403,
        message: "Tu rol no cubre la autoridad requerida para este nivel de aprobación",
    },
    SELF: {
        status: 403,
        message: "No puedes aprobar un documento que tú mismo creaste (segregación de funciones)",
    },
    NOT_CURRENT_LEVEL: {
        status: 409,
        message: "Este nivel aún no está habilitado: primero deben resolverse los niveles previos",
    },
};

export async function POST(_req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        const { id } = await params;
        const outcome = await approveRequest(id, user.id, user.role, tenant.id!);

        if (!outcome.ok && outcome.denial) {
            const mapped = DENIAL_MESSAGES[outcome.denial];
            return NextResponse.json({ error: mapped.message }, { status: mapped.status });
        }

        return NextResponse.json(outcome);
    } catch (error: unknown) {
        console.error("Failed to approve request", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        const message = error instanceof Error ? error.message : "Error interno del servidor";
        // "no encontrada" del servicio → 404 en vez de 500.
        if (/no encontrada/.test(message)) {
            return NextResponse.json({ error: message }, { status: 404 });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
