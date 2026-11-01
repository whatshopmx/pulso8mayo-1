import { NextRequest } from "next/server";
import { BranchService } from "@/lib/services/branch-service";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { updateBranchSchema } from "@/lib/validations/branch";
import { requireTenant } from "@/lib/tenant-context";
import { requireRoleApi } from "@/lib/rbac/require-role";
import type { UserRole } from "@/lib/rbac/permissions";

/**
 * H4 (`tasks/plan-imss-operacion.md`): el `PATCH` sólo comprobaba pertenencia
 * (`requireTenant` + `getBranch`), así que cualquier sesión de la empresa podía
 * reescribir la sucursal —incluido su registro patronal—. La edición vive en
 * `/dashboard/company`, que es `SUPER_ADMIN`/`ADMIN`; el guard replica esa
 * decisión en el servidor.
 *
 * `DELETE` no desactiva una tabla: marca `active = false`, lo que saca a la
 * sucursal de los selectores y de las consultas de alcance. Se protege con el
 * mismo criterio porque el hueco era el mismo.
 */
const BRANCH_WRITE_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN'];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const tenant = await requireTenant();
        
        // If user doesn't have a company assigned, return appropriate response
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }
        
        const { id } = await params;
        const branch = await BranchService.getBranch(id, tenant.id!);
        return ApiHandler.success(branch);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requireRoleApi(BRANCH_WRITE_ROLES);
        const tenant = await requireTenant();
        
        // If user doesn't have a company assigned, reject the request
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }
        
        const { id } = await params;

        // Verify ownership via getBranch implicitly or explicit check
        await BranchService.getBranch(id, tenant.id!);

        const body = await req.json();
        const data = updateBranchSchema.parse(body);
        const updated = await BranchService.updateBranch(id, data, tenant.id!);
        return ApiHandler.success(updated);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await requireRoleApi(BRANCH_WRITE_ROLES);
        const tenant = await requireTenant();
        
        // If user doesn't have a company assigned, reject the request
        if (!tenant.id) {
            return ApiHandler.error(ApiError.forbidden("Company not assigned to user"));
        }
        
        const { id } = await params;
        await BranchService.getBranch(id, tenant.id!); // ownership check
        await BranchService.deleteBranch(id, tenant.id!);
        return ApiHandler.success({ message: "Branch deleted" });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
