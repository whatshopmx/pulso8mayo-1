import { NextRequest } from "next/server";
import { BranchService } from "@/lib/services/branch-service";
import { ApiHandler } from "@/lib/api/response";
import { createBranchSchema } from "@/lib/validations/branch";
import { requireTenant } from "@/lib/tenant-context";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { requireRoleApi } from "@/lib/rbac/require-role";
import type { UserRole } from "@/lib/rbac/permissions";
import type { Role } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";

/**
 * H4 (`tasks/plan-imss-operacion.md`): crear o editar una sucursal exige rol
 * administrativo. En `GET`, cada rol recibe únicamente las sucursales dentro
 * de su alcance y nunca se exponen `inviteToken` / `managerInviteToken` a
 * roles sin permiso de invitación.
 */
const BRANCH_WRITE_ROLES: UserRole[] = ['SUPER_ADMIN', 'OWNER', 'ADMIN'];
const COMPANY_ADMIN_ROLES: ReadonlySet<Role> = new Set(['SUPER_ADMIN', 'OWNER', 'ADMIN']);

export async function GET(_req: NextRequest) {
    try {
        const auth = await requireTenantAuth();
        const role = auth.user.role as Role;

        const scope = resolveBranchScope(role, auth.branchId, null);
        if (scope.kind === 'NONE') {
            return ApiHandler.success([]);
        }

        const branches = await BranchService.listBranches(auth.tenantId);
        const visibleBranches =
            scope.kind === 'BRANCH'
                ? branches.filter((b) => b.id === scope.branchId)
                : branches;

        const isCompanyAdmin = COMPANY_ADMIN_ROLES.has(role);
        const sanitized = visibleBranches.map((branch) => {
            const { inviteToken, managerInviteToken, ...safeBranch } = branch as Record<string, unknown>;
            const canSeeManagerToken = isCompanyAdmin;
            const canSeeInviteToken =
                isCompanyAdmin || (role === 'GERENTE' && branch.id === auth.branchId);
            return {
                ...safeBranch,
                ...(canSeeInviteToken ? { inviteToken } : {}),
                ...(canSeeManagerToken ? { managerInviteToken } : {}),
            };
        });

        return ApiHandler.success(sanitized);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        await requireRoleApi(BRANCH_WRITE_ROLES);
        const tenant = await requireTenant();
        const body = await req.json();
        const data = createBranchSchema.parse(body);

        // Force companyId from tenant
        data.companyId = tenant.id!;

        const branch = await BranchService.createBranch(data);
        return ApiHandler.success(branch, 201);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
