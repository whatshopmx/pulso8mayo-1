import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { recipes, recipeItems } from "@/lib/db/schema";
import { RecipeService } from "@/lib/services/recipe-service";
import { updateRecipeSchema } from "@/lib/validators/recipes";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const resolvedParams = await params;
        const [recipe] = await db.select()
            .from(recipes)
            .where(
                and(
                    eq(recipes.id, resolvedParams.id),
                    eq(recipes.companyId, session.user.companyId)
                )
            );

        if (!recipe) {
            return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
        }

        const items = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, resolvedParams.id));

        return NextResponse.json({
            ...recipe,
            items,
        });
    } catch (error) {
        console.error("GET recipe details error:", error);
        return NextResponse.json({ error: "Failed to fetch recipe details" }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const resolvedParams = await params;
        const body = await req.json();
        const validated = updateRecipeSchema.parse(body);

        // Reject cycles before persisting (covers indirect A→B→A, not just A→A)
        const createsCycle = await RecipeService.wouldCreateCycle(
            session.user.companyId,
            resolvedParams.id,
            validated.items
        );
        if (createsCycle) {
            return NextResponse.json(
                { error: "Recipe cannot contain itself as a sub-recipe (cycle detected)" },
                { status: 409 }
            );
        }

        await db.transaction(async (tx) => {
            // 1. Update recipe header
            await tx.update(recipes)
                .set({
                    name: validated.name,
                    description: validated.description || null,
                    baseYield: validated.baseYield.toFixed(2),
                    unit: validated.unit,
                    priceSelling: Math.round(validated.priceSelling * 100),
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(recipes.id, resolvedParams.id),
                        eq(recipes.companyId, session.user.companyId)
                    )
                );

            // 2. Delete existing items
            await tx.delete(recipeItems)
                .where(eq(recipeItems.recipeId, resolvedParams.id));

            // 3. Insert new items
            if (validated.items.length > 0) {
                await tx.insert(recipeItems).values(
                    validated.items.map(item => ({
                        recipeId: resolvedParams.id,
                        itemId: item.itemId,
                        quantity: item.quantity.toFixed(4),
                        unit: item.unit,
                        isSubRecipe: item.isSubRecipe,
                    }))
                );
            }
        });

        // 4. Calculate cost AFTER the transaction commits (it writes with its own connection)
        await RecipeService.calculateRecipeCost(resolvedParams.id, 'LAST_COST');

        // Fetch and return the updated recipe details
        const [updatedRecipe] = await db.select()
            .from(recipes)
            .where(eq(recipes.id, resolvedParams.id));

        const updatedItems = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, resolvedParams.id));

        return NextResponse.json({
            ...updatedRecipe,
            items: updatedItems,
        });

    } catch (error) {
        console.error("PUT recipe error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to update recipe" }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const resolvedParams = await params;

        // Verify ownership
        const [recipe] = await db.select()
            .from(recipes)
            .where(
                and(
                    eq(recipes.id, resolvedParams.id),
                    eq(recipes.companyId, session.user.companyId)
                )
            );

        if (!recipe) {
            return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
        }

        await db.transaction(async (tx) => {
            // Delete items
            await tx.delete(recipeItems)
                .where(eq(recipeItems.recipeId, resolvedParams.id));
            // Delete recipe header
            await tx.delete(recipes)
                .where(eq(recipes.id, resolvedParams.id));
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE recipe error:", error);
        return NextResponse.json({ error: "Failed to delete recipe" }, { status: 500 });
    }
}
