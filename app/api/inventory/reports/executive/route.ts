import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { ExecutiveReportService } from "@/lib/services/executive-report-service";
import { assertBranchOfCompany, resolveBranchScope } from "@/lib/branch-scope";
import { isApiError } from "@/lib/api/error";
import { z } from "zod";

const dateInput = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const querySchema = z.object({
    branchId: z.uuid().optional(),
    startDate: dateInput.optional(),
    endDate: dateInput.optional(),
});

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
        const { branchId: requestedBranch, startDate: startParam, endDate: endParam } = querySchema.parse({
            branchId: searchParams.get('branchId') ?? undefined,
            startDate: searchParams.get('startDate') ?? undefined,
            endDate: searchParams.get('endDate') ?? undefined,
        });
        const scope = resolveBranchScope(user.role, user.branchId, requestedBranch);
        if (scope.kind === 'NONE') {
            return NextResponse.json({ error: 'No tienes una sucursal autorizada' }, { status: 403 });
        }
        const branchId = scope.kind === 'BRANCH' ? scope.branchId : undefined;

        const endDate = endParam ? new Date(endParam) : new Date();
        const startDate = startParam
            ? new Date(startParam)
            : new Date(endDate.getTime() - 30 * 86400000);

        if (startDate > endDate) {
            return NextResponse.json({ error: 'La fecha de inicio debe ser anterior o igual a la fecha de fin' }, { status: 400 });
        }
        if (branchId) await assertBranchOfCompany(tenant.id, branchId);

        const report = await ExecutiveReportService.getReport(
            tenant.id,
            startDate,
            endDate,
            branchId
        );

        return NextResponse.json(report);
    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Parámetros del reporte inválidos' }, { status: 400 });
        }
        console.error("[ExecutiveReport] Error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
