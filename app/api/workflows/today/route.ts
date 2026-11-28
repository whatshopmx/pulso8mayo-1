import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { WorkflowTodayService } from "@/lib/services/workflow-today-service";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";

/**
 * GET /api/workflows/today[?branchId=]
 *
 * Lo programado para hoy contra lo que realmente pasó. Los roles de alcance
 * de empresa (`SUPER_ADMIN`, `OWNER`, `ADMIN`) ven todas las sucursales o la
 * filtrada por `?branchId=`; los roles acotados (`GERENTE`, `SUPERVISOR`,
 * `EMPLEADO`, `READONLY`) quedan restringidos a su sucursal asignada.
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: await headers() });

        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
        }

        const role = (session.user as { role?: Role }).role;
        const userBranchId = (session.user as { branchId?: string | null }).branchId ?? null;
        if (!role) {
            return NextResponse.json({ error: "Rol no autorizado." }, { status: 403 });
        }

        const requestedBranchId = request.nextUrl.searchParams.get("branchId");
        const scope = resolveBranchScope(role, userBranchId, requestedBranchId);

        if (scope.kind === "NONE") {
            return NextResponse.json({
                generatedAt: new Date().toISOString(),
                branches: [],
            });
        }

        const effectiveBranchId = scope.kind === "BRANCH" ? scope.branchId : null;
        const data = await WorkflowTodayService.getToday(session.user.companyId, effectiveBranchId);

        return NextResponse.json(data);
    } catch (error) {
        console.error("Error building today board:", error);
        return NextResponse.json(
            { error: "No pudimos cargar el estado de hoy. Vuelve a intentarlo." },
            { status: 500 }
        );
    }
}
