import { db } from "@/lib/db";
import {
    inventoryItems,
    inventoryBatches,
    inventoryMovements,
    inventoryWaste,
    salesEntries,
    recipes,
    recipeItems,
    branches,
} from "@/lib/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Reportes operativos de inventario (usage, COGS, par level, valuation,
// waste). Cantidades `numeric(12,4)` llegan como string: se coaccionan con
// Number() antes de operar. Dinero siempre en centavos (integer), igual que
// executive-report-service.
// ---------------------------------------------------------------------------

const r4 = (n: number) => parseFloat(n.toFixed(4));
const r2 = (n: number) => parseFloat(n.toFixed(2));

export interface UsageReportRow {
    itemId: string;
    itemName: string;
    sku?: string;
    unit: string;
    beginningQty: number;
    receivedQty: number;
    endingQty: number;
    usageQty: number;
    unitCostCents: number;
    usageCostCents: number;
}

export interface UsageReport {
    branchId: string;
    period: { start: string; end: string };
    rows: UsageReportRow[];
    totalUsageCostCents: number;
}

export interface CogsReport {
    branchId: string;
    period: { start: string; end: string };
    cogsCents: number;
    revenueCents: number;
    foodCostPercent: number;
    byRecipe: Array<{ recipeId: string; recipeName: string; costCents: number }>;
}

export type ParStatus = "BELOW_MIN" | "BELOW_PAR" | "ABOVE_MAX" | "OK";

export interface ParLevelRow {
    itemId: string;
    itemName: string;
    sku?: string;
    category?: string | null;
    unit: string;
    currentStock: number;
    minLevel: number;
    maxLevel: number | null;
    avgWeeklyUsage: number;
    parLevel: number;
    suggestedOrderQty: number;
    status: ParStatus;
}

export interface ParLevelReport {
    branchId: string;
    belowParCount: number;
    rows: ParLevelRow[];
}

export interface ValuationRow {
    itemId: string;
    itemName: string;
    category: string | null;
    unit: string;
    quantityOnHand: number;
    effectiveUnitCostCents: number;
    totalValueCents: number;
    batchCount: number;
}

export interface ValuationReport {
    companyId: string;
    branchId?: string;
    asOf: string;
    totalValueCents: number;
    byCategory: Array<{ category: string; totalValueCents: number }>;
    rows: ValuationRow[];
}

export interface WasteByReasonRow {
    reason: string;
    entries: number;
    lossCents: number;
}

export interface WasteByItemRow {
    itemId: string;
    itemName: string;
    unit: string;
    entries: number;
    quantity: number;
    lossCents: number;
}

export interface WasteReport {
    branchId?: string;
    companyId: string;
    period: { start: string; end: string };
    totalLossCents: number;
    // Merma "real": excluye STAFF y COURTESY que son consumo, no pérdida
    // (misma convención que executive-report-service.calcWasteTotal).
    trueWasteLossCents: number;
    byReason: WasteByReasonRow[];
    byItem: WasteByItemRow[];
}

function itemUnitCost(item: { averageCost: number | null; lastCost: number | null; standardCost: number | null }): number {
    return item.averageCost ?? item.lastCost ?? item.standardCost ?? 0;
}

/** Receta expandida a insumos hoja: cantidad por unidad de yield. */
interface ExpandedRecipe {
    leaves: Array<{ itemId: string; qtyPerYield: number }>;
}

interface RecipeCostIndex {
    nodes: Map<string, ExpandedRecipe>;
    itemCosts: Map<string, number>;
}

