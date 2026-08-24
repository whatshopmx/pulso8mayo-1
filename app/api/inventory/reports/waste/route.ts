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
 * GET /api/inventory/reports/waste
 * Mermas agregadas por razón e insumo. Sin `branchId` consolida la empresa.
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
        if (scope.kind === "NONE") {
            return NextResponse.json(
                { error: "Tu rol requiere una sucursal asignada para ver el reporte de mermas" },
                { status: 403 }
            );
        }

        const endDate = validated.endDate ? new Date(validated.endDate) : new Date();
        const startDate = validated.startDate
            ? new Date(validated.startDate)
            : new Date(endDate.getTime() - 30 * 86400000);

        const report = await InventoryReportsService.getWasteReport(
            tenant.id,
            startDate,
            endDate,
            scope.kind === "BRANCH" ? scope.branchId : undefined
        );

        return NextResponse.json({ success: true, report });
    } catch (error) {
        console.error("[WasteReport] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Error interno del servidor" },
            { status: 500 }
        );
    }
}
