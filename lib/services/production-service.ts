import { db } from "@/lib/db";
import {
    productionOrders, productionResults, productionIngredients,
    inventoryBatches, inventoryItems, inventoryMovements, recipes, recipeItems, salesEntries,
} from "@/lib/db/schema";
import { eq, and, gte, sql, sum, desc } from "drizzle-orm";

export interface ProductionSuggestion {
    recipeId: string;
    recipeName: string;
    suggestedQuantity: number;
    unit: string;
    avgDailySales: number;
    currentStock: number;
}

export class ProductionService {

    static async createOrder(data: {
        companyId: string;
        branchId: string;
        recipeId: string;
        plannedQuantity: number;
        unit: string;
        plannedDate: Date;
        notes?: string;
        createdBy: string;
    }) {
        const [order] = await db.insert(productionOrders).values(data).returning();
        return order;
    }

    static async getOrders(companyId: string, branchId: string) {
        return db.select({
            order: productionOrders,
            recipe: {
                id: recipes.id,
                name: recipes.name,
            },
        })
            .from(productionOrders)
            .leftJoin(recipes, eq(productionOrders.recipeId, recipes.id))
            .where(and(
                eq(productionOrders.companyId, companyId),
                eq(productionOrders.branchId, branchId),
            ))
            .orderBy(desc(productionOrders.plannedDate));
    }

    static async recordProduction(data: {
        companyId: string;
        branchId: string;
        orderId?: string;
        recipeId: string;
        producedQuantity: number;
        unit: string;
        notes?: string;
        recordedBy: string;
        ingredients: {
            itemId: string;
            batchId?: string;
            expectedQuantity: number;
            actualQuantity: number;
            unit: string;
            unitCost?: number;
            yieldPercent?: number;
        }[];
    }) {
        const { ingredients, ...resultData } = data;

        // Calculate total ingredient cost
        let ingredientCost = 0;

        // Deduct ingredients from inventory batches
        for (const ing of ingredients) {
            const cost = ing.unitCost ?? 0;
            const total = cost * ing.actualQuantity;
            ingredientCost += total;

            // Deduct from a specific batch or the first available
            if (ing.batchId) {
                const batch = await db.query.inventoryBatches.findFirst({
                    where: eq(inventoryBatches.id, ing.batchId),
                });

                if (batch && batch.currentQuantity >= ing.actualQuantity) {
                    await db.update(inventoryBatches)
                        .set({
                            currentQuantity: sql`${inventoryBatches.currentQuantity} - ${ing.actualQuantity}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(inventoryBatches.id, ing.batchId));
                }
            }
        }

        // Create the production result
        const [result] = await db.insert(productionResults).values({
            ...resultData,
            ingredientCost,
        }).returning();

        // Create ingredient records
        if (ingredients.length > 0) {
            await db.insert(productionIngredients).values(
                ingredients.map(ing => ({
                    resultId: result.id,
                    ...ing,
                    totalCost: (ing.unitCost ?? 0) * ing.actualQuantity,
                    yieldPercent: ing.yieldPercent ?? 100,
                }))
            );
        }

        // Record inventory movement (finished goods produced as positive movement)
        // TODO: insert into inventoryBatches for finished goods

        // Update order status if linked
        if (data.orderId) {
            await db.update(productionOrders)
                .set({
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(productionOrders.id, data.orderId));
        }

        return result;
    }

    static async getSuggestions(companyId: string, branchId: string): Promise<ProductionSuggestion[]> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Get recipes with their inventory items
        const allRecipes = await db.select()
            .from(recipes)
            .where(eq(recipes.companyId, companyId));

        const suggestions: ProductionSuggestion[] = [];

        for (const recipe of allRecipes) {
            // Average daily sales for this recipe
            const salesData = await db.select({
                totalSold: sql<number>`COALESCE(SUM(CAST(${salesEntries.quantitySold} AS INTEGER)), 0)`,
            })
                .from(salesEntries)
                .where(and(
                    eq(salesEntries.recipeId, recipe.id),
                    eq(salesEntries.branchId, branchId),
                    gte(salesEntries.saleDate, sevenDaysAgo),
                ));

            const totalSold = salesData[0]?.totalSold ?? 0;
            const avgDailySales = Math.round(totalSold / 7);

            // Get recipe items to check stock of ingredients
            const recipeIngs = await db.select({
                itemId: recipeItems.itemId,
                quantity: recipeItems.quantity,
            })
                .from(recipeItems)
                .where(eq(recipeItems.recipeId, recipe.id));

            // Find minimum stock coverage among ingredients
            let minStockRatio = Infinity;
            for (const ri of recipeIngs) {
                const stockSum = await db.select({
                    total: sql<number>`COALESCE(SUM(${inventoryBatches.currentQuantity}), 0)`,
                })
                    .from(inventoryBatches)
                    .where(and(
                        eq(inventoryBatches.itemId, ri.itemId),
                        eq(inventoryBatches.branchId, branchId),
                    ));

                const currentStock = stockSum[0]?.total ?? 0;
                const neededPerBatch = Number(ri.quantity);
                const ratio = neededPerBatch > 0 ? currentStock / neededPerBatch : Infinity;
                if (ratio < minStockRatio) minStockRatio = ratio;
            }

            const currentStock = minStockRatio === Infinity ? 999 : Math.floor(minStockRatio);

            suggestions.push({
                recipeId: recipe.id,
                recipeName: recipe.name,
                suggestedQuantity: Math.max(0, avgDailySales * 2 - currentStock),
                unit: recipe.unit,
                avgDailySales,
                currentStock,
            });
        }

        return suggestions
            .filter(s => s.suggestedQuantity > 0)
            .sort((a, b) => b.suggestedQuantity - a.suggestedQuantity);
    }
}