export class InventoryReportsService {
    /**
     * Uso por insumo en un periodo: Inicial + Compras − Final = Uso.
     * El saldo inicial/final se deriva de la suma acumulada de movimientos
     * (`inventory_movements`), no de lotes, para capturar ajustes y mermas
     * aunque los lotes ya se hayan cerrado.
     */
    static async getUsageReport(
        branchId: string,
        startDate: Date,
        endDate: Date
    ): Promise<UsageReport> {
        const movements = await db.select({
            itemId: inventoryMovements.itemId,
            opening: sql<string>`coalesce(sum(case when ${inventoryMovements.timestamp} < ${startDate} then ${inventoryMovements.quantityChange} else 0 end), 0)`,
            periodChange: sql<string>`coalesce(sum(case when ${inventoryMovements.timestamp} <= ${endDate} then ${inventoryMovements.quantityChange} else 0 end), 0)`,
            received: sql<string>`coalesce(sum(case when ${inventoryMovements.timestamp} between ${startDate} and ${endDate} and ${inventoryMovements.type} = 'RECEIVING' then ${inventoryMovements.quantityChange} else 0 end), 0)`,
        })
            .from(inventoryMovements)
            .where(and(
                eq(inventoryMovements.branchId, branchId),
                lte(inventoryMovements.timestamp, endDate),
            ))
            .groupBy(inventoryMovements.itemId);

        // Filtrar ítems sin actividad en el periodo: el reporte es de uso,
        // no del catálogo completo. Un ítem puede tener periodo neto en cero
        // pero actividad real (recibió y consumió lo mismo).
        const active = movements.filter(m => Number(m.periodChange) !== 0 || Number(m.received) !== 0);
        if (active.length === 0) {
            return {
                branchId,
                period: { start: startDate.toISOString(), end: endDate.toISOString() },
                rows: [],
                totalUsageCostCents: 0,
            };
        }

        const items = await db.select()
            .from(inventoryItems)
            .where(inArray(inventoryItems.id, active.map(m => m.itemId)));
        const itemMap = new Map(items.map(i => [i.id, i]));

        const rows: UsageReportRow[] = [];
        let totalUsageCostCents = 0;

        for (const m of active) {
            const item = itemMap.get(m.itemId);
            if (!item) continue;

            const beginningQty = Number(m.opening);
            const endingQty = beginningQty + Number(m.periodChange);
            const receivedQty = Number(m.received);
            // Uso = Inicial + Compras − Final. Equivale al consumo neto del
            // periodo, pero deja explícitos los tres términos de la fórmula.
            const usageQty = beginningQty + receivedQty - endingQty;

            const unitCostCents = itemUnitCost(item);
            const usageCostCents = Math.round(usageQty * unitCostCents);
            totalUsageCostCents += usageCostCents;

            rows.push({
                itemId: m.itemId,
                itemName: item.name,
                sku: item.sku || undefined,
                unit: item.unit,
                beginningQty: r4(beginningQty),
                receivedQty: r4(receivedQty),
                endingQty: r4(endingQty),
                usageQty: r4(usageQty),
                unitCostCents,
                usageCostCents,
            });
        }

        rows.sort((a, b) => b.usageCostCents - a.usageCostCents);

        return {
            branchId,
            period: { start: startDate.toISOString(), end: endDate.toISOString() },
            rows,
            totalUsageCostCents,
        };
    }

    /**
     * COGS vía expansión de recetas sobre las ventas del periodo. Cada receta
     * se expande a insumos hoja una sola vez (mapa en memoria); después cada
     * venta sólo multiplica cantidad × costo unitario. Evita el N+1 de
     * receta/insumo por venta.
     */
    static async getCogsReport(
        branchId: string,
        startDate: Date,
        endDate: Date
    ): Promise<CogsReport> {
        const sales = await db.select({
            recipeId: salesEntries.recipeId,
            quantitySold: salesEntries.quantitySold,
            revenue: salesEntries.totalRevenue,
        })
            .from(salesEntries)
            .where(and(
                eq(salesEntries.branchId, branchId),
                gte(salesEntries.saleDate, startDate),
                lte(salesEntries.saleDate, endDate),
            ));

        let revenueCents = 0;
        let cogsCents = 0;
        let recipeNames = new Map<string, string>();
        const byRecipeMap = new Map<string, number>();

        if (sales.length > 0) {
            const [costIndex, names] = await Promise.all([
                this.buildRecipeCostIndex(),
                this.fetchRecipeNames(),
            ]);
            recipeNames = names;

            for (const sale of sales) {
                const qtySold = parseFloat(sale.quantitySold);
                revenueCents += sale.revenue ?? 0;

                const saleCost = this.costOfSale(sale.recipeId, qtySold, costIndex);
                cogsCents += saleCost;
                byRecipeMap.set(sale.recipeId, (byRecipeMap.get(sale.recipeId) ?? 0) + saleCost);
            }
        }

        return {
            branchId,
            period: { start: startDate.toISOString(), end: endDate.toISOString() },
            cogsCents: Math.round(cogsCents),
            revenueCents,
            foodCostPercent: revenueCents > 0 ? r2((cogsCents / revenueCents) * 100) : 0,
            byRecipe: [...byRecipeMap.entries()]
                .map(([recipeId, cost]) => ({
                    recipeId,
                    recipeName: recipeNames.get(recipeId) ?? "Receta desconocida",
                    costCents: Math.round(cost),
                }))
                .sort((a, b) => b.costCents - a.costCents),
        };
    }

