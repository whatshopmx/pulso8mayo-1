import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
    getDrillById,
    updateDrill,
    deleteDrill,
} from "@/lib/services/civil-protection-service";

const updateDrillSchema = z.object({
    drillType: z.enum([
        "EVACUACION",
        "CONFINAMIENTO",
        "SIMULACRO_GENERAL",
        "SISMO",
        "INCENDIO",
        "OTRO",
    ]).optional(),
    result: z
        .enum(["EXITOSO", "ACEPTABLE", "REQUIERE_MEJORA", "FALLIDO"])
        .nullable()
        .optional(),
    drillDate: z.coerce.date().optional(),
    participantsCount: z.number().int().min(0).optional(),
    evacuationTimeSec: z.number().int().min(0).optional(),
    activatedAlarm: z.boolean().optional(),
    observations: z.string().optional(),
    evidenceUrls: z.array(z.string()).optional(),
    reportUrl: z.string().optional(),
    coordinatorName: z.string().optional(),
    coordinatorPhone: z.string().optional(),
    workflowInstanceId: z.string().uuid().optional(),
});

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { tenantId } = await requireTenantAuth();
        const { id } = await params;
        const drill = await getDrillById(tenantId, id);
        return ApiHandler.success(drill);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { tenantId, user } = await requireTenantAuth();
        const { id } = await params;
        const body = await req.json();
        const data = updateDrillSchema.parse(body);

        if (Object.keys(data).length === 0) {
            throw ApiError.badRequest("No se enviaron campos para actualizar.");
        }

        const drill = await updateDrill(tenantId, user.id, id, data);
        return ApiHandler.success(drill);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { tenantId } = await requireTenantAuth();
        const { id } = await params;
        await deleteDrill(tenantId, id);
        return ApiHandler.success({ deleted: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
