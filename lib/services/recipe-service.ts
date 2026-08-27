import { db } from "@/lib/db";
import { recipes, recipeItems, inventoryItems, recipeVersions, users } from "@/lib/db/schema";
import { eq, inArray, desc, and, sql } from "drizzle-orm";

/**
 * Thrown when a recipe is reachable from itself through sub-recipe items
 * (e.g. A → B → A). Protects cost calculation against infinite recursion
 * on corrupted data.
 */
export class RecipeCycleError extends Error {
    constructor(recipeId: string) {
        super(`Recipe cycle detected involving recipe ${recipeId}`);
        this.name = "RecipeCycleError";
    }
}

interface GraphRecipe {
    id: string;
    name: string;
    baseYield: string;
    priceSelling: number;
    calculatedCost: number;
    foodCostPercentage: string;
}

interface GraphLine {
    itemId: string;
    quantity: string;
    isSubRecipe: boolean;
}

interface GraphInventoryItem {
    lastCost: number | null;
    averageCost: number | null;
}

/**
 * In-memory view of a tenant's whole recipe graph, loaded in one batch
 * (3 queries) instead of 1-2 queries per ingredient line per nesting level.
 */
interface RecipeGraph {
    recipesById: Map<string, GraphRecipe>;
    linesByRecipeId: Map<string, GraphLine[]>;
    inventoryById: Map<string, GraphInventoryItem>;
}

export class RecipeService {
    /**
     * Recursively calculates the cost of a recipe (in cents).
     * Supporting both 'LAST_COST' and 'AVERAGE_COST' methods.
     *
     * Internally loads the tenant's recipe graph once and resolves the cost
     * with a memoized DFS (each sub-recipe is computed once, even in
     * diamond-shaped graphs). `visited` seeds the recursion path so a true
     * cycle still throws RecipeCycleError; the public signature is unchanged.
     */
    static async calculateRecipeCost(
        recipeId: string,
        method: 'LAST_COST' | 'AVERAGE_COST' = 'LAST_COST',
        visited: Set<string> = new Set()
    ): Promise<number> {
        // Resolve the tenant, then batch-load the graph
        const [root] = await db.select({
            id: recipes.id,
            companyId: recipes.companyId,
        })
            .from(recipes)
            .where(eq(recipes.id, recipeId));

        if (!root) {
            return 0;
        }

        const graph = await this.loadGraph(root.companyId);
        const path = new Set(visited);
        const memo = new Map<string, number>();
        const computed = new Set<string>();

        const totalCostCents = this.computeCost(graph, recipeId, method, path, memo, computed);

        // Cache the calculated cost back into every recipe touched by the
        // traversal (root + sub-recipes), mirroring the previous recursive
        // side effect: one update per recipe, with the same value a repeated
        // recursive call would have written.
        await Promise.all([...computed].map(async (computedId) => {
            const recipe = graph.recipesById.get(computedId)!;
            const priceSelling = recipe.priceSelling || 0;
            const cost = memo.get(computedId)!;
            const foodCostPct = priceSelling > 0 ? ((cost / priceSelling) * 100).toFixed(2) : "0.00";

            await db.update(recipes)
                .set({
                    calculatedCost: cost,
                    foodCostPercentage: foodCostPct,
                    updatedAt: new Date(),
                })
                .where(eq(recipes.id, computedId));
        }));

        return totalCostCents;
    }

