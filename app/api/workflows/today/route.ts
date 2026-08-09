import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { WorkflowTodayService } from "@/lib/services/workflow-today-service";

/**
 * GET /api/workflows/today[?branchId=]
 *
 * Lo programado para hoy contra lo que realmente pasó. Sin branchId devuelve
 * todas las sucursales de la empresa; con branchId, sólo esa.
 *
 * Cada sucursal reporta su propio día local (branches.timezone), así que el
 * "hoy" de Tijuana y el de Cancún no son el mismo rango.
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: await headers() });

        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
        }

        const branchId = request.nextUrl.searchParams.get("branchId");

        const data = await WorkflowTodayService.getToday(session.user.companyId, branchId);

        return NextResponse.json(data);
    } catch (error) {
        console.error("Error building today board:", error);
        return NextResponse.json(
            { error: "No pudimos cargar el estado de hoy. Vuelve a intentarlo." },
            { status: 500 }
        );
    }
}
