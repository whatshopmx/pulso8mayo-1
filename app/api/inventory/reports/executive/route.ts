import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { ExecutiveReportService } from "@/lib/services/executive-report-service";

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

        const { searchParams } = new URL(req.url);
        const branchId = searchParams.get("branchId") || undefined;

        const startParam = searchParams.get("startDate");
        const endParam = searchParams.get("endDate");

        const endDate = endParam ? new Date(endParam) : new Date();
        const startDate = startParam
            ? new Date(startParam)
            : new Date(endDate.getTime() - 30 * 86400000);

        const report = await ExecutiveReportService.getReport(
            tenant.id,
            startDate,
            endDate,
            branchId
        );

        return NextResponse.json(report);
    } catch (error) {
        console.error("[ExecutiveReport] Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