    private static async fetchRecipeNames(): Promise<Map<string, string>> {
        const rows = await db.select({ id: recipes.id, name: recipes.name }).from(recipes);
        return new Map(rows.map(r => [r.id, r.name]));
    }

    /**
     * Expande cada receta (incluyendo subrecetas, con ciclo-guardia) a su lista
     * plana de insumos hoja una sola vez, junto con el costo unitario vigente
     * de cada insumo.
     */
    private static async buildRecipeCostIndex(): Promise<RecipeCostIndex> {
        const [recipeHeaders, allRecipeItems, invItems] = await Promise.all([
            db.select({ id: recipes.id, baseYield: recipes.baseYield }).from(recipes),
            db.select().from(recipeItems),
            db.select({
                id: inventoryItems.id,
                averageCost: inventoryItems.averageCost,
                lastCost: inventoryItems.lastCost,
                standardCost: inventoryItems.standardCost,
            }).from(inventoryItems),
        ]);

        const itemsByRecipe = new Map<string, typeof allRecipeItems>();
        for (const ri of allRecipeItems) {
            const list = itemsByRecipe.get(ri.recipeId) ?? [];
            list.push(ri);
            itemsByRecipe.set(ri.recipeId, list);
        }

        const nodes = new Map<string, ExpandedRecipe>();
        const expanding = new Set<string>();

        const expand = (recipeId: string): ExpandedRecipe => {
            const cached = nodes.get(recipeId);
            if (cached) return cached;

            const node: ExpandedRecipe = { leaves: [] };
            // Ciclo-guardia: una subreceta que se referencia a sí misma no
            // debe colgar el request; se devuelve vacía.
            if (expanding.has(recipeId)) return node;

            expanding.add(recipeId);
            try {
                const header = recipeHeaders.find(r => r.id === recipeId);
                const baseYield = header ? (parseFloat(header.baseYield || "1") || 1) : 1;

                for (const ri of itemsByRecipe.get(recipeId) ?? []) {
                    const qtyPerYield = parseFloat(ri.quantity) / baseYield;
                    if (ri.isSubRecipe) {
                        const sub = expand(ri.itemId);
                        for (const leaf of sub.leaves) {
                            node.leaves.push({ itemId: leaf.itemId, qtyPerYield: leaf.qtyPerYield * qtyPerYield });
                        }
                    } else {
                        node.leaves.push({ itemId: ri.itemId, qtyPerYield });
                    }
                }
            } finally {
                expanding.delete(recipeId);
            }

            nodes.set(recipeId, node);
            return node;
        };

        for (const r of recipeHeaders) expand(r.id);

        return {
            nodes,
            itemCosts: new Map(invItems.map(i => [i.id, itemUnitCost(i)])),
        };
    }

    private static costOfSale(
        recipeId: string,
        qtySold: number,
        index: RecipeCostIndex
    ): number {
        const node = index.nodes.get(recipeId);
        if (!node) return 0;

        let total = 0;
        for (const leaf of node.leaves) {
            const qty = leaf.qtyPerYield * qtySold;
            total += qty * (index.itemCosts.get(leaf.itemId) ?? 0);
        }
        return total;
    }

