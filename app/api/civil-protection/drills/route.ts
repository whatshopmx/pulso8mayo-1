import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import {
    listDrills,
    createDrill,
} from "@/lib/services/civil-protection-service";

const drillTypeEnum = z.enum([
    "EVACUACION",
    "CONFINAMIENTO",
    "SIMULACRO_GENERAL",
    "SISMO",
    "INCENDIO",
    "OTRO",
]);

const drillResultEnum = z
    .enum(["EXITOSO", "ACEPTABLE", "REQUIERE_MEJORA", "FALLIDO"])
    .nullable()
    .optional();

const createDrillSchema = z.object({
    branchId: z.string().uuid(),
    drillType: drillTypeEnum,
    result: drillResultEnum,
    drillDate: z.coerce.date(),
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

        const drills = await listDrills(tenantId, {
            branchId,
            startDate,
            endDate,
            limit,
            offset,
        });
        return ApiHandler.success(drills);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { tenantId, user } = await requireTenantAuth();
        const body = await req.json();
        const data = createDrillSchema.parse(body);

        const drill = await createDrill(tenantId, user.id, data);
        return ApiHandler.success(drill, 201);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
