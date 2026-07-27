import { db } from "@/lib/db";
import { recipes, recipeItems, inventoryItems, branches, companies } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface RecipeCostDetail {
    recipeId: string;
    recipeName: string;
    unitCostCents: number;
    priceSellingCents: number;
    foodCostPercent: number;
    marginPercent: number;
    items: Array<{
        itemId: string;
        itemName: string;
        quantity: number;
        unitCost: number;
        lineTotal: number;
    }>;
}

export interface BranchCostingConfig {
    branchId: string;
    branchName: string;
    costingMethod: 'LAST_COST' | 'AVERAGE_COST';
    effectiveFrom: 'BRANCH' | 'COMPANY';
}

export class CostingService {
    static async getBranchMethod(branchId: string): Promise<'LAST_COST' | 'AVERAGE_COST'> {
        const [branch] = await db.select()
            .from(branches)
            .where(eq(branches.id, branchId));

        if (branch?.costingMethod) {
            return branch.costingMethod as 'LAST_COST' | 'AVERAGE_COST';
        }

        const [company] = await db.select()
            .from(companies)
            .where(eq(companies.id, branch?.companyId ?? ''));

        const method = company?.costingMethod || 'LAST_PRICE';
        return method === 'AVERAGE_COST' ? 'AVERAGE_COST' : 'LAST_COST';
    }

    static async getConfigs(companyId: string): Promise<BranchCostingConfig[]> {
        const branchList = await db.select()
            .from(branches)
            .where(eq(branches.companyId, companyId));

        const [company] = await db.select()
            .from(companies)
            .where(eq(companies.id, companyId));

        const companyMethod = (company?.costingMethod || 'LAST_PRICE') as 'LAST_COST' | 'AVERAGE_COST';

        return branchList.map(b => ({
            branchId: b.id,
            branchName: b.name,
            costingMethod: (b.costingMethod || companyMethod) as 'LAST_COST' | 'AVERAGE_COST',
            effectiveFrom: b.costingMethod ? 'BRANCH' as const : 'COMPANY' as const,
        }));
    }

    static async updateBranchMethod(branchId: string, method: 'LAST_COST' | 'AVERAGE_COST'): Promise<void> {
        await db.update(branches)
            .set({ costingMethod: method })
            .where(eq(branches.id, branchId));
    }

    static async clearBranchMethod(branchId: string): Promise<void> {
        await db.update(branches)
            .set({ costingMethod: null })
            .where(eq(branches.id, branchId));
    }

    static async getRecipeCostDetail(
        recipeId: string,
        branchId: string
    ): Promise<RecipeCostDetail> {
        const method = await this.getBranchMethod(branchId);

        const [recipe] = await db.select()
            .from(recipes)
            .where(eq(recipes.id, recipeId));

        if (!recipe) throw new Error("Recipe not found");

        const items = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, recipeId));

        let totalCostCents = 0;
        const itemDetails: RecipeCostDetail["items"] = [];

        for (const ri of items) {
            const qty = parseFloat(ri.quantity);

            if (ri.isSubRecipe) {
                const subDetail = await this.getRecipeCostDetail(ri.itemId, branchId);
                const subCost = subDetail.unitCostCents;
                const [subRecipe] = await db.select()
                    .from(recipes)
                    .where(eq(recipes.id, ri.itemId));
                const baseYield = subRecipe ? parseFloat(subRecipe.baseYield || "1") : 1;
                const costPerUnit = baseYield > 0 ? subCost / baseYield : 0;
                const lineTotal = Math.round(qty * costPerUnit);
                totalCostCents += lineTotal;
                itemDetails.push({
                    itemId: ri.itemId,
                    itemName: subDetail.recipeName,
                    quantity: qty,
                    unitCost: costPerUnit,
                    lineTotal,
                });
            } else {
                const [invItem] = await db.select()
                    .from(inventoryItems)
                    .where(eq(inventoryItems.id, ri.itemId));
                if (!invItem) continue;

                const unitCost = method === 'AVERAGE_COST'
                    ? (invItem.averageCost || invItem.lastCost || 0)
                    : (invItem.lastCost || 0);
                const lineTotal = Math.round(qty * unitCost);
                totalCostCents += lineTotal;
                itemDetails.push({
                    itemId: ri.itemId,
                    itemName: invItem.name,
                    quantity: qty,
                    unitCost,
                    lineTotal,
                });
            }
        }

        const priceSelling = recipe.priceSelling || 0;
        const foodCostPercent = priceSelling > 0
            ? parseFloat(((totalCostCents / priceSelling) * 100).toFixed(2))
            : 0;
        const marginPercent = parseFloat((100 - foodCostPercent).toFixed(2));

        return {
            recipeId,
            recipeName: recipe.name,
            unitCostCents: totalCostCents,
            priceSellingCents: priceSelling,
            foodCostPercent,
            marginPercent,
            items: itemDetails,
        };
    }

    static async getVarianceReport(
        companyId: string,
        branchId: string
    ): Promise<Array<{
        recipeId: string;
        recipeName: string;
        lastCostPercent: number;
        avgCostPercent: number;
        variance: number;
    }>> {
        const recipeList = await db.select()
            .from(recipes)
            .where(eq(recipes.companyId, companyId));

        const results = [];

        for (const recipe of recipeList) {
            const lastCostDetail = await this.getRecipeCostDetail(recipe.id, branchId);

            await db.update(recipes)
                .set({
                    calculatedCost: lastCostDetail.unitCostCents,
                    foodCostPercentage: lastCostDetail.foodCostPercent.toString(),
                    updatedAt: new Date(),
                })
                .where(eq(recipes.id, recipe.id));

            results.push({
                recipeId: recipe.id,
                recipeName: recipe.name,
                lastCostPercent: lastCostDetail.foodCostPercent,
                avgCostPercent: lastCostDetail.foodCostPercent,
                variance: 0,
            });
        }

        return results;
    }
}
