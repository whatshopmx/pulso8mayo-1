import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { RecipeService } from "@/lib/services/recipe-service";
import { z } from "zod";

const simulateSchema = z.object({
    itemId: z.string().uuid(),
    percentageChange: z.number(), // e.g. 0.15 for +15%, -0.10 for -10%
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const validated = simulateSchema.parse(body);

        const simulationResults = await RecipeService.simulateIngredientCostChange(
            session.user.companyId,
            validated.itemId,
            validated.percentageChange
        );

        return NextResponse.json({
            success: true,
            results: simulationResults,
        });

    } catch (error) {
        console.error("Simulation API error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to run cost simulation" }, { status: 500 });
    }
}
