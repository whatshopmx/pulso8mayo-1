import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ProductionService } from "@/lib/services/production-service";

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const branchId = searchParams.get("branchId") || session.user.branchId;

        if (!branchId) {
            return NextResponse.json({ error: "branchId requerido" }, { status: 400 });
        }

        const suggestions = await ProductionService.getSuggestions(session.user.companyId, branchId);
        return NextResponse.json({ success: true, suggestions });
    } catch (error) {
        console.error("Get production suggestions error:", error);
        return NextResponse.json({ error: "Error al obtener sugerencias" }, { status: 500 });
    }
}
