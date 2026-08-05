import { db } from "@/lib/db";
import {
    salesEntries, recipes, recipeItems, inventoryItems,
    inventoryBatches, inventoryWaste,
    branches, workflowInstances, workflowTemplates
} from "@/lib/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

const STOCK_COUNT_TEMPLATE_NAME = "Conteo de Inventario";


export interface BranchKPI {
    branchId: string;
    branchName: string;
    foodCostPercent: number;
    cogsCents: number;
    revenueCents: number;
    inventoryTurnover: number;
    stockDays: number;
    shrinkagePercent: number;
    fillRate: number;
    countAccuracy: number | null;
}

export interface ExecutiveReport {
    consolidated: BranchKPI;
    byBranch: BranchKPI[];
    period: { start: string; end: string };
}

export class ExecutiveReportService {
    static async getReport(
        companyId: string,
        startDate: Date,
        endDate: Date,
        branchId?: string
    ): Promise<ExecutiveReport> {
        const branchList = branchId
            ? await db.select().from(branches).where(and(eq(branches.companyId, companyId), eq(branches.id, branchId)))
            : await db.select().from(branches).where(eq(branches.companyId, companyId));

        const kpiPromises = branchList.map(b =>
            this.calculateBranchKPI(companyId, b, startDate, endDate)
        );
        const byBranch = await Promise.all(kpiPromises);

        const consolidated = this.consolidateKPIs(byBranch, startDate, endDate);

        return {
            consolidated,
            byBranch,
            period: { start: startDate.toISOString(), end: endDate.toISOString() },
        };
    }

    private static async calculateBranchKPI(
        companyId: string,
        branch: typeof branches.$inferSelect,
        startDate: Date,
        endDate: Date
    ): Promise<BranchKPI> {
        const [revenueCents, cogsData, endStockValue, wasteTotal, fillRate, countAccuracy] = await Promise.all([
            this.calcRevenue(branch.id, startDate, endDate),
            this.calcCOGS(branch.id, startDate, endDate),
            this.calcEndStockValue(branch.id),
            this.calcWasteTotal(branch.id, startDate, endDate),
            this.calcFillRate(branch.id),
            this.calcCountAccuracy(branch.id),
        ]);

        const cogsCents = cogsData.totalCostCents;
        const foodCostPercent = revenueCents > 0 ? parseFloat(((cogsCents / revenueCents) * 100).toFixed(2)) : 0;
        const daysInPeriod = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
        const avgDailyCogs = daysInPeriod > 0 ? cogsCents / daysInPeriod : 0;
        const stockDays = avgDailyCogs > 0 ? parseFloat((endStockValue / avgDailyCogs).toFixed(1)) : 0;
        const inventoryTurnover = endStockValue > 0 && cogsCents > 0
            ? parseFloat((cogsCents / endStockValue).toFixed(2))
            : 0;
        const totalConsumed = cogsCents + wasteTotal;
        const shrinkagePercent = totalConsumed > 0
            ? parseFloat(((wasteTotal / totalConsumed) * 100).toFixed(2))
            : 0;

        return {
            branchId: branch.id,
            branchName: branch.name,
            foodCostPercent,
            cogsCents,
            revenueCents,
            inventoryTurnover,
            stockDays,
            shrinkagePercent,
            fillRate,
            countAccuracy,
        };
    }

    private static async calcRevenue(branchId: string, startDate: Date, endDate: Date): Promise<number> {
        const rows = await db.select({
            total: sql<number>`coalesce(sum(${salesEntries.totalRevenue}), 0)`,
        })
            .from(salesEntries)
            .where(and(
                eq(salesEntries.branchId, branchId),
                gte(salesEntries.saleDate, startDate),
                lte(salesEntries.saleDate, endDate),
            ));
        return rows[0]?.total ?? 0;
    }

    private static async calcCOGS(
        branchId: string,
        startDate: Date,
        endDate: Date
    ): Promise<{ totalCostCents: number }> {
        const sales = await db.select()
            .from(salesEntries)
            .where(and(
                eq(salesEntries.branchId, branchId),
                gte(salesEntries.saleDate, startDate),
                lte(salesEntries.saleDate, endDate),
            ));

        let totalCostCents = 0;
        for (const sale of sales) {
            const qtySold = parseFloat(sale.quantitySold);
            const cost = await this.getRecipeCost(sale.recipeId, qtySold);
            totalCostCents += cost;
        }

        return { totalCostCents };
    }

