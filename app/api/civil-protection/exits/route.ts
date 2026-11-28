import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import {
    listExitChecklist,
    createExitChecklistItem,
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
        const auth = await requireTenantAuth();
        const role = auth.user.role as Role;
        if (!CIVIL_PROTECTION_READ_ROLES.has(role)) {
            throw ApiError.forbidden("No tienes permiso para consultar salidas de emergencia.");
        }

        const { searchParams } = new URL(request.url);
        const scope = resolveBranchScope(role, auth.branchId, searchParams.get("branchId"));
        if (scope.kind === "NONE") {
            return ApiHandler.success([]);
        }
        const branchId = scope.kind === "BRANCH" ? scope.branchId : undefined;
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

        const rows = await listExitChecklist(auth.tenantId, {
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
            throw ApiError.forbidden("No tienes permiso para registrar salidas de emergencia.");
        }

        const body = await req.json();
        const data = createExitChecklistSchema.parse(body);

        const scope = resolveBranchScope(role, auth.branchId, data.branchId);
        if (scope.kind === "NONE" || (scope.kind === "BRANCH" && data.branchId !== scope.branchId)) {
            throw ApiError.forbidden("No puedes registrar salidas de emergencia en otra sucursal.");
        }

        const row = await createExitChecklistItem(auth.tenantId, auth.user.id, data);
        return ApiHandler.success(row, 201);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
