import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
    getExtinguisherById,
    updateExtinguisher,
    deleteExtinguisher,
    recordExtinguisherOcr,
} from "@/lib/services/civil-protection-service";

const updateExtinguisherSchema = z.object({
    extinguisherId: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    extinguisherType: z.string().optional(),
    capacityKg: z.number().int().min(0).optional(),
    inspectionDate: z.coerce.date().optional(),
    pressureOk: z.boolean().nullable().optional(),
    sealOk: z.boolean().nullable().optional(),
    hoseOk: z.boolean().nullable().optional(),
    labelOk: z.boolean().nullable().optional(),
    generalStatus: z
        .enum(["OPTIMO", "ACEPTABLE", "REQUIERE_RECARGA", "DESCARTADO", "PERDIDO"])
        .nullable()
        .optional(),
    expirationDate: z.coerce.date().nullable().optional(),
    lastRechargeDate: z.coerce.date().nullable().optional(),
    nextInspectionDate: z.coerce.date().nullable().optional(),
    ocrRawData: z.record(z.string(), z.unknown()).optional(),
    ocrProcessedAt: z.coerce.date().nullable().optional(),
    evidenceUrl: z.string().optional(),
    inspectorName: z.string().optional(),
    inspectorNotes: z.string().optional(),
    workflowInstanceId: z.string().uuid().optional(),
});

const ocrSchema = z.object({
    rawText: z.string().optional(),
    fullText: z.string().optional(),
    extractedDates: z.record(z.string(), z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    expirationDate: z.coerce.date().nullable().optional(),
    lastRechargeDate: z.coerce.date().nullable().optional(),
    nextInspectionDate: z.coerce.date().nullable().optional(),
});

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { tenantId } = await requireTenantAuth();
        const { id } = await params;
        const row = await getExtinguisherById(tenantId, id);
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
        const { tenantId, user } = await requireTenantAuth();
        const { id } = await params;
        const body = await req.json();

        // Sub-recurso OCR: PATCH .../extinguishers/{id} con { ocr: {...} }
        // persiste el resultado del motor OCR y las fechas extraidas.
        if (body?.ocr && typeof body.ocr === "object") {
            const ocr = ocrSchema.parse(body.ocr);
            const row = await recordExtinguisherOcr(tenantId, user.id, id, ocr);
            return ApiHandler.success(row);
        }

        const data = updateExtinguisherSchema.parse(body);
        if (Object.keys(data).length === 0) {
            throw ApiError.badRequest("No se enviaron campos para actualizar.");
        }

        const row = await updateExtinguisher(tenantId, user.id, id, data);
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
        await deleteExtinguisher(tenantId, id);
        return ApiHandler.success({ deleted: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
