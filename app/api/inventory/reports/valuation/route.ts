import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { InventoryReportsService } from "@/lib/services/inventory-reports-service";
import { z } from "zod";

const querySchema = z.object({
    branchId: z.string().optional(),
});

/**
 * GET /api/inventory/reports/valuation
 * Valorización del inventario actual (cantidad × costo), por ítem y categoría.
 * Sin `branchId` devuelve el consolidado de la empresa (roles corporativos).
 */
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

        const url = new URL(req.url);
        const validated = querySchema.parse({
            branchId: url.searchParams.get("branchId") || undefined,
        });

        const scope = resolveBranchScope(user.role, user.branchId, validated.branchId);
        if (scope.kind === "NONE") {
            return NextResponse.json(
                { error: "Tu rol requiere una sucursal asignada para ver la valorización" },
                { status: 403 }
            );
        }

        const report = await InventoryReportsService.getValuationReport(
            tenant.id,
            scope.kind === "BRANCH" ? scope.branchId : undefined
        );

        return NextResponse.json({ success: true, report });
    } catch (error) {
        console.error("[ValuationReport] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Error interno del servidor" },
            { status: 500 }
        );
    }
}