    /**
     * Niveles par: stock actual vs objetivo. El objetivo combina el mínimo
     * configurado con el uso semanal promedio (últimas 4 semanas) escalado por
     * el lead time del proveedor: par = max(minLevel, usoSemanal × leadTime/7).
     */
    static async getParLevelReport(
        branchId: string,
        options?: { weeksForAverage?: number }
    ): Promise<ParLevelReport> {
        const weeks = options?.weeksForAverage ?? 4;
        const cutoff = new Date(Date.now() - weeks * 7 * 86400000);

        const [stockLevels, usageAvg] = await Promise.all([
            db.select({
                itemId: inventoryBatches.itemId,
                totalStock: sql<string>`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`,
            })
                .from(inventoryBatches)
                .where(and(
                    eq(inventoryBatches.branchId, branchId),
                    eq(inventoryBatches.status, 'AVAILABLE'),
                ))
                .groupBy(inventoryBatches.itemId),
            db.select({
                itemId: inventoryMovements.itemId,
                consumed: sql<string>`coalesce(sum(case when ${inventoryMovements.quantityChange} < 0 then -${inventoryMovements.quantityChange} else 0 end), 0)`,
            })
                .from(inventoryMovements)
                .where(and(
                    eq(inventoryMovements.branchId, branchId),
                    gte(inventoryMovements.timestamp, cutoff),
                ))
                .groupBy(inventoryMovements.itemId),
        ]);

        const itemIds = new Set([...stockLevels.map(s => s.itemId), ...usageAvg.map(u => u.itemId)]);
        if (itemIds.size === 0) {
            return { branchId, belowParCount: 0, rows: [] };
        }

        const items = await db.select()
            .from(inventoryItems)
            .where(and(
                inArray(inventoryItems.id, [...itemIds]),
                eq(inventoryItems.active, true),
            ));
        const stockMap = new Map(stockLevels.map(s => [s.itemId, Number(s.totalStock)]));
        const weeklyMap = new Map(usageAvg.map(u => [u.itemId, Number(u.consumed) / weeks]));

        const rows: ParLevelRow[] = items.map(item => {
            const currentStock = stockMap.get(item.id) ?? 0;
            const avgWeeklyUsage = weeklyMap.get(item.id) ?? 0;
            const minLevel = item.minLevel ?? 0;
            const maxLevel = item.maxLevel ?? null;
            const leadTimeDays = item.leadTimeDays ?? 3;

            const demandBasedPar = Math.ceil(avgWeeklyUsage * (leadTimeDays / 7));
            const parLevel = Math.max(minLevel, demandBasedPar);
            const suggestedOrderQty = r4(Math.max(0, parLevel - currentStock));

            let status: ParStatus = "OK";
            if (minLevel > 0 && currentStock < minLevel) status = "BELOW_MIN";
            else if (currentStock < parLevel) status = "BELOW_PAR";
            else if (maxLevel !== null && currentStock > maxLevel) status = "ABOVE_MAX";

            return {
                itemId: item.id,
                itemName: item.name,
                sku: item.sku || undefined,
                category: item.category,
                unit: item.unit,
                currentStock: r4(currentStock),
                minLevel,
                maxLevel,
                avgWeeklyUsage: r4(avgWeeklyUsage),
                parLevel,
                suggestedOrderQty,
                status,
            };
        });

        rows.sort((a, b) => b.suggestedOrderQty * this.parPriority(b.status)
            - a.suggestedOrderQty * this.parPriority(a.status));

        return {
            branchId,
            belowParCount: rows.filter(r => r.status === "BELOW_MIN" || r.status === "BELOW_PAR").length,
            rows,
        };
    }

    /** Orden de prioridad: faltantes críticos primero, excesos al final. */
    private static parPriority(status: ParStatus): number {
        switch (status) {
            case "BELOW_MIN": return 3;
            case "BELOW_PAR": return 2;
            case "ABOVE_MAX": return 1;
            default: return 0;
        }
    }

    /**
     * Valorización del inventario actual: cantidad en mano × costo efectivo
     * por lote (costo del lote; si no tiene, costo promedio/último/estándar
     * del insumo). Puede ser por sucursal o consolidada de la empresa.
     */
    static async getValuationReport(
        companyId: string,
        branchId?: string
    ): Promise<ValuationReport> {
        const conditions = [eq(branches.companyId, companyId)];
        if (branchId) conditions.push(eq(inventoryBatches.branchId, branchId));

        const batches = await db.select({
            itemId: inventoryBatches.itemId,
            quantity: inventoryBatches.currentQuantity,
            unitCost: inventoryBatches.unitCost,
            averageCost: inventoryItems.averageCost,
            lastCost: inventoryItems.lastCost,
            standardCost: inventoryItems.standardCost,
            itemName: inventoryItems.name,
            category: inventoryItems.category,
            unit: inventoryItems.unit,
        })
            .from(inventoryBatches)
            .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
            .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
            .where(and(...conditions));

        const byItem = new Map<string, ValuationRow>();

        for (const b of batches) {
            const qty = Number(b.quantity);
            if (qty === 0) continue;

            const effectiveUnitCost = b.unitCost
                ?? b.averageCost
                ?? b.lastCost
                ?? b.standardCost
                ?? 0;

            let row = byItem.get(b.itemId);
            if (!row) {
                row = {
                    itemId: b.itemId,
                    itemName: b.itemName,
                    category: b.category,
                    unit: b.unit,
                    quantityOnHand: 0,
                    effectiveUnitCostCents: effectiveUnitCost,
                    totalValueCents: 0,
                    batchCount: 0,
                };
                byItem.set(b.itemId, row);
            }

            row.quantityOnHand += qty;
            row.totalValueCents += Math.round(qty * effectiveUnitCost);
            row.batchCount += 1;
            // Costo más reciente visto gana: los lotes viejos pueden tener
            // costo desactualizado.
            row.effectiveUnitCostCents = effectiveUnitCost;
        }

        const rows = [...byItem.values()].map(r => ({
            ...r,
            quantityOnHand: r4(r.quantityOnHand),
            totalValueCents: Math.round(r.totalValueCents),
        })).sort((a, b) => b.totalValueCents - a.totalValueCents);

        const categoryTotals = new Map<string, number>();
        for (const r of rows) {
            const key = r.category ?? "Sin categoría";
            categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + r.totalValueCents);
        }

