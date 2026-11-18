import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { CogsReportScopeError, InventoryReportsService } from "@/lib/services/inventory-reports-service";
import { z } from "zod";
import { isApiError } from "@/lib/api/error";

const dateInput = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const querySchema = z.object({
    branchId: z.uuid().optional(),
    startDate: dateInput.optional(),
    endDate: dateInput.optional(),
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
        if (scope.kind === "NONE") {
            return NextResponse.json({ error: "No tienes una sucursal autorizada" }, { status: 403 });
        }
        if (scope.kind === "ALL") {
            return NextResponse.json(
                { error: "Selecciona una sucursal para ver el reporte de COGS" },
                { status: 400 }
            );
        }

        const endDate = validated.endDate ? new Date(validated.endDate) : new Date();
        const startDate = validated.startDate
            ? new Date(validated.startDate)
            : new Date(endDate.getTime() - 30 * 86400000);
        if (startDate > endDate) {
            return NextResponse.json({ error: "La fecha de inicio debe ser anterior o igual a la fecha de fin" }, { status: 400 });
        }

        const report = await InventoryReportsService.getCogsReport(tenant.id, scope.branchId, startDate, endDate);

        return NextResponse.json({ success: true, report });
    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Parámetros del reporte inválidos" }, { status: 400 });
        }
        if (error instanceof CogsReportScopeError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        console.error("[CogsReport] Error:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
