import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { salesEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { TheoreticalConsumptionService } from "@/lib/services/theoretical-consumption-service";

const salesSchema = z.object({
    sales: z.array(z.object({
        recipeId: z.string().uuid(),
        quantitySold: z.number().positive(),
        totalRevenue: z.number().nonnegative().optional(),
    })),
    saleDate: z.string().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.branchId) {
            return NextResponse.json(
                { error: "Unauthorized - User must be in a branch" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const validated = salesSchema.parse(body);

        const saleDate = validated.saleDate ? new Date(validated.saleDate) : new Date();

        for (const sale of validated.sales) {
            const revenueCents = sale.totalRevenue ? Math.round(sale.totalRevenue * 100) : 0;

            await db.insert(salesEntries).values({
                companyId: session.user.companyId || "",
                branchId: session.user.branchId,
                recipeId: sale.recipeId,
                quantitySold: sale.quantitySold.toFixed(2),
                saleDate,
                totalRevenue: revenueCents,
            });

            await TheoreticalConsumptionService.consume({
                companyId: session.user.companyId || "",
                branchId: session.user.branchId,
                recipeId: sale.recipeId,
                quantitySold: sale.quantitySold,
                saleDate,
                userId: session.user.id,
            });
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Sales entry error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to record sales" },
            { status: 500 }
        );
    }
}
export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.branchId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const list = await db.select()
            .from(salesEntries)
            .where(eq(salesEntries.branchId, session.user.branchId));

        return NextResponse.json(list);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch sales entries" }, { status: 500 });
    }
}
