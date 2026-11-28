import { NextRequest } from "next/server";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { getCivilProtectionKpis } from "@/lib/services/civil-protection-service";

const CIVIL_PROTECTION_READ_ROLES: ReadonlySet<Role> = new Set([
    "SUPER_ADMIN",
    "OWNER",
    "ADMIN",
    "GERENTE",
    "SUPERVISOR",
    "READONLY",
]);

export async function GET(request: NextRequest) {
    try {
        const auth = await requireTenantAuth();
        const role = auth.user.role as Role;
        if (!CIVIL_PROTECTION_READ_ROLES.has(role)) {
            throw ApiError.forbidden("No tienes permiso para consultar Protección Civil.");
        }

        const { searchParams } = new URL(request.url);
        const scope = resolveBranchScope(role, auth.branchId, searchParams.get("branchId"));
        if (scope.kind === "NONE") {
            throw ApiError.forbidden("Tu usuario no tiene una sucursal asignada.");
        }

        const effectiveBranch = scope.kind === "BRANCH" ? scope.branchId : undefined;
        const kpis = await getCivilProtectionKpis(auth.tenantId, effectiveBranch);
        return ApiHandler.success(kpis);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
