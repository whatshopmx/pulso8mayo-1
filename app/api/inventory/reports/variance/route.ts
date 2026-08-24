import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { ReportsService } from "@/lib/services/reports-service";
import { z } from "zod";

const querySchema = z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const validated = querySchema.parse({
            startDate: url.searchParams.get("startDate") || undefined,
            endDate: url.searchParams.get("endDate") || undefined,
        });

        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(role, session.user.branchId, url.searchParams.get("branchId"));
        if (!branchId) {
            return NextResponse.json(
                { error: "Selecciona una sucursal para ver el reporte de varianza" },
                { status: 400 }
            );
        }

        // Default to last 30 days if not provided
        const endDate = validated.endDate ? new Date(validated.endDate) : new Date();
        const startDate = validated.startDate 
            ? new Date(validated.startDate) 
            : new Date(new Date().setDate(endDate.getDate() - 30));

        const report = await ReportsService.getVarianceReport(
            branchId,
            startDate,
            endDate
        );

        return NextResponse.json({
            success: true,
            report,
            startDate,
            endDate,
        });

    } catch (error) {
        console.error("Variance report error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to load variance report" },
            { status: 500 }
        );
    }
}
