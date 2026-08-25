import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { isApiError } from "@/lib/api/error";
import { rejectRequest, type ApprovalDenial } from "@/lib/services/approval-matrix-service";

interface RouteParams {
    params: Promise<{ id: string }>;
}

const DENIAL_STATUS: Record<Exclude<ApprovalDenial, null>, number> = {
    ROLE: 403,
    SELF: 403,
    NOT_CURRENT_LEVEL: 409,
};

export async function POST(req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        const { id } = await params;
        const { reason } = z
            .object({ reason: z.string().min(3).max(2000) })
            .parse(await req.json());

        const outcome = await rejectRequest(id, user.id, user.role, reason, tenant.id!);

        if (!outcome.ok && outcome.denial) {
            const messages: Record<Exclude<ApprovalDenial, null>, string> = {
                ROLE: "Tu rol no cubre la autoridad requerida para este nivel de aprobación",
                SELF: "No puedes rechazar un documento que tú mismo creaste (segregación de funciones)",
                NOT_CURRENT_LEVEL: "Este nivel aún no está habilitado: primero deben resolverse los niveles previos",
            };
            return NextResponse.json(
                { error: messages[outcome.denial] },
                { status: DENIAL_STATUS[outcome.denial] },
            );
        }

        return NextResponse.json(outcome);
    } catch (error: unknown) {
        console.error("Failed to reject request", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Se requiere un motivo del rechazo (mínimo 3 caracteres)", details: error.issues },
                { status: 400 },
            );
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        const message = error instanceof Error ? error.message : "Error interno del servidor";
        if (/no encontrada/.test(message)) {
            return NextResponse.json({ error: message }, { status: 404 });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
