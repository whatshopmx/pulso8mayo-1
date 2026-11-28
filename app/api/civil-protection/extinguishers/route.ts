import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import {
    listExtinguishers,
    listExpiringExtinguishers,
    createExtinguisher,
} from "@/lib/services/civil-protection-service";

const CIVIL_PROTECTION_READ_ROLES: ReadonlySet<Role> = new Set([
    "SUPER_ADMIN",
    "OWNER",
    "ADMIN",
    "GERENTE",
    "SUPERVISOR",
    "READONLY",
]);

const CIVIL_PROTECTION_WRITE_ROLES: ReadonlySet<Role> = new Set([
    "SUPER_ADMIN",
    "OWNER",
    "ADMIN",
    "GERENTE",
    "SUPERVISOR",
]);

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
        const auth = await requireTenantAuth();
        const role = auth.user.role as Role;
        if (!CIVIL_PROTECTION_READ_ROLES.has(role)) {
            throw ApiError.forbidden("No tienes permiso para consultar extintores.");
        }

        const { searchParams } = new URL(request.url);
        const scope = resolveBranchScope(role, auth.branchId, searchParams.get("branchId"));
        if (scope.kind === "NONE") {
            return ApiHandler.success([]);
        }
        const branchId = scope.kind === "BRANCH" ? scope.branchId : undefined;
        const expiring = searchParams.get("expiring") === "true";
        const withinDays = searchParams.get("withinDays")
            ? parseInt(searchParams.get("withinDays")!, 10)
            : 30;

        if (expiring) {
            const rows = await listExpiringExtinguishers(auth.tenantId, withinDays);
            const scopedRows = branchId ? rows.filter((r) => r.branchId === branchId) : rows;
            return ApiHandler.success(scopedRows);
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

        const rows = await listExtinguishers(auth.tenantId, {
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
        const auth = await requireTenantAuth();
        const role = auth.user.role as Role;
        if (!CIVIL_PROTECTION_WRITE_ROLES.has(role)) {
            throw ApiError.forbidden("No tienes permiso para registrar inspecciones de extintores.");
        }

        const body = await req.json();
        const data = createExtinguisherSchema.parse(body);

        const scope = resolveBranchScope(role, auth.branchId, data.branchId);
        if (scope.kind === "NONE" || (scope.kind === "BRANCH" && data.branchId !== scope.branchId)) {
            throw ApiError.forbidden("No puedes registrar extintores en otra sucursal.");
        }

        const row = await createExtinguisher(auth.tenantId, auth.user.id, data);
        return ApiHandler.success(row, 201);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
