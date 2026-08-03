import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
    getExitChecklistItemById,
    updateExitChecklistItem,
    deleteExitChecklistItem,
} from "@/lib/services/civil-protection-service";

const updateExitChecklistSchema = z.object({
    exitLocation: z.string().min(1).optional(),
    isClear: z.boolean().optional(),
    signageOk: z.boolean().optional(),
    emergencyLightOk: z.boolean().optional(),
    doorOpensOk: z.boolean().optional(),
    accessWidthCm: z.number().int().min(0).optional(),
    photoUrl: z.string().optional(),
    photos: z.array(z.string()).optional(),
    notes: z.string().optional(),
    issuesDetected: z.string().optional(),
    inspectedAt: z.coerce.date().optional(),
    inspectionRound: z.string().optional(),
    workflowInstanceId: z.string().uuid().optional(),
});

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { tenantId } = await requireTenantAuth();
        const { id } = await params;
        const row = await getExitChecklistItemById(tenantId, id);
        return ApiHandler.success(row);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { tenantId } = await requireTenantAuth();
        const { id } = await params;
        const body = await req.json();
        const data = updateExitChecklistSchema.parse(body);

        if (Object.keys(data).length === 0) {
            throw ApiError.badRequest("No se enviaron campos para actualizar.");
        }

        const row = await updateExitChecklistItem(tenantId, id, data);
        return ApiHandler.success(row);
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
        await deleteExitChecklistItem(tenantId, id);
        return ApiHandler.success({ deleted: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
