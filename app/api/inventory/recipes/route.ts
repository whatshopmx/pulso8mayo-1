import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { recipes, recipeItems } from "@/lib/db/schema";
import { RecipeService } from "@/lib/services/recipe-service";
import { createRecipeSchema } from "@/lib/validators/recipes";
import { eq } from "drizzle-orm";
import { z } from "zod";

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

        // Reject cycles before persisting (same check as PUT; id pre-generated
        // so the proposed graph can be validated before anything is written)
        const recipeId = randomUUID();
        const createsCycle = await RecipeService.wouldCreateCycle(
            session.user.companyId,
            recipeId,
            validated.items
        );
        if (createsCycle) {
            return NextResponse.json(
                { error: "Recipe cannot contain itself as a sub-recipe (cycle detected)" },
                { status: 409 }
            );
        }

        const [newRecipe] = await db.transaction(async (tx) => {
            const [recipe] = await tx.insert(recipes).values({
                id: recipeId,
                companyId: session.user.companyId,
                name: validated.name,
                description: validated.description || null,
                baseYield: validated.baseYield.toFixed(2),
                unit: validated.unit,
                priceSelling: Math.round(validated.priceSelling * 100), // convert to cents
                // Task 4 (§6.4): null = la receta no maneja tiempo de retención.
                holdTimeMinutes: validated.holdTimeMinutes ?? null,
                calculatedCost: 0,
                foodCostPercentage: "0.00",
            }).returning();

            if (validated.items.length > 0) {
                await tx.insert(recipeItems).values(
                    validated.items.map(item => ({
                        recipeId: recipe.id,
                        itemId: item.itemId,
                        quantity: item.quantity.toFixed(4),
                        unit: item.unit,
                        isSubRecipe: item.isSubRecipe,
                    }))
                );
            }

            return [recipe];
        });

        // Calculate initial cost AFTER the transaction commits
        if (validated.items.length > 0) {
            await RecipeService.calculateRecipeCost(newRecipe.id, 'LAST_COST');
        }

        // Create initial v1 snapshot (Módulo 1.2.2)
        await RecipeService.createRecipeVersion(
            newRecipe.id,
            session.user.id,
            "Creación inicial de ficha técnica"
        );

        // Refetch so the response carries the freshly calculated cost
        const [freshRecipe] = await db.select()
            .from(recipes)
            .where(eq(recipes.id, newRecipe.id));

        return NextResponse.json(freshRecipe ?? newRecipe);
    } catch (error) {
        console.error("POST recipes error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to create recipe" }, { status: 500 });
    }
}
