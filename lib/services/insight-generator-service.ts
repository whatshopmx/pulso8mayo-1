import { db } from "@/lib/db";
import {
  inventoryKnowledgeGraph, inventoryItems, inventoryAlerts,
  companies, branches, users,
} from "@/lib/db/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

export interface Insight {
  type: 'FOOD_COST_CHANGE' | 'WASTE_SPIKE' | 'PRICE_INCREASE' | 'STOCKOUT_RISK' | 'CONSUMPTION_TREND';
  severity: 'INFO' | 'MEDIA' | 'ALTA';
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

export class InsightGeneratorService {
  static async generateForCompany(companyId: string): Promise<Insight[]> {
    const insights: Insight[] = [];

    const companyBranches = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    for (const branch of companyBranches) {
      const branchInsights = await this.generateForBranch(companyId, branch.id, branch.name);
      insights.push(...branchInsights);
    }

    return insights;
  }

  static async generateForBranch(companyId: string, branchId: string, branchName: string): Promise<Insight[]> {
    const insights: Insight[] = [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeAlerts = await db
      .select()
      .from(inventoryAlerts)
      .where(and(
        eq(inventoryAlerts.branchId, branchId),
        eq(inventoryAlerts.status, 'ACTIVE'),
        gte(inventoryAlerts.createdAt, thirtyDaysAgo),
      ));

    const highSeverityAlerts = activeAlerts.filter(a => a.severity === 'ALTA');
    if (highSeverityAlerts.length > 3) {
      insights.push({
        type: 'STOCKOUT_RISK',
        severity: 'ALTA',
        title: `Múltiples alertas críticas en ${branchName}`,
        message: `${highSeverityAlerts.length} alertas de alta severidad activas. Revisa el dashboard de alertas.`,
        metadata: { branchId, alertCount: highSeverityAlerts.length },
      });
    }

    const kgEntries = await db
      .select({
        itemId: inventoryKnowledgeGraph.itemId,
        itemName: inventoryItems.name,
        consumptionTrend: inventoryKnowledgeGraph.consumptionTrend,
        avgWastePercent: inventoryKnowledgeGraph.avgWastePercent,
        totalWasteLoss: inventoryKnowledgeGraph.totalWasteLoss,
        avgDailyConsumption: inventoryKnowledgeGraph.avgDailyConsumption,
      })
      .from(inventoryKnowledgeGraph)
      .innerJoin(inventoryItems, eq(inventoryKnowledgeGraph.itemId, inventoryItems.id))
      .where(and(
        eq(inventoryKnowledgeGraph.companyId, companyId),
        eq(inventoryKnowledgeGraph.branchId, branchId),
      ));

    const wasteSpikes = kgEntries
      .filter(i => i.avgWastePercent != null && i.avgWastePercent > 2000)
      .slice(0, 5);

    if (wasteSpikes.length > 0) {
      const topWaste = wasteSpikes[0];
      insights.push({
        type: 'WASTE_SPIKE',
        severity: wasteSpikes.length > 3 ? 'ALTA' : 'MEDIA',
        title: `Merma elevada en ${branchName}`,
        message: `${wasteSpikes.length} items con merma >20%. ${topWaste.itemName}: ${(topWaste.avgWastePercent! / 100).toFixed(1)}%. Pérdida total: $${(kgEntries.reduce((s, i) => s + (i.totalWasteLoss ?? 0), 0) / 100).toFixed(2)}.`,
        metadata: {
          branchId,
          topWasteItem: topWaste.itemName,
          wasteItems: wasteSpikes.map(i => i.itemName),
        },
      });
    }

    const consumptionDown = kgEntries
      .filter(i => i.consumptionTrend != null && i.consumptionTrend < -30)
      .slice(0, 5);

    if (consumptionDown.length > 0) {
      insights.push({
        type: 'CONSUMPTION_TREND',
        severity: 'INFO',
        title: `Caída de consumo en ${branchName}`,
        message: `${consumptionDown.length} items con caída de consumo >30%. ${consumptionDown[0].itemName}: ${consumptionDown[0].consumptionTrend}%.`,
        metadata: {
          branchId,
          items: consumptionDown.map(i => ({ name: i.itemName, trend: i.consumptionTrend })),
        },
      });
    }

    const consumptionUp = kgEntries
      .filter(i => i.consumptionTrend != null && i.consumptionTrend > 50)
      .slice(0, 3);

    if (consumptionUp.length > 0) {
      insights.push({
        type: 'CONSUMPTION_TREND',
        severity: 'MEDIA',
        title: `Aumento de consumo en ${branchName}`,
        message: `${consumptionUp.length} items con aumento de consumo >50%. ${consumptionUp[0].itemName}: +${consumptionUp[0].consumptionTrend}%. Verificar stock suficiente.`,
        metadata: {
          branchId,
          items: consumptionUp.map(i => ({ name: i.itemName, trend: i.consumptionTrend })),
        },
      });
    }

    return insights;
  }

  static async notifyInsights(companyId: string, insights: Insight[]): Promise<void> {
    if (insights.length === 0) return;

    const companyAdmins = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(
        eq(users.companyId, companyId),
        sql`${users.role} IN ('ADMIN', 'OWNER')`,
      ));

    const summary = insights
      .map(i => `• ${i.title}: ${i.message}`)
      .join('\n');

    for (const admin of companyAdmins) {
      await NotificationDispatcher.sendNotification({
        userId: admin.id,
        title: `📊 Pulso Insights - ${insights.length} novedades`,
        message: `Resumen semanal de inventario:\n\n${summary}`,
        type: 'info',
        eventType: 'stock_alert',
        actionUrl: '/dashboard/inventory/intelligence',
        metadata: {
          insightCount: insights.length,
          companyId,
        },
      });
    }
  }
}
