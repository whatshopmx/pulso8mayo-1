import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import {
    listExitChecklist,
    createExitChecklistItem,
} from "@/lib/services/civil-protection-service";

const createExitChecklistSchema = z.object({
    branchId: z.string().uuid(),
    exitLocation: z.string().min(1),
    isClear: z.boolean(),
    signageOk: z.boolean(),
    emergencyLightOk: z.boolean(),
    doorOpensOk: z.boolean(),
    accessWidthCm: z.number().int().min(0).optional(),
    photoUrl: z.string().optional(),
    photos: z.array(z.string()).optional(),
    notes: z.string().optional(),
    issuesDetected: z.string().optional(),
    inspectedAt: z.coerce.date().default(() => new Date()),
    inspectionRound: z.string().optional(),
    workflowInstanceId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
    try {
        const { tenantId } = await requireTenantAuth();
        const { searchParams } = new URL(request.url);
        const branchId = searchParams.get("branchId") ?? undefined;
        const startDate = searchParams.get("startDate")
            ? new Date(searchParams.get("startDate")!)
            : undefined;
        const endDate = searchParams.get("endDate")
            ? new Date(searchParams.get("endDate")!)
            : undefined;
        const limit = searchParams.get("limit")
            ? parseInt(searchParams.get("limit")!, 10)
            : undefined;
        const offset = searchParams.get("offset")
            ? parseInt(searchParams.get("offset")!, 10)
            : undefined;

        const rows = await listExitChecklist(tenantId, {
            branchId,
            startDate,
            endDate,
            limit,
            offset,
        });
        return ApiHandler.success(rows);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { tenantId, user } = await requireTenantAuth();
        const body = await req.json();
        const data = createExitChecklistSchema.parse(body);

        const row = await createExitChecklistItem(tenantId, user.id, data);
        return ApiHandler.success(row, 201);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
