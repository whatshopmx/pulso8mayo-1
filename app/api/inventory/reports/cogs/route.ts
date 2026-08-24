import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { InventoryReportsService } from "@/lib/services/inventory-reports-service";
import { z } from "zod";

const querySchema = z.object({
    branchId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});

/**
 * GET /api/inventory/reports/cogs
 * Costo de ventas (COGS) vía expansión de recetas sobre las ventas del
 * periodo, con food cost % contra el revenue registrado.
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
            startDate: url.searchParams.get("startDate") || undefined,
            endDate: url.searchParams.get("endDate") || undefined,
        });

        const scope = resolveBranchScope(user.role, user.branchId, validated.branchId);
        if (scope.kind === "NONE" || scope.kind === "ALL") {
            return NextResponse.json(
                { error: "Selecciona una sucursal para ver el reporte de COGS" },
                { status: 400 }
            );
        }

        const endDate = validated.endDate ? new Date(validated.endDate) : new Date();
        const startDate = validated.startDate
            ? new Date(validated.startDate)
            : new Date(endDate.getTime() - 30 * 86400000);

        const report = await InventoryReportsService.getCogsReport(scope.branchId, startDate, endDate);

        return NextResponse.json({ success: true, report });
    } catch (error) {
        console.error("[CogsReport] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Error interno del servidor" },
            { status: 500 }
        );
    }
}
