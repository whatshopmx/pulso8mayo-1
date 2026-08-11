import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, inventoryKnowledgeGraph, suppliers } from "@/lib/db/schema";
import { eq, and, sql, gte, inArray } from "drizzle-orm";
import { PurchaseOrderService } from "./purchase-order-service";

interface SuggestedItem {
  itemId: string;
  itemName: string;
  sku: string | null;
  currentStock: number;
  minLevel: number;
  maxLevel: number | null;
  leadTimeDays: number;
  avgDailyConsumption: number;
  reorderPoint: number;
  suggestedQty: number;
  supplierId: string | null;
  supplierName: string | null;
}

export class SuggestedOrderService {
  static async calculate(companyId: string, branchId: string): Promise<SuggestedItem[]> {
    const items = await db.select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      minLevel: inventoryItems.minLevel,
      maxLevel: inventoryItems.maxLevel,
      leadTimeDays: inventoryItems.leadTimeDays,
      supplierId: inventoryItems.supplierId,
      supplierName: suppliers.name,
    })
      .from(inventoryItems)
      .leftJoin(suppliers, eq(inventoryItems.supplierId, suppliers.id))
      .where(
        and(
          eq(inventoryItems.companyId, companyId),
          eq(inventoryItems.active, true),
          sql`${inventoryItems.minLevel} IS NOT NULL AND ${inventoryItems.minLevel} > 0`
        )
      );

    const suggestions: SuggestedItem[] = [];

    for (const item of items) {
      const currentStock = await this.getCurrentStock(item.id, branchId);
      const avgDailyConsumption = await this.getAvgDailyConsumption(item.id, branchId);
      const leadTimeDays = item.leadTimeDays ?? 3;
      const safetyStock = leadTimeDays;
      const reorderPoint = Math.round(avgDailyConsumption * leadTimeDays + safetyStock);

      let suggestedQty = Math.max(0, reorderPoint - currentStock);

      if (item.maxLevel && item.maxLevel > 0) {
        suggestedQty = Math.min(suggestedQty, item.maxLevel - currentStock);
      }

      suggestedQty = Math.max(0, suggestedQty);

      suggestions.push({
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        currentStock,
        minLevel: item.minLevel ?? 0,
        maxLevel: item.maxLevel,
        leadTimeDays,
        avgDailyConsumption,
        reorderPoint,
        suggestedQty,
        supplierId: item.supplierId,
        supplierName: item.supplierName,
      });
    }

    return suggestions.filter(s => s.suggestedQty > 0);
  }

  static async generatePurchaseOrders(
    companyId: string,
    branchId: string,
    suggestedItems: Array<{ itemId: string; suggestedQty: number }>,
    userId?: string
  ) {
    if (suggestedItems.length === 0) return [];

    const itemIds = suggestedItems.map(i => i.itemId);
    const items = await db.select()
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, itemIds));

    const supplierGroups = new Map<string, Array<{ itemId: string; orderedQuantity: number; unitCost: number }>>();

    for (const suggested of suggestedItems) {
      const item = items.find(i => i.id === suggested.itemId);
      if (!item || !item.supplierId) continue;

      const existing = supplierGroups.get(item.supplierId) || [];
      existing.push({
        itemId: item.id,
        orderedQuantity: Math.round(suggested.suggestedQty),
        unitCost: item.lastCost || 0,
      });
      supplierGroups.set(item.supplierId, existing);
    }

    const orders = [];
    for (const [supplierId, poItems] of supplierGroups) {
      const po = await PurchaseOrderService.createPO({
        companyId,
        branchId,
        supplierId,
        requestedBy: userId || 'system',
        items: poItems,
        notes: 'Orden generada automáticamente por sistema de sugerencias PAR',
      });
      orders.push(po);
    }

    return orders;
  }

  private static async getCurrentStock(itemId: string, branchId: string): Promise<number> {
    const result = await db.select({
      total: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`,
    })
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.itemId, itemId),
          eq(inventoryBatches.branchId, branchId),
          eq(inventoryBatches.status, 'AVAILABLE')
        )
      );
    return Number(result[0]?.total ?? 0); // sum() SQL devuelve string
  }

  private static async getAvgDailyConsumption(itemId: string, branchId: string): Promise<number> {
    const kg = await db.query.inventoryKnowledgeGraph.findFirst({
      where: and(
        eq(inventoryKnowledgeGraph.itemId, itemId),
        eq(inventoryKnowledgeGraph.branchId, branchId),
      ),
      orderBy: (fields: any, ops: any) => ops.desc(inventoryKnowledgeGraph.computedAt),
    });

    if (kg?.avgDailyConsumption && kg.avgDailyConsumption > 0) {
      return kg.avgDailyConsumption;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await db.select({
      totalUsage: sql<number>`coalesce(sum(abs(${inventoryMovements.quantityChange})), 0)`,
    })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.itemId, itemId),
          eq(inventoryMovements.branchId, branchId),
          eq(inventoryMovements.type, 'USAGE'),
          gte(inventoryMovements.timestamp, thirtyDaysAgo)
        )
      );

    const totalUsage = Number(result[0]?.totalUsage ?? 0); // sum() SQL devuelve string
    return Math.round(totalUsage / 30);
  }
}