    /**
     * Checks whether saving `proposedItems` on `recipeId` would make the
     * recipe reachable from itself through sub-recipe edges (direct or
     * indirect cycle). Runs a DFS over the tenant's recipe graph with the
     * proposed edges overlaid — must be called BEFORE persisting.
     */
    static async wouldCreateCycle(
        companyId: string,
        recipeId: string,
        proposedItems: Array<{ itemId: string; isSubRecipe: boolean }>
    ): Promise<boolean> {
        // Load every sub-recipe edge of the tenant in one query
        const tenantItems = await db.select({
            recipeId: recipeItems.recipeId,
            itemId: recipeItems.itemId,
            isSubRecipe: recipeItems.isSubRecipe,
        })
            .from(recipeItems)
            .innerJoin(recipes, eq(recipeItems.recipeId, recipes.id))
            .where(eq(recipes.companyId, companyId));

        // Adjacency map: recipeId -> sub-recipe ids it contains
        const edges = new Map<string, string[]>();
        for (const item of tenantItems) {
            if (!item.isSubRecipe) continue;
            const list = edges.get(item.recipeId) ?? [];
            list.push(item.itemId);
            edges.set(item.recipeId, list);
        }

        // Overlay the proposed edges for the recipe being edited
        edges.set(
            recipeId,
            proposedItems.filter(i => i.isSubRecipe).map(i => i.itemId)
        );

        // DFS from each direct sub-recipe child: can we get back to recipeId?
        const visited = new Set<string>();
        const stack = [...(edges.get(recipeId) ?? [])];
        while (stack.length > 0) {
            const current = stack.pop()!;
            if (current === recipeId) return true;
            if (visited.has(current)) continue;
            visited.add(current);
            for (const child of edges.get(current) ?? []) {
                stack.push(child);
            }
        }
        return false;
    }

    /**
     * Simulates what happens to all recipe costs if a single ingredient price increases/decreases.
     * Loads the tenant graph once; the simulated cost of each sub-recipe is
     * memoized and shared across every affected root recipe.
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
        const graph = await this.loadGraph(companyId);

        // Affected recipes: those with a direct line to itemId (ingredient or
        // sub-recipe line — the old recipeUsesItem matched both), plus every
        // ancestor reachable through sub-recipe edges. Same result set as the
        // old per-recipe recipeUsesItem scan, computed in one pass.
        const affected = new Set<string>();
        const parentsByChild = new Map<string, string[]>();
        for (const [parentId, lines] of graph.linesByRecipeId) {
            for (const line of lines) {
                if (line.itemId === itemId) {
                    affected.add(parentId);
                }
                if (line.isSubRecipe) {
                    const list = parentsByChild.get(line.itemId) ?? [];
                    list.push(parentId);
                    parentsByChild.set(line.itemId, list);
                }
            }
        }
        const queue = [...affected];
        while (queue.length > 0) {
            const current = queue.pop()!;
            for (const parent of parentsByChild.get(current) ?? []) {
                if (!affected.has(parent)) {
                    affected.add(parent);
                    queue.push(parent);
                }
            }
        }

        const results: Array<{
            recipeId: string;
            recipeName: string;
            currentCostCents: number;
            simulatedCostCents: number;
            currentFoodCostPct: string;
            simulatedFoodCostPct: string;
        }> = [];
        const override = { itemId, percentageChange };
        // Shared across roots: the simulated cost of a sub-recipe is identical
        // no matter which affected ancestor reaches it first.
        const memo = new Map<string, number>();

        // Iterate in the original recipe select order (same query the old loop used)
        for (const recipe of graph.recipesById.values()) {
            if (!affected.has(recipe.id)) continue;

            const simulatedCost = this.computeCost(graph, recipe.id, 'LAST_COST', new Set(), memo, new Set(), override);
            const currentCost = recipe.calculatedCost || 0;
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

    /**
     * Loads the tenant's full recipe graph in one batch: all recipes of the
     * company, all their recipe lines, and every referenced inventory item.
     */
    private static async loadGraph(companyId: string): Promise<RecipeGraph> {
        const recipeRows = await db.select({
            id: recipes.id,
            name: recipes.name,
            baseYield: recipes.baseYield,
            priceSelling: recipes.priceSelling,
            calculatedCost: recipes.calculatedCost,
            foodCostPercentage: recipes.foodCostPercentage,
        })
            .from(recipes)
            .where(eq(recipes.companyId, companyId));

        const lineRows = await db.select({
            recipeId: recipeItems.recipeId,
            itemId: recipeItems.itemId,
            quantity: recipeItems.quantity,
            isSubRecipe: recipeItems.isSubRecipe,
        })
            .from(recipeItems)
            .innerJoin(recipes, eq(recipeItems.recipeId, recipes.id))
            .where(eq(recipes.companyId, companyId));

        const inventoryIds = [...new Set(lineRows.filter(l => !l.isSubRecipe).map(l => l.itemId))];
        const inventoryRows = inventoryIds.length === 0 ? [] : await db.select({
            id: inventoryItems.id,
            lastCost: inventoryItems.lastCost,
            averageCost: inventoryItems.averageCost,
        })
            .from(inventoryItems)
            .where(inArray(inventoryItems.id, inventoryIds));

        const recipesById = new Map<string, GraphRecipe>();
        for (const row of recipeRows) {
            recipesById.set(row.id, row);
        }

        const linesByRecipeId = new Map<string, GraphLine[]>();
        for (const row of lineRows) {
            const list = linesByRecipeId.get(row.recipeId) ?? [];
            list.push({ itemId: row.itemId, quantity: row.quantity, isSubRecipe: row.isSubRecipe });
            linesByRecipeId.set(row.recipeId, list);
        }

        const inventoryById = new Map<string, GraphInventoryItem>();
        for (const row of inventoryRows) {
            inventoryById.set(row.id, { lastCost: row.lastCost, averageCost: row.averageCost });
        }

        return { recipesById, linesByRecipeId, inventoryById };
    }

