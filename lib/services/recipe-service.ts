import { db } from "@/lib/db";
import { recipes, recipeItems, inventoryItems, inventoryBatches } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export class RecipeService {
    /**
     * Recursively calculates the cost of a recipe (in cents).
     * Supporting both 'LAST_COST' and 'AVERAGE_COST' methods.
     */
    static async calculateRecipeCost(recipeId: string, method: 'LAST_COST' | 'AVERAGE_COST' = 'LAST_COST'): Promise<number> {
        // Fetch recipe items
        const items = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, recipeId));

        let totalCostCents = 0;

        for (const item of items) {
            const qty = parseFloat(item.quantity);

            if (item.isSubRecipe) {
                // Recursively calculate sub-recipe cost
                const subRecipeCost = await this.calculateRecipeCost(item.itemId, method);
                
                // Get the sub-recipe yield
                const [subRecipe] = await db.select()
                    .from(recipes)
                    .where(eq(recipes.id, item.itemId));
                
                const baseYield = subRecipe ? parseFloat(subRecipe.baseYield || "1") : 1;
                const costPerUnit = subRecipeCost / baseYield;
                totalCostCents += Math.round(qty * costPerUnit);
            } else {
                // Fetch inventory item
                const [invItem] = await db.select()
                    .from(inventoryItems)
                    .where(eq(inventoryItems.id, item.itemId));
                
                if (!invItem) continue;

                let itemUnitCost = 0;

                if (method === 'LAST_COST') {
                    itemUnitCost = invItem.lastCost || 0;
                } else {
                    // Use averageCost from item (pre-calculated on receiving)
                    itemUnitCost = invItem.averageCost || invItem.lastCost || 0;
                }

                totalCostCents += Math.round(qty * itemUnitCost);
            }
        }

        // Cache the calculated cost back into the recipe
        const [recipe] = await db.select()
            .from(recipes)
            .where(eq(recipes.id, recipeId));
        
        if (recipe) {
            const priceSelling = recipe.priceSelling || 0;
            const foodCostPct = priceSelling > 0 ? ((totalCostCents / priceSelling) * 100).toFixed(2) : "0.00";
            
            await db.update(recipes)
                .set({
                    calculatedCost: totalCostCents,
                    foodCostPercentage: foodCostPct,
                    updatedAt: new Date(),
                })
                .where(eq(recipes.id, recipeId));
        }

        return totalCostCents;
    }

    /**
     * Simulates what happens to all recipe costs if a single ingredient price increases/decreases.
     */
    static async simulateIngredientCostChange(
        companyId: string,
        itemId: string,
        percentageChange: number // e.g. 0.15 for +15%, -0.10 for -10%
    ): Promise<Array<{
        recipeId: string;
        recipeName: string;
        currentCostCents: number;
        simulatedCostCents: number;
        currentFoodCostPct: string;
        simulatedFoodCostPct: string;
    }>> {
        // 1. Get all recipes for company
        const allRecipes = await db.select()
            .from(recipes)
            .where(eq(recipes.companyId, companyId));

        const results = [];

        for (const recipe of allRecipes) {
            // Check if recipe directly or indirectly uses this itemId
            const usesItem = await this.recipeUsesItem(recipe.id, itemId);
            if (!usesItem) continue;

            // Calculate simulated cost
            const currentCost = recipe.calculatedCost || 0;
            const simulatedCost = await this.calculateSimulatedCost(recipe.id, itemId, percentageChange);
            const sellingPrice = recipe.priceSelling || 0;

            const currentFoodCostPct = recipe.foodCostPercentage || "0.00";
            const simulatedFoodCostPct = sellingPrice > 0 
                ? ((simulatedCost / sellingPrice) * 100).toFixed(2) 
                : "0.00";

            results.push({
                recipeId: recipe.id,
                recipeName: recipe.name,
                currentCostCents: currentCost,
                simulatedCostCents: simulatedCost,
                currentFoodCostPct,
                simulatedFoodCostPct,
            });
        }

        return results;
    }

    private static async recipeUsesItem(recipeId: string, targetItemId: string): Promise<boolean> {
        const items = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, recipeId));

        for (const item of items) {
            if (item.itemId === targetItemId) {
                return true;
            }
            if (item.isSubRecipe) {
                const childUses = await this.recipeUsesItem(item.itemId, targetItemId);
                if (childUses) return true;
            }
        }
        return false;
    }

    private static async calculateSimulatedCost(
        recipeId: string,
        targetItemId: string,
        percentageChange: number
    ): Promise<number> {
        const items = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, recipeId));

        let totalSimulatedCents = 0;

        for (const item of items) {
            const qty = parseFloat(item.quantity);

            if (item.isSubRecipe) {
                const subSimulatedCost = await this.calculateSimulatedCost(item.itemId, targetItemId, percentageChange);
                const [subRecipe] = await db.select()
                    .from(recipes)
                    .where(eq(recipes.id, item.itemId));
                const baseYield = subRecipe ? parseFloat(subRecipe.baseYield || "1") : 1;
                const costPerUnit = subSimulatedCost / baseYield;
                totalSimulatedCents += Math.round(qty * costPerUnit);
            } else {
                const [invItem] = await db.select()
                    .from(inventoryItems)
                    .where(eq(inventoryItems.id, item.itemId));
                
                if (!invItem) continue;

                let itemCost = invItem.lastCost || 0;
                if (item.itemId === targetItemId) {
                    itemCost = Math.round(itemCost * (1 + percentageChange));
                }

                totalSimulatedCents += Math.round(qty * itemCost);
            }
        }

        return totalSimulatedCents;
    }
}