    private static async getRecipeCost(recipeId: string, quantitySold: number): Promise<number> {
        const items = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, recipeId));

        const [recipe] = await db.select()
            .from(recipes)
            .where(eq(recipes.id, recipeId));

        if (!recipe) return 0;
        const baseYield = parseFloat(recipe.baseYield || "1") || 1;

        let totalCost = 0;
        for (const item of items) {
            const qty = parseFloat(item.quantity) * quantitySold / baseYield;

            if (item.isSubRecipe) {
                totalCost += await this.getRecipeCost(item.itemId, qty);
            } else {
                const [invItem] = await db.select()
                    .from(inventoryItems)
                    .where(eq(inventoryItems.id, item.itemId));
                if (!invItem) continue;
                const unitCost = invItem.averageCost || invItem.lastCost || 0;
                totalCost += Math.round(qty * unitCost);
            }
        }
        return totalCost;
    }

    private static async calcEndStockValue(branchId: string): Promise<number> {
        const rows = await db.select({
            value: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity} * ${inventoryBatches.unitCost}), 0)`,
        })
            .from(inventoryBatches)
            .where(and(
                eq(inventoryBatches.branchId, branchId),
                eq(inventoryBatches.status, 'AVAILABLE'),
                sql`${inventoryBatches.unitCost} IS NOT NULL`,
            ));
        return rows[0]?.value ?? 0;
    }

    private static async calcWasteTotal(branchId: string, startDate: Date, endDate: Date): Promise<number> {
        const rows = await db.select({
            total: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
        })
            .from(inventoryWaste)
            .where(and(
                eq(inventoryWaste.branchId, branchId),
                gte(inventoryWaste.recordedAt, startDate),
                lte(inventoryWaste.recordedAt, endDate),
            ));
        return rows[0]?.total ?? 0;
    }

    private static async calcFillRate(branchId: string): Promise<number> {
        // El stock disponible por artículo se agrega en una subconsulta y sólo
        // después se cuenta. Hacerlo en un único nivel
        // (`count(... case when sum(...) ...)`) es un agregado anidado y Postgres
        // lo rechaza con "aggregate function calls cannot be nested".
        const perItem = db
            .select({
                itemId: inventoryItems.id,
                minLevel: sql<number>`${inventoryItems.minLevel}`.as("min_level"),
                available: sql<number>`coalesce(sum(case when ${inventoryBatches.status} = 'AVAILABLE' then ${inventoryBatches.currentQuantity} else 0 end), 0)`.as("available"),
            })
            .from(inventoryItems)
            .leftJoin(inventoryBatches, eq(inventoryItems.id, inventoryBatches.itemId))
            .where(and(
                eq(inventoryBatches.branchId, branchId),
                eq(inventoryItems.active, true),
                sql`${inventoryItems.minLevel} > 0`,
            ))
            .groupBy(inventoryItems.id, inventoryItems.minLevel)
            .as("per_item");

        const rows = await db
            .select({
                totalItems: sql<number>`cast(count(*) as integer)`,
                filledItems: sql<number>`cast(count(*) filter (where ${perItem.available} >= ${perItem.minLevel}) as integer)`,
            })
            .from(perItem);

        const r = rows[0];
        const total = Number(r?.totalItems ?? 0);
        const filled = Number(r?.filledItems ?? 0);
        return total > 0 ? parseFloat(((filled / total) * 100).toFixed(1)) : 100;
    }

    private static async calcCountAccuracy(branchId: string): Promise<number | null> {
        const results = await db.select({
            data: sql<any>`${workflowInstances.data}`,
        })
            .from(workflowInstances)
            .innerJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, workflowTemplates.id))
            .where(and(
                eq(workflowInstances.branchId, branchId),
                eq(workflowTemplates.name, STOCK_COUNT_TEMPLATE_NAME),
                eq(workflowInstances.status, 'COMPLETED'),
            ))
            .orderBy(desc(workflowInstances.completedAt))
            .limit(1);

        if (results.length === 0) return null;

        const data = results[0].data as Record<string, any> || {};
        const counts = (data.results || []) as Array<{ variancePercent?: number; systemQuantity: number; physicalQuantity: number; variance: number }>;
        if (counts.length === 0) return null;

        const itemsWithinTolerance = counts.filter(c => {
            const vp = c.variancePercent ?? (c.systemQuantity > 0 ? Math.abs(c.variance) / c.systemQuantity * 100 : (c.physicalQuantity > 0 ? 100 : 0));
            return vp <= 5;
        });

        return parseFloat(((itemsWithinTolerance.length / counts.length) * 100).toFixed(1));
    }

    private static consolidateKPIs(
        branches: BranchKPI[],
        startDate: Date,
        endDate: Date
    ): BranchKPI {
        const totalRevenue = branches.reduce((s, b) => s + b.revenueCents, 0);
        const totalCogs = branches.reduce((s, b) => s + b.cogsCents, 0);
        const weightedFoodCost = totalRevenue > 0 ? parseFloat(((totalCogs / totalRevenue) * 100).toFixed(2)) : 0;
        const avgTurnover = branches.length > 0 ? parseFloat((branches.reduce((s, b) => s + b.inventoryTurnover, 0) / branches.length).toFixed(2)) : 0;
        const avgStockDays = branches.length > 0 ? parseFloat((branches.reduce((s, b) => s + b.stockDays, 0) / branches.length).toFixed(1)) : 0;
        const avgShrinkage = branches.length > 0 ? parseFloat((branches.reduce((s, b) => s + b.shrinkagePercent, 0) / branches.length).toFixed(2)) : 0;
        const avgFillRate = branches.length > 0 ? parseFloat((branches.reduce((s, b) => s + b.fillRate, 0) / branches.length).toFixed(1)) : 100;

        return {
            branchId: 'consolidated',
            branchName: 'Consolidado',
            foodCostPercent: weightedFoodCost,
            cogsCents: totalCogs,
            revenueCents: totalRevenue,
            inventoryTurnover: avgTurnover,
            stockDays: avgStockDays,
            shrinkagePercent: avgShrinkage,
            fillRate: avgFillRate,
            countAccuracy: null,
        };
    }
}
