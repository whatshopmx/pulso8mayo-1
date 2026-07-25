import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, branches } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { StockAlertService } from "@/lib/services/stock-alert-service";

export const cronStockCheck = inngest.createFunction(
  {
    id: "cron-stock-check",
    triggers: [{ cron: "0 */6 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("check-stock-levels", async () => {
      const allBranches = await db.select({ id: branches.id, name: branches.name, companyId: branches.companyId }).from(branches);
      const alerts: any[] = [];

      for (const branch of allBranches) {
        const stockLevels = await db
          .select({ itemId: inventoryBatches.itemId, totalStock: sql<number>`sum(${inventoryBatches.currentQuantity})` })
          .from(inventoryBatches)
          .where(and(eq(inventoryBatches.branchId, branch.id), eq(inventoryBatches.status, "AVAILABLE")))
          .groupBy(inventoryBatches.itemId);

        const itemIds = stockLevels.map(s => s.itemId);
        if (itemIds.length === 0) continue;

        const items = await db
          .select({ id: inventoryItems.id, name: inventoryItems.name, sku: inventoryItems.sku, minLevel: inventoryItems.minLevel, unit: inventoryItems.unit, companyId: inventoryItems.companyId })
          .from(inventoryItems)
          .where(inArray(inventoryItems.id, itemIds));

        for (const item of items) {
          const stock = stockLevels.find(s => s.itemId === item.id);
          const currentStock = stock?.totalStock || 0;
          const minLevel = item.minLevel || 0;

          if (currentStock < minLevel) {
            alerts.push({
              branchId: branch.id, branchName: branch.name, companyId: branch.companyId,
              itemId: item.id, itemName: item.name, sku: item.sku,
              currentStock, minLevel, shortage: minLevel - currentStock,
              suggestedReorder: minLevel * 2 - currentStock, unit: item.unit,
            });
          }
        }
      }

      const alertsByCompany = alerts.reduce((acc, alert) => {
        (acc[alert.companyId] = acc[alert.companyId] || []).push(alert);
        return acc;
      }, {} as Record<string, typeof alerts>);

      let notificationsSent = 0;
      let notificationsFailed = 0;

      for (const [companyId, companyAlerts] of Object.entries(alertsByCompany)) {
        const stockAlerts = (companyAlerts as any[]).map((alert: any) => ({
          itemId: alert.itemId, itemName: alert.itemName,
          currentStock: alert.currentStock, minLevel: alert.minLevel,
          branchId: alert.branchId, branchName: alert.branchName,
          severity: alert.currentStock === 0 ? "CRITICA" as const : alert.currentStock < alert.minLevel / 2 ? "ALTA" as const : alert.currentStock < alert.minLevel * 0.75 ? "MEDIA" as const : "BAJA" as const,
          type: alert.currentStock === 0 ? "OUT_OF_STOCK" as const : "LOW_STOCK" as const,
        }));
        const result = await StockAlertService.sendAlerts(stockAlerts, companyId);
        notificationsSent += result.sent;
        notificationsFailed += result.failed;
      }

      return { success: true, branchesChecked: allBranches.length, alertsCount: alerts.length, notificationsSent, notificationsFailed };
    });
  }
);
