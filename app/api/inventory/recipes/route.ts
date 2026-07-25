import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { recipes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const createRecipeSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    baseYield: z.number().positive().default(1),
    unit: z.string().default("PORTION"),
    priceSelling: z.number().nonnegative().default(0), // in decimal dollars/pesos
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const list = await db.select()
            .from(recipes)
            .where(eq(recipes.companyId, session.user.companyId));

        return NextResponse.json(list);
    } catch (error) {
        console.error("GET recipes error:", error);
        return NextResponse.json({ error: "Failed to fetch recipes" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const validated = createRecipeSchema.parse(body);

        const [newRecipe] = await db.insert(recipes).values({
            companyId: session.user.companyId,
            name: validated.name,
            description: validated.description || null,
            baseYield: validated.baseYield.toFixed(2),
            unit: validated.unit,
            priceSelling: Math.round(validated.priceSelling * 100), // convert to cents
            calculatedCost: 0,
            foodCostPercentage: "0.00",
        }).returning();

        return NextResponse.json(newRecipe);
    } catch (error) {
        console.error("POST recipes error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to create recipe" }, { status: 500 });
    }
}
