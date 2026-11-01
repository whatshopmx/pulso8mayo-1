import { NextRequest } from "next/server";
import { BranchService } from "@/lib/services/branch-service";
import { ApiHandler } from "@/lib/api/response";
import { createBranchSchema } from "@/lib/validations/branch";
import { requireTenant } from "@/lib/tenant-context";
import { requireRoleApi } from "@/lib/rbac/require-role";
import type { UserRole } from "@/lib/rbac/permissions";

/**
 * H4 (`tasks/plan-imss-operacion.md`): crear o editar una sucursal no tenía
 * guard de rol — sólo `requireTenant()`. Cualquier sesión de la empresa
 * (incluido `EMPLEADO` o `READONLY`) podía escribir `branches`, y desde
 * `plan-imss` esa fila también decide el registro patronal IMSS. El guard va
 * aquí, no en la pantalla: `/dashboard/company` oculta el enlace, pero una
 * petición directa no pasa por el sidebar.
 *
 * `GET` se queda abierto a toda la sesión: lo consume el selector de sucursal
 * de casi todas las pantallas, y restringirlo rompería el alcance por sucursal
 * de roles que sí deben leer la lista.
 */
const BRANCH_WRITE_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN'];

export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        
        // If user doesn't have a company assigned, return empty list
        if (!tenant.id) {
            return ApiHandler.success([]);
        }
        
        const branches = await BranchService.listBranches(tenant.id);
        return ApiHandler.success(branches);
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