    /**
     * Memoized DFS over the loaded graph. Preserves the exact arithmetic of
     * the previous recursive implementation: same per-line Math.round, same
     * divide-then-multiply order for sub-recipes, same cost fallbacks.
     *
     * `path` tracks the current recursion stack (cycle => RecipeCycleError);
     * `memo` caches fully-computed recipe costs; `computed` records which
     * existing recipes produced a value (used by calculateRecipeCost to
     * persist the refreshed costs). When `override` is set, lines referencing
     * `override.itemId` use the adjusted lastCost (simulation mode).
     */
    private static computeCost(
        graph: RecipeGraph,
        recipeId: string,
        method: 'LAST_COST' | 'AVERAGE_COST',
        path: Set<string>,
        memo: Map<string, number>,
        computed: Set<string>,
        override?: { itemId: string; percentageChange: number }
    ): number {
        if (path.has(recipeId)) {
            throw new RecipeCycleError(recipeId);
        }
        const memoized = memo.get(recipeId);
        if (memoized !== undefined) {
            return memoized;
        }
        const recipe = graph.recipesById.get(recipeId);
        if (!recipe) {
            // Unknown id (deleted or cross-tenant reference): contributes 0,
            // matching the previous empty-lookup behavior.
            return 0;
        }

        path.add(recipeId);
        try {
            let totalCostCents = 0;

            for (const line of graph.linesByRecipeId.get(recipeId) ?? []) {
                const qty = parseFloat(line.quantity);

                if (line.isSubRecipe) {
                    const subRecipeCost = this.computeCost(graph, line.itemId, method, path, memo, computed, override);
                    const subRecipe = graph.recipesById.get(line.itemId);
                    const baseYield = subRecipe ? parseFloat(subRecipe.baseYield || "1") : 1;
                    const costPerUnit = subRecipeCost / baseYield;
                    totalCostCents += Math.round(qty * costPerUnit);
                } else {
                    const invItem = graph.inventoryById.get(line.itemId);
                    if (!invItem) continue;

                    let itemUnitCost = 0;
                    if (override) {
                        // Simulation always starts from lastCost
                        itemUnitCost = invItem.lastCost || 0;
                        if (line.itemId === override.itemId) {
                            itemUnitCost = Math.round(itemUnitCost * (1 + override.percentageChange));
                        }
                    } else if (method === 'LAST_COST') {
                        itemUnitCost = invItem.lastCost || 0;
                    } else {
                        itemUnitCost = invItem.averageCost || invItem.lastCost || 0;
                    }

                    totalCostCents += Math.round(qty * itemUnitCost);
                }
            }

            memo.set(recipeId, totalCostCents);
            computed.add(recipeId);
            return totalCostCents;
        } finally {
            path.delete(recipeId);
        }
    }

