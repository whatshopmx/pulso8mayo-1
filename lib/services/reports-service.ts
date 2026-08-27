import { db } from "@/lib/db";
import { salesEntries, recipes, recipeItems, inventoryItems, inventoryMovements } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { InventoryReportsService } from "./inventory-reports-service";

export type SemaphoreStatus = "SUCCESS" | "WARNING" | "DANGER" | "MISSING_DATA";

export interface VarianceReportRow {
    itemId: string;
    itemName: string;
    sku?: string;
    unit: string;
    theoreticalQty: number;
    actualQty: number | null;
    wasteQty: number;
    transfersOutQty: number;
    varianceQty: number | null; // actualQty - wasteQty - transfersOutQty - theoreticalQty
    variancePercent: number | null; // (varianceQty / theoreticalQty) * 100
    unitCostCents: number;
    theoreticalCostCents: number;
    actualCostCents: number | null;
    varianceCostCents: number | null;
    status: SemaphoreStatus;
    actionableNote?: string;
}

export class ReportsService {
    /**
     * Calculates theoretical vs actual consumption for all items in a branch over a period.
     */
    static async getVarianceReport(
        branchId: string,
        startDate: Date,
        endDate: Date
    ): Promise<VarianceReportRow[]> {
        // 1. Fetch all sales entries in the period
        const sales = await db.select()
            .from(salesEntries)
            .where(
                and(
                    eq(salesEntries.branchId, branchId),
                    gte(salesEntries.saleDate, startDate),
                    lte(salesEntries.saleDate, endDate)
                )
            );

        // 2. Calculate Theoretical Consumption per Item
        const theoreticalMap: Record<string, { qty: number; unit: string; name: string; sku?: string }> = {};

        for (const sale of sales) {
            const qtySold = parseFloat(sale.quantitySold);
            await this.accumulateTheoretical(sale.recipeId, qtySold, theoreticalMap);
        }

        // 3. Get Actual Usage from Inventory Reports Service (Initial + Purchases - Final)
        const usageReport = await InventoryReportsService.getUsageReport(branchId, startDate, endDate);
        const usageMap = new Map(usageReport.rows.map(r => [r.itemId, r]));

        // 4. Fetch waste and transfers out to subtract from usage
        const nonConsumptionMovements = await db.select({
            itemId: inventoryMovements.itemId,
            type: inventoryMovements.type,
            qty: sql<string>`coalesce(sum(${inventoryMovements.quantityChange}), 0)`
        })
        .from(inventoryMovements)
        .where(
            and(
                eq(inventoryMovements.branchId, branchId),
                gte(inventoryMovements.timestamp, startDate),
                lte(inventoryMovements.timestamp, endDate),
                sql`(${inventoryMovements.type} = 'TRANSFER' AND ${inventoryMovements.quantityChange} < 0) OR (${inventoryMovements.type} = 'WASTE' AND coalesce(${inventoryMovements.reason}, '') NOT IN ('STAFF', 'COURTESY'))`
            )
        )
        .groupBy(inventoryMovements.itemId, inventoryMovements.type);

        const wasteMap = new Map<string, number>();
        const transfersOutMap = new Map<string, number>();

        for (const mov of nonConsumptionMovements) {
            const qty = Math.abs(parseFloat(mov.qty));
            if (mov.type === 'WASTE') {
                wasteMap.set(mov.itemId, (wasteMap.get(mov.itemId) || 0) + qty);
            } else if (mov.type === 'TRANSFER') {
                transfersOutMap.set(mov.itemId, (transfersOutMap.get(mov.itemId) || 0) + qty);
            }
        }

        // 5. Metadata de insumos en una sola consulta
        const allItemIds = new Set([
            ...Object.keys(theoreticalMap),
            ...usageReport.rows.map(r => r.itemId),
            ...wasteMap.keys(),
            ...transfersOutMap.keys()
        ]);

        const itemRows = allItemIds.size > 0
            ? await db.select()
                .from(inventoryItems)
                .where(inArray(inventoryItems.id, [...allItemIds]))
            : [];
        const itemMap = new Map(itemRows.map(i => [i.id, i]));

        const report: VarianceReportRow[] = [];

        for (const itemId of allItemIds) {
            const item = itemMap.get(itemId);
            const name = theoreticalMap[itemId]?.name ?? item?.name ?? "Insumo desconocido";
            const unit = theoreticalMap[itemId]?.unit ?? item?.unit ?? "UNIT";
            const sku = theoreticalMap[itemId]?.sku ?? item?.sku ?? undefined;

            const theoreticalQty = theoreticalMap[itemId]?.qty || 0;
            const usageRow = usageMap.get(itemId);
            const actualQty = usageRow?.usageQty ?? null;
            
            const wasteQty = wasteMap.get(itemId) || 0;
            const transfersOutQty = transfersOutMap.get(itemId) || 0;

            const unitCostCents = item
                ? (item.averageCost ?? item.lastCost ?? item.standardCost ?? 0)
                : 0;
            const theoreticalCostCents = Math.round(theoreticalQty * unitCostCents);

            let varianceQty: number | null = null;
            let variancePercent: number | null = null;
            let actualCostCents: number | null = null;
            let varianceCostCents: number | null = null;
            let status: SemaphoreStatus = "MISSING_DATA";
            let actionableNote: string | undefined = undefined;

            if (actualQty === null) {
                actionableNote = "Falta conteo físico inicial o final en este periodo.";
            } else {
                varianceQty = actualQty - wasteQty - transfersOutQty - theoreticalQty;
                
                if (theoreticalQty > 0) {
                    variancePercent = (varianceQty / theoreticalQty) * 100;
                } else {
                    variancePercent = varianceQty === 0 ? 0 : 100; // Flag significant unrecorded usage
                }

                actualCostCents = Math.round(actualQty * unitCostCents);
                varianceCostCents = Math.round(varianceQty * unitCostCents);

                const absPercent = Math.abs(variancePercent);
                if (absPercent < 1.5) {
                    status = "SUCCESS";
                } else if (absPercent <= 3.0) {
                    status = "WARNING";
                } else {
                    status = "DANGER";
                }
            }

            report.push({
                itemId,
                itemName: name,
                sku,
                unit,
                theoreticalQty: parseFloat(theoreticalQty.toFixed(4)),
                actualQty: actualQty !== null ? parseFloat(actualQty.toFixed(4)) : null,
                wasteQty: parseFloat(wasteQty.toFixed(4)),
                transfersOutQty: parseFloat(transfersOutQty.toFixed(4)),
                varianceQty: varianceQty !== null ? parseFloat(varianceQty.toFixed(4)) : null,
                variancePercent: variancePercent !== null ? parseFloat(variancePercent.toFixed(2)) : null,
                unitCostCents,
                theoreticalCostCents,
                actualCostCents,
                varianceCostCents,
                status,
                actionableNote,
            });
        }

        // Ordenar por impacto en dinero (descendente), y luego los de missing data
        report.sort((a, b) => {
            if (a.varianceCostCents === null && b.varianceCostCents === null) return 0;
            if (a.varianceCostCents === null) return 1;
            if (b.varianceCostCents === null) return -1;
            return Math.abs(b.varianceCostCents) - Math.abs(a.varianceCostCents);
        });

        return report;
    }