        return {
            companyId,
            branchId,
            asOf: new Date().toISOString(),
            totalValueCents: rows.reduce((s, r) => s + r.totalValueCents, 0),
            byCategory: [...categoryTotals.entries()]
                .map(([category, totalValueCents]) => ({ category, totalValueCents }))
                .sort((a, b) => b.totalValueCents - a.totalValueCents),
            rows,
        };
    }

    /**
     * Reporte de mermas agregado por razón e insumo. STAFF/COURTESY son
     * consumo autorizado, así que se reportan en el desglose pero se excluyen
     * del total de pérdida real.
     */
    static async getWasteReport(
        companyId: string,
        startDate: Date,
        endDate: Date,
        branchId?: string
    ): Promise<WasteReport> {
        const conditions = [
            eq(inventoryWaste.companyId, companyId),
            gte(inventoryWaste.recordedAt, startDate),
            lte(inventoryWaste.recordedAt, endDate),
        ];
        if (branchId) conditions.push(eq(inventoryWaste.branchId, branchId));

        const [byReasonRaw, byItemRaw] = await Promise.all([
            db.select({
                reason: inventoryWaste.reason,
                entries: sql<number>`cast(count(*) as integer)`,
                lossCents: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
            })
                .from(inventoryWaste)
                .where(and(...conditions))
                .groupBy(inventoryWaste.reason),
            db.select({
                itemId: inventoryWaste.itemId,
                itemName: inventoryItems.name,
                unit: inventoryWaste.unit,
                entries: sql<number>`cast(count(*) as integer)`,
                quantity: sql<string>`coalesce(sum(${inventoryWaste.quantity}), 0)`,
                lossCents: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
            })
                .from(inventoryWaste)
                .innerJoin(inventoryItems, eq(inventoryWaste.itemId, inventoryItems.id))
                .where(and(...conditions))
                .groupBy(inventoryWaste.itemId, inventoryItems.name, inventoryWaste.unit),
        ]);

        // sum()/count() llegan como string o number según el driver: coaccionar.
        const normalizeReason = byReasonRaw.map(r => ({
            reason: r.reason,
            entries: Number(r.entries),
            lossCents: Number(r.lossCents),
        }));
        const normalizeItem = byItemRaw.map(r => ({
            itemId: r.itemId,
            itemName: r.itemName,
            unit: r.unit,
            entries: Number(r.entries),
            quantity: r4(Number(r.quantity)),
            lossCents: Number(r.lossCents),
        }));

        const totalLossCents = normalizeReason.reduce((s, r) => s + r.lossCents, 0);
        const trueWasteLossCents = normalizeReason
            .filter(r => r.reason !== 'STAFF' && r.reason !== 'COURTESY')
            .reduce((s, r) => s + r.lossCents, 0);

        return {
            companyId,
            branchId,
            period: { start: startDate.toISOString(), end: endDate.toISOString() },
            totalLossCents,
            trueWasteLossCents,
            byReason: normalizeReason.sort((a, b) => b.lossCents - a.lossCents),
            byItem: normalizeItem.sort((a, b) => b.lossCents - a.lossCents),
        };
    }
}
