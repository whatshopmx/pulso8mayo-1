import { db } from "@/lib/db";
import { inventoryKnowledgeGraph, inventoryMovements, inventoryWaste, inventoryBatches, inventoryItems } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, sum, avg, count } from "drizzle-orm";

export interface ItemInsight {
    itemId: string;
    itemName: string;
    avgDailyConsumption: number | null;
    consumptionTrend: number | null;
    avgWastePercent: number | null;
    wasteTrend: number | null;
    stockoutCount: number | null;
    totalWasteLoss: number | null;
    period: string;
    periodStart: Date;
    periodEnd: Date;
}

export class KnowledgeService {

    static async computeMetrics(companyId: string, branchId: string, itemId: string): Promise<void> {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Consumption: sum of negative movements (USAGE, WASTE) per day
        const consumptionData = await db.select({
            day: sql<string>`DATE(${inventoryMovements.timestamp})`,
            total: sql<number>`ABS(SUM(${inventoryMovements.quantityChange}))`,
        })
            .from(inventoryMovements)
            .where(and(
                eq(inventoryMovements.branchId, branchId),
                eq(inventoryMovements.itemId, itemId),
                gte(inventoryMovements.timestamp, thirtyDaysAgo),
                sql`${inventoryMovements.quantityChange} < 0`,
            ))
            .groupBy(sql`DATE(${inventoryMovements.timestamp})`);

        const dailyTotals = consumptionData.map(d => d.total);
        const avgDailyConsumption = dailyTotals.length > 0
            ? Math.round(dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length)
            : null;

        // Consumption trend: compare recent 7 days vs prior 21
        const recent7 = consumptionData.filter(d => new Date(d.day) >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
        const prior21 = consumptionData.filter(d => new Date(d.day) < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
        const avgRecent = recent7.length > 0 ? recent7.reduce((a, b) => a + b.total, 0) / recent7.length : 0;
        const avgPrior = prior21.length > 0 ? prior21.reduce((a, b) => a + b.total, 0) / prior21.length : 1;
        const consumptionTrend = Math.round(((avgRecent - avgPrior) / avgPrior) * 100);

        // Consumption volatility: coefficient of variation
        const consumptionVolatility = dailyTotals.length > 1
            ? (() => {
                const mean = dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length;
                const variance = dailyTotals.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyTotals.length;
                return Math.round(Math.sqrt(variance));
            })()
            : null;

        // Waste metrics
        const wasteData = await db.select({
            totalWaste: sql<number>`COALESCE(SUM(${inventoryWaste.quantity}), 0)`,
            totalLoss: sql<number>`COALESCE(SUM(${inventoryWaste.totalLoss}), 0)`,
            wasteCount: count(),
        })
            .from(inventoryWaste)
            .where(and(
                eq(inventoryWaste.branchId, branchId),
                eq(inventoryWaste.itemId, itemId),
                gte(inventoryWaste.recordedAt, thirtyDaysAgo),
                // STAFF y COURTESY son consumo, no merma: no ensucian el trend (OQ-1).
                sql`${inventoryWaste.reason} NOT IN ('STAFF', 'COURTESY')`,
            ));

        const totalWasteQty = wasteData[0]?.totalWaste ?? 0;
        const totalWasteLoss = wasteData[0]?.totalLoss ?? 0;

        // Waste % = waste qty / total consumption * 10000 (basis points)
        const totalConsumed = dailyTotals.reduce((a, b) => a + b, 0);
        const avgWastePercent = totalConsumed > 0
            ? Math.round((totalWasteQty / totalConsumed) * 10000)
            : null;

        // Waste trend: compare waste rate last 7 days vs prior 21
        const wasteRecent = await db.select({
            total: sql<number>`COALESCE(SUM(${inventoryWaste.quantity}), 0)`,
        })
            .from(inventoryWaste)
            .where(and(
                eq(inventoryWaste.branchId, branchId),
                eq(inventoryWaste.itemId, itemId),
                gte(inventoryWaste.recordedAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
            ));

        const wastePrior = await db.select({
            total: sql<number>`COALESCE(SUM(${inventoryWaste.quantity}), 0)`,
        })
            .from(inventoryWaste)
            .where(and(
                eq(inventoryWaste.branchId, branchId),
                eq(inventoryWaste.itemId, itemId),
                gte(inventoryWaste.recordedAt, thirtyDaysAgo),
                lte(inventoryWaste.recordedAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
            ));

        const wasteRecentTotal = wasteRecent[0]?.total ?? 0;
        const wastePriorTotal = wastePrior[0]?.total ?? 1;
        const wasteTrend = Math.round(((wasteRecentTotal - wastePriorTotal) / wastePriorTotal) * 100);

        // Stockout count
        const stockoutData = await db.select({
            count: count(),
        })
            .from(inventoryBatches)
            .where(and(
                eq(inventoryBatches.branchId, branchId),
                eq(inventoryBatches.itemId, itemId),
                eq(inventoryBatches.currentQuantity, 0),
                gte(inventoryBatches.updatedAt, thirtyDaysAgo),
            ));
        const stockoutCount = stockoutData[0]?.count ?? 0;

        // Average stock level
        const avgStockData = await db.select({
            avgStock: sql<number>`COALESCE(AVG(${inventoryBatches.currentQuantity}), 0)`,
        })
            .from(inventoryBatches)
            .where(and(
                eq(inventoryBatches.branchId, branchId),
                eq(inventoryBatches.itemId, itemId),
            ));
        const avgStockLevel = Math.round(avgStockData[0]?.avgStock ?? 0);

        // Last movement
        const lastMovement = await db.select({ timestamp: inventoryMovements.timestamp })
            .from(inventoryMovements)
            .where(and(
                eq(inventoryMovements.branchId, branchId),
                eq(inventoryMovements.itemId, itemId),
            ))
            .orderBy(sql`${inventoryMovements.timestamp} DESC`)
            .limit(1);

        // Upsert
        const existing = await db.query.inventoryKnowledgeGraph.findFirst({
            where: and(
                eq(inventoryKnowledgeGraph.companyId, companyId),
                eq(inventoryKnowledgeGraph.branchId, branchId),
                eq(inventoryKnowledgeGraph.itemId, itemId),
                eq(inventoryKnowledgeGraph.period, 'DAILY'),
            ),
        });

        const values = {
            avgDailyConsumption,
            consumptionTrend,
            consumptionVolatility,
            avgWastePercent,
            wasteTrend,
            totalWasteLoss,
            avgStockLevel,
            stockoutCount,
            lastMovementAt: lastMovement[0]?.timestamp ?? null,
            periodStart: thirtyDaysAgo,
            periodEnd: now,
            computedAt: now,
        };

        if (existing) {
            await db.update(inventoryKnowledgeGraph)
                .set({ ...values, updatedAt: new Date() })
                .where(eq(inventoryKnowledgeGraph.id, existing.id));
        } else {
            await db.insert(inventoryKnowledgeGraph).values({
                companyId,
                branchId,
                itemId,
                period: 'DAILY',
                ...values,
            });
        }
    }

    static async getInsights(companyId: string, branchId: string): Promise<ItemInsight[]> {
        const rows = await db.select({
            itemId: inventoryKnowledgeGraph.itemId,
            itemName: inventoryItems.name,
            avgDailyConsumption: inventoryKnowledgeGraph.avgDailyConsumption,
            consumptionTrend: inventoryKnowledgeGraph.consumptionTrend,
            avgWastePercent: inventoryKnowledgeGraph.avgWastePercent,
            wasteTrend: inventoryKnowledgeGraph.wasteTrend,
            stockoutCount: inventoryKnowledgeGraph.stockoutCount,
            totalWasteLoss: inventoryKnowledgeGraph.totalWasteLoss,
            period: inventoryKnowledgeGraph.period,
            periodStart: inventoryKnowledgeGraph.periodStart,
            periodEnd: inventoryKnowledgeGraph.periodEnd,
        })
            .from(inventoryKnowledgeGraph)
            .innerJoin(inventoryItems, eq(inventoryKnowledgeGraph.itemId, inventoryItems.id))
            .where(and(
                eq(inventoryKnowledgeGraph.companyId, companyId),
                eq(inventoryKnowledgeGraph.branchId, branchId),
            ))
            .orderBy(sql`${inventoryKnowledgeGraph.avgWastePercent} DESC NULLS LAST`);

        return rows;
    }

    static async refreshAll(companyId: string, branchId: string): Promise<void> {
        const items = await db.select({ id: inventoryItems.id })
            .from(inventoryItems)
            .where(eq(inventoryItems.companyId, companyId));

        for (const item of items) {
            await KnowledgeService.computeMetrics(companyId, branchId, item.id);
        }
    }
}
