import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { CostingService } from "@/lib/services/costing-service";

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

        const body = await req.json();
        const { branchId, method, reset } = body;

        if (!branchId) {
            return NextResponse.json({ error: "branchId es requerido" }, { status: 400 });
        }

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
        console.error("[CostingConfig] Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
