import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, inventoryAlerts, inventoryKnowledgeGraph, users } from "@/lib/db/schema";
import { eq, and, sql, gte, inArray } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

export class AdvancedAlertService {
  static async checkHighVariance(companyId: string, branchId: string) {
    const kgEntries = await db.select()
      .from(inventoryKnowledgeGraph)
      .where(
        and(
          eq(inventoryKnowledgeGraph.companyId, companyId),
          eq(inventoryKnowledgeGraph.branchId, branchId),
        )
      );

    for (const kg of kgEntries) {
      const volatility = kg.consumptionVolatility ?? 0;
      const avgConsumption = kg.avgDailyConsumption ?? 0;

      if (avgConsumption <= 0 || volatility <= 0) continue;

      const item = await db.query.inventoryItems.findFirst({
        where: eq(inventoryItems.id, kg.itemId),
      });
      if (!item) continue;

      const currentStock = await this.getCurrentStock(kg.itemId, branchId);

      if (volatility > avgConsumption * 2) {
        await this.createAlert({
          companyId,
          branchId,
          itemId: kg.itemId,
          type: 'HIGH_VARIANCE',
          severity: volatility > avgConsumption * 3 ? 'ALTA' : 'MEDIA',
          currentStock,
          minLevel: item.minLevel ?? 0,
          notes: `Consumo volátil: desviación estándar ${volatility} vs promedio ${avgConsumption}`,
        });
      }
    }
  }

  static async checkAnomalousWaste(companyId: string, branchId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const kgEntries = await db.select()
      .from(inventoryKnowledgeGraph)
      .where(
        and(
          eq(inventoryKnowledgeGraph.companyId, companyId),
          eq(inventoryKnowledgeGraph.branchId, branchId),
        )
      );

    for (const kg of kgEntries) {
      const avgWastePct = kg.avgWastePercent ?? 0;
      if (avgWastePct <= 0) continue;

      const recentMovements = await db.select({
        qty: sql<number>`coalesce(sum(abs(${inventoryMovements.quantityChange})), 0)`,
      })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.itemId, kg.itemId),
            eq(inventoryMovements.branchId, branchId),
            eq(inventoryMovements.type, 'WASTE'),
            gte(inventoryMovements.timestamp, thirtyDaysAgo)
          )
        );

      const recentWaste = recentMovements[0]?.qty ?? 0;
      const avgWaste = avgWastePct / 10000;

      const item = await db.query.inventoryItems.findFirst({
        where: eq(inventoryItems.id, kg.itemId),
      });
      if (!item) continue;

      const currentStock = await this.getCurrentStock(kg.itemId, branchId);

      if (recentWaste > avgWaste * 3 && avgWaste > 0) {
        await this.createAlert({
          companyId,
          branchId,
          itemId: kg.itemId,
          type: 'ANOMALOUS_WASTE',
          severity: recentWaste > avgWaste * 5 ? 'ALTA' : 'MEDIA',
          currentStock,
          minLevel: item.minLevel ?? 0,
          notes: `Merma anómala: ${recentWaste} en últimos 30 días vs promedio ${Math.round(avgWaste)}`,
        });
      }
    }
  }

  static async checkYieldDrop(companyId: string, branchId: string) {
    const items = await db.select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.companyId, companyId),
          eq(inventoryItems.active, true),
          sql`${inventoryItems.yieldPercent} IS NOT NULL AND ${inventoryItems.yieldPercent} < 70`
        )
      );

    for (const item of items) {
      const currentStock = await this.getCurrentStock(item.id, branchId);

      await this.createAlert({
        companyId,
        branchId,
        itemId: item.id,
        type: 'YIELD_DROP',
        severity: (item.yieldPercent ?? 100) < 50 ? 'ALTA' : 'MEDIA',
        currentStock,
        minLevel: item.minLevel ?? 0,
        notes: `Rendimiento bajo: ${item.yieldPercent}% (umbral: 70%)`,
      });
    }
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
    return result[0]?.total ?? 0;
  }

  private static async createAlert(params: {
    companyId: string;
    branchId: string;
    itemId: string;
    type: 'HIGH_VARIANCE' | 'ANOMALOUS_WASTE' | 'YIELD_DROP';
    severity: string;
    currentStock: number;
    minLevel: number;
    notes: string;
  }) {
    await db.insert(inventoryAlerts).values({
      companyId: params.companyId,
      branchId: params.branchId,
      itemId: params.itemId,
      type: params.type,
      severity: params.severity,
      currentStock: params.currentStock,
      minLevel: params.minLevel,
      status: 'ACTIVE',
      notes: params.notes,
    });

    const branchManagers = await db.query.users.findMany({
      where: and(
        eq(users.companyId, params.companyId),
        sql`${users.role} IN ('ADMIN', 'GERENTE')`
      ),
    });

    for (const user of branchManagers) {
      await NotificationDispatcher.sendNotification({
        userId: user.id,
        title: `Alerta de inventario: ${params.type}`,
        message: params.notes,
        type: 'warning',
        eventType: 'stock_alert',
        actionUrl: '/dashboard/inventory/alerts',
        metadata: {
          itemName: params.itemId,
          branchId: params.branchId,
        },
      });
    }
  }
}