    private static async accumulateTheoretical(
        recipeId: string,
        quantitySold: number,
        map: Record<string, { qty: number; unit: string; name: string; sku?: string }>
    ) {
        // Fetch recipe header to get yield
        const [recipe] = await db.select()
            .from(recipes)
            .where(eq(recipes.id, recipeId));
        if (!recipe) return;

        const baseYield = parseFloat(recipe.baseYield || "1") || 1;

        // Fetch recipe items
        const items = await db.select()
            .from(recipeItems)
            .where(eq(recipeItems.recipeId, recipeId));

        for (const item of items) {
            const qtyNeeded = (parseFloat(item.quantity) * quantitySold) / baseYield;

            if (item.isSubRecipe) {
                // Recursively accumulate sub-recipe items
                await this.accumulateTheoretical(item.itemId, qtyNeeded, map);
            } else {
                // Fetch item metadata to get name/unit
                const [invItem] = await db.select()
                    .from(inventoryItems)
                    .where(eq(inventoryItems.id, item.itemId));
                
                if (!invItem) continue;

                if (!map[item.itemId]) {
                    map[item.itemId] = {
                        qty: 0,
                        unit: invItem.unit || "UNIT",
                        name: invItem.name,
                        sku: invItem.sku || undefined,
                    };
                }
                map[item.itemId].qty += qtyNeeded;
            }
        }
    }
}