    /**
     * Crea un snapshot inmutable de la ficha técnica actual de la receta (Módulo 1.2.2).
     */
    static async createRecipeVersion(
        recipeId: string,
        changedBy?: string,
        changeReason?: string
    ) {
        const [recipe] = await db
            .select()
            .from(recipes)
            .where(eq(recipes.id, recipeId));

        if (!recipe) return null;

        // Fetch current items with rich metadata
        const items = await db
            .select({
                itemId: recipeItems.itemId,
                quantity: recipeItems.quantity,
                unit: recipeItems.unit,
                isSubRecipe: recipeItems.isSubRecipe,
                yieldPercent: recipeItems.yieldPercent,
                itemName: inventoryItems.name,
                itemSku: inventoryItems.sku,
                lastCost: inventoryItems.lastCost,
                averageCost: inventoryItems.averageCost,
            })
            .from(recipeItems)
            .leftJoin(inventoryItems, eq(recipeItems.itemId, inventoryItems.id))
            .where(eq(recipeItems.recipeId, recipeId));

        // Get latest version number
        const [latestVersion] = await db
            .select({
                maxVer: sql<number>`COALESCE(MAX(${recipeVersions.versionNumber}), 0)`,
            })
            .from(recipeVersions)
            .where(eq(recipeVersions.recipeId, recipeId));

        const nextVersionNumber = (latestVersion?.maxVer ?? 0) + 1;

        const [createdVersion] = await db
            .insert(recipeVersions)
            .values({
                recipeId: recipe.id,
                companyId: recipe.companyId,
                versionNumber: nextVersionNumber,
                name: recipe.name,
                description: recipe.description,
                baseYield: recipe.baseYield,
                unit: recipe.unit,
                holdTimeMinutes: recipe.holdTimeMinutes,
                calculatedCost: recipe.calculatedCost,
                priceSelling: recipe.priceSelling,
                foodCostPercentage: recipe.foodCostPercentage,
                itemsSnapshot: items,
                changeReason: changeReason || "Actualización de ficha técnica",
                changedBy: changedBy || null,
            })
            .returning();

        return createdVersion;
    }

    /**
     * Lista todas las versiones históricas de una receta con autor.
     */
    static async listRecipeVersions(recipeId: string, companyId: string) {
        return db
            .select({
                id: recipeVersions.id,
                versionNumber: recipeVersions.versionNumber,
                name: recipeVersions.name,
                description: recipeVersions.description,
                baseYield: recipeVersions.baseYield,
                unit: recipeVersions.unit,
                holdTimeMinutes: recipeVersions.holdTimeMinutes,
                calculatedCost: recipeVersions.calculatedCost,
                priceSelling: recipeVersions.priceSelling,
                foodCostPercentage: recipeVersions.foodCostPercentage,
                itemsSnapshot: recipeVersions.itemsSnapshot,
                changeReason: recipeVersions.changeReason,
                changedBy: recipeVersions.changedBy,
                authorName: users.name,
                authorEmail: users.email,
                createdAt: recipeVersions.createdAt,
            })
            .from(recipeVersions)
            .leftJoin(users, eq(recipeVersions.changedBy, users.id))
            .where(
                and(
                    eq(recipeVersions.recipeId, recipeId),
                    eq(recipeVersions.companyId, companyId)
                )
            )
            .orderBy(desc(recipeVersions.versionNumber));
    }
}

