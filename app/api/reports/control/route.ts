import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { roleIsAtLeast } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import { MONTH_PATTERN, getControlReport } from "@/lib/services/control-kpi-service";

/**
 * GET /api/reports/control?month=YYYY-MM&branchId=...
 *
 * KPIs gerenciales de control OC/OS (finzasordenes.md §7): ejecución
 * presupuestal por sucursal×centro y % de compras de emergencia.
 *
 * Alcance: GERENTE+ . El pin de sucursal del tenant (GERENTE/SUPERVISOR) manda
 * sobre el `branchId` solicitado — igual que en `/api/budgets`.
 */
export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!roleIsAtLeast(user.role, "GERENTE")) {
            return NextResponse.json(
                { error: "Solo GERENTE o rol superior puede ver los KPIs de control" },
                { status: 403 },
            );
        }

        const { searchParams } = new URL(req.url);
        const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
        if (!MONTH_PATTERN.test(month)) {
            return NextResponse.json({ error: "Formato de mes inválido (YYYY-MM)" }, { status: 400 });
        }

        const requestedBranch = searchParams.get("branchId");
        const report = await getControlReport({
            companyId: tenant.id!,
            month,
            branchId: tenant.branchId ?? requestedBranch ?? null,
        });

        return NextResponse.json(report);
    } catch (error: unknown) {
        console.error("Failed to build control report", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
