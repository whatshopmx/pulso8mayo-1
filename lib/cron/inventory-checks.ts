import { createChildLogger } from '@/lib/logger';
import { db } from '@/lib/db';
import { companies, branches, inventoryBatches, inventoryItems, inventoryAlerts } from '@/lib/db/schema';
import { eq, and, sql, lte, gte } from 'drizzle-orm';
import { StockAlertService } from '@/lib/services/stock-alert-service';

const logger = createChildLogger('cron:inventory');

export async function checkInventoryAlerts() {
  try {
    const activeCompanies = await db.query.companies.findMany({
      where: eq(companies.billingStatus, 'ACTIVE'),
    });

    let totalAlerts = 0;
    let totalSent = 0;
    let totalFailed = 0;
    let checkedBranches = 0;

    for (const company of activeCompanies) {
      const companyBranches = await db.query.branches.findMany({
        where: and(
          eq(branches.companyId, company.id),
          eq(branches.active, true),
        ),
      });

      const allAlerts: Awaited<ReturnType<typeof StockAlertService.checkStockLevels>> = [];

      for (const branch of companyBranches) {
        checkedBranches++;

        const lowStockAlerts = await StockAlertService.checkStockLevels(branch.id);
        allAlerts.push(...lowStockAlerts);

        await checkExpiringBatches(branch.id, company.id, allAlerts);
      }

      if (allAlerts.length > 0) {
        const result = await StockAlertService.sendAlerts(allAlerts, company.id);
        totalAlerts += allAlerts.length;
        totalSent += result.sent;
        totalFailed += result.failed;
      }
    }

    logger.info(
      { totalAlerts, totalSent, totalFailed, checkedBranches },
      'Inventory checks completed',
    );

    return {
      success: true,
      status: 'completed',
      checkedBranches,
      totalAlerts,
      notificationsSent: totalSent,
      notificationsFailed: totalFailed,
    };
  } catch (error) {
    logger.error({ error }, 'Inventory checks job failed');
    return { success: false, error: String(error) };
  }
}

async function checkExpiringBatches(
  branchId: string,
  companyId: string,
  alerts: Awaited<ReturnType<typeof StockAlertService.checkStockLevels>>,
) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);

  const expiringBatches = await db.select({
    batchId: inventoryBatches.id,
    itemId: inventoryBatches.itemId,
    itemName: inventoryItems.name,
    currentQuantity: inventoryBatches.currentQuantity,
    minLevel: inventoryItems.minLevel,
    expirationDate: inventoryBatches.expirationDate,
  })
    .from(inventoryBatches)
    .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
    .where(
      and(
        eq(inventoryBatches.branchId, branchId),
        eq(inventoryBatches.status, 'AVAILABLE'),
        sql`${inventoryBatches.expirationDate} IS NOT NULL`,
        lte(inventoryBatches.expirationDate, futureDate),
        gte(inventoryBatches.expirationDate, new Date()),
      ),
    );

  for (const batch of expiringBatches) {
    if (!batch.itemName) continue;

    const existing = await db.query.inventoryAlerts.findFirst({
      where: and(
        eq(inventoryAlerts.companyId, companyId),
        eq(inventoryAlerts.branchId, branchId),
        eq(inventoryAlerts.itemId, batch.itemId!),
        eq(inventoryAlerts.type, 'EXPIRING_SOON'),
        eq(inventoryAlerts.status, 'ACTIVE'),
      ),
    });

    if (existing) continue;

    const daysUntilExpiry = batch.expirationDate
      ? Math.ceil((batch.expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 7;

    const severity = daysUntilExpiry <= 2 ? 'ALTA' : daysUntilExpiry <= 5 ? 'MEDIA' : 'BAJA';

    alerts.push({
      itemId: batch.itemId!,
      itemName: batch.itemName,
      currentStock: Number(batch.currentQuantity),
      minLevel: batch.minLevel ?? 0,
      branchId,
      severity,
      type: 'EXPIRING_SOON',
    });
  }
}
