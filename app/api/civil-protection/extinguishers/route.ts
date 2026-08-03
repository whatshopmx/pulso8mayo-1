import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import {
    listExtinguishers,
    listExpiringExtinguishers,
    createExtinguisher,
} from "@/lib/services/civil-protection-service";

const extinguisherStatusEnum = z.enum([
    "OPTIMO",
    "ACEPTABLE",
    "REQUIERE_RECARGA",
    "DESCARTADO",
    "PERDIDO",
]).nullable().optional();

const createExtinguisherSchema = z.object({
    branchId: z.string().uuid(),
    extinguisherId: z.string().min(1),
    location: z.string().min(1),
    extinguisherType: z.string().optional(),
    capacityKg: z.number().int().min(0).optional(),
    inspectionDate: z.coerce.date(),
    pressureOk: z.boolean().nullable().optional(),
    sealOk: z.boolean().nullable().optional(),
    hoseOk: z.boolean().nullable().optional(),
    labelOk: z.boolean().nullable().optional(),
    generalStatus: extinguisherStatusEnum,
    expirationDate: z.coerce.date().nullable().optional(),
    lastRechargeDate: z.coerce.date().nullable().optional(),
    nextInspectionDate: z.coerce.date().nullable().optional(),
    ocrRawData: z.record(z.string(), z.unknown()).optional(),
    ocrProcessedAt: z.coerce.date().optional(),
    evidenceUrl: z.string().optional(),
    inspectorName: z.string().optional(),
    inspectorNotes: z.string().optional(),
    workflowInstanceId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
    try {
        const { tenantId } = await requireTenantAuth();
        const { searchParams } = new URL(request.url);
        const branchId = searchParams.get("branchId") ?? undefined;
        const expiring = searchParams.get("expiring") === "true";
        const withinDays = searchParams.get("withinDays")
            ? parseInt(searchParams.get("withinDays")!, 10)
            : 30;

        if (expiring) {
            const rows = await listExpiringExtinguishers(tenantId, withinDays);
            return ApiHandler.success(rows);
        }

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

        const rows = await listExtinguishers(tenantId, {
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
        const data = createExtinguisherSchema.parse(body);

        const row = await createExtinguisher(tenantId, user.id, data);
        return ApiHandler.success(row, 201);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
