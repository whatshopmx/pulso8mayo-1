import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";
import { assertBranchOfCompany, resolveBranchScope } from "@/lib/branch-scope";
import { ApiError, isApiError } from "@/lib/api/error";
import { CostingService } from "@/lib/services/costing-service";

/**
 * El método de costeo se configura por sucursal, así que su frontera es la
 * misma que la del resto del módulo: alcance del rol primero —para no gastar ni
 * una consulta en un id que ya se sabe ajeno— y empresa después, porque
 * `branch_id` no dice de quién es la fila.
 *
 * `PATCH` comprobaba `inventory:update` y nada más: un `GERENTE` o un
 * `SUPERVISOR` con permiso de inventario podía cambiar el método de una
 * sucursal de otra empresa con el id (H02). El tenant se obtenía y no se
 * usaba.
 */
async function assertSucursalDeCosteo(
    companyId: string,
    role: Role,
    userBranchId: string | null | undefined,
    branchId: string
): Promise<void> {
    const alcance = resolveBranchScope(role, userBranchId, null);

    if (alcance.kind === "NONE") {
        throw ApiError.forbidden(
            "Tu usuario no tiene una sucursal asignada, así que no puede cambiar el método de costeo. Pide que te asignen una."
        );
    }

    if (alcance.kind === "BRANCH" && branchId !== alcance.branchId) {
        throw ApiError.forbidden("No puedes cambiar el método de costeo de otra sucursal.");
    }

    await assertBranchOfCompany(companyId, branchId);
}

export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, 'inventory', 'read')) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        if (!tenant.id) {
            return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
        }

        const configs = await CostingService.getConfigs(tenant.id);
        return NextResponse.json({ configs });
    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("[CostingConfig] Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, 'inventory', 'update')) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        if (!tenant.id) {
            return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
        }

        const body = await req.json();
        const { branchId, method, reset } = body;

        if (!branchId) {
            return NextResponse.json({ error: "branchId es requerido" }, { status: 400 });
        }

        // Antes de tocar nada: la sucursal tiene que ser de esta empresa y estar
        // en el alcance del rol. La llave foránea no lo dice —la sucursal
        // existe, sólo que no es tuya—, así que sin esto un id adivinaba cambia
        // el costeo de otro tenant.
        await assertSucursalDeCosteo(tenant.id, user.role, user.branchId, branchId);

        if (reset) {
            await CostingService.clearBranchMethod(branchId);
        } else if (method) {
            if (!['LAST_COST', 'AVERAGE_COST'].includes(method)) {
                return NextResponse.json({ error: "Método inválido. Usar LAST_COST o AVERAGE_COST" }, { status: 400 });
            }
            await CostingService.updateBranchMethod(branchId, method);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("[CostingConfig] Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
