import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { InventoryReportsService } from "@/lib/services/inventory-reports-service";
import { z } from "zod";

const querySchema = z.object({
    branchId: z.string().optional(),
    weeksForAverage: z.coerce.number().int().min(1).max(12).optional(),
});

/**
 * GET /api/inventory/reports/par-level
 * Stock actual vs nivel par por insumo, con cantidad sugerida a pedir.
 * El par combina minLevel configurado y uso semanal promedio escalado por
 * lead time del proveedor.
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
            weeksForAverage: url.searchParams.get("weeksForAverage") || undefined,
        });

        const scope = resolveBranchScope(user.role, user.branchId, validated.branchId);
        if (scope.kind === "NONE" || scope.kind === "ALL") {
            return NextResponse.json(
                { error: "Selecciona una sucursal para ver el reporte de niveles par" },
                { status: 400 }
            );
        }

        const report = await InventoryReportsService.getParLevelReport(scope.branchId, {
            weeksForAverage: validated.weeksForAverage,
        });

        return NextResponse.json({ success: true, report });
    } catch (error) {
        console.error("[ParLevelReport] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Error interno del servidor" },
            { status: 500 }
        );
    }
}
