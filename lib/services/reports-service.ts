import { db } from "@/lib/db";
import { salesEntries, recipes, recipeItems, inventoryItems, inventoryMovements } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";

export interface VarianceReportRow {
    itemId: string;
    itemName: string;
    sku?: string;
    unit: string;
    theoreticalQty: number;
    actualQty: number;
    varianceQty: number; // actual - theoretical
    variancePercent: number; // (variance / theoretical) * 100
    // Extensión a dinero (centavos): la varianza en cantidad no dice cuánto
    // duele; multiplicar por el costo unitario vigente sí.
    unitCostCents: number;
    theoreticalCostCents: number;
    actualCostCents: number;
    varianceCostCents: number;
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

        // 3. Calculate Actual Consumption per Item (sum of all negative movements in the period)
        const movements = await db.select()
            .from(inventoryMovements)
            .where(
                and(
                    eq(inventoryMovements.branchId, branchId),
                    gte(inventoryMovements.timestamp, startDate),
                    lte(inventoryMovements.timestamp, endDate),
                    sql`${inventoryMovements.quantityChange} < 0` // negative changes mean reductions
                )
            );

        const actualMap: Record<string, number> = {};
        for (const mov of movements) {
            const consumed = -mov.quantityChange; // convert to positive amount consumed
            actualMap[mov.itemId] = (actualMap[mov.itemId] || 0) + consumed;
        }

        // 4. Metadata de insumos en una sola consulta (evita N+1 por fila).
        const allItemIds = new Set([
            ...Object.keys(theoreticalMap),
            ...Object.keys(actualMap)
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
            const actualQty = actualMap[itemId] || 0;
            const varianceQty = actualQty - theoreticalQty;
            const variancePercent = theoreticalQty > 0 ? (varianceQty / theoreticalQty) * 100 : 0;

            const unitCostCents = item
                ? (item.averageCost ?? item.lastCost ?? item.standardCost ?? 0)
                : 0;

            report.push({
                itemId,
                itemName: name,
                sku,
                unit,
                theoreticalQty: parseFloat(theoreticalQty.toFixed(4)),
                actualQty: parseFloat(actualQty.toFixed(4)),
                varianceQty: parseFloat(varianceQty.toFixed(4)),
                variancePercent: parseFloat(variancePercent.toFixed(2)),
                unitCostCents,
                theoreticalCostCents: Math.round(theoreticalQty * unitCostCents),
                actualCostCents: Math.round(actualQty * unitCostCents),
                varianceCostCents: Math.round(varianceQty * unitCostCents),
            });
        }

        // La varianza que duele primero: ordenar por impacto en dinero.
        report.sort((a, b) => Math.abs(b.varianceCostCents) - Math.abs(a.varianceCostCents));

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
