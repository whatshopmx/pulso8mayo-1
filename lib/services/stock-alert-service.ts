import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, users, notificationPreferences, suppliers, inventoryAlerts } from "@/lib/db/schema";
import { eq, and, sql, sum } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

export interface StockAlert {
    itemId: string;
    itemName: string;
    currentStock: number;
    minLevel: number;
    branchId: string;
    branchName?: string;
    severity: "BAJA" | "MEDIA" | "ALTA" | "CRITICA";
    type: "LOW_STOCK" | "OUT_OF_STOCK" | "EXPIRING_SOON" | "EXPIRED" | "PRICE_INCREASE";
    detectedAt?: Date;
}

export interface InventoryAlertRecord {
    id: string;
    type: string;
    severity: string;
    itemId: string;
    branchId: string;
    status: 'ACTIVE' | 'VIEWED' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED';
    detectedAt: Date;
    viewedAt?: Date;
    resolvedAt?: Date;
    resolvedBy?: string;
    notes?: string;
}

export class StockAlertService {
    /**
     * Check stock levels and generate alerts for items below minimum
     */
    static async checkStockLevels(branchId?: string): Promise<StockAlert[]> {
        try {
            // Build query to get current stock per item
            const stockQuery = db.select({
                itemId: inventoryBatches.itemId,
                branchId: inventoryBatches.branchId,
                currentStock: sum(inventoryBatches.currentQuantity).as("current_stock")
            })
                .from(inventoryBatches)
                .where(
                    branchId
                        ? eq(inventoryBatches.branchId, branchId)
                        : undefined
                )
                .groupBy(inventoryBatches.itemId, inventoryBatches.branchId);

            const stockLevels = await stockQuery;

            const alerts: StockAlert[] = [];

            for (const stock of stockLevels) {
                if (!stock.itemId) continue;

                // Get item details
                const item = await db.query.inventoryItems.findFirst({
                    where: eq(inventoryItems.id, stock.itemId)
                });

                if (!item || !item.minLevel) continue;

                const currentStock = parseInt(stock.currentStock?.toString() || "0");
                const minLevel = item.minLevel;

                if (currentStock <= minLevel) {
                    // Determine severity
                    let severity: StockAlert["severity"] = "BAJA";
                    if (currentStock === 0) {
                        severity = "CRITICA";
                    } else if (currentStock <= minLevel / 2) {
                        severity = "ALTA";
                    } else if (currentStock <= minLevel * 0.75) {
                        severity = "MEDIA";
                    }

                    alerts.push({
                        itemId: item.id,
                        itemName: item.name,
                        currentStock,
                        minLevel,
                        branchId: stock.branchId!,
                        severity,
                        type: "LOW_STOCK"
                    });
                }
            }

            return alerts;

        } catch (error) {
            console.error("[StockAlert] Error checking stock levels:", error);
            return [];
        }
    }

    /**
     * Send alerts to relevant users (managers, admins)
     */
    static async sendAlerts(alerts: StockAlert[], companyId: string): Promise<{
        sent: number;
        failed: number;
    }> {
        let sent = 0;
        let failed = 0;

        try {
            // Get users with manager/admin roles in the company
            const managers = await db.query.users.findMany({
                where: and(
                    eq(users.companyId, companyId),
                    sql`${users.role} IN ('ADMIN', 'GERENTE', 'SUPERVISOR')`
                )
            });

            for (const alert of alerts) {
                // Persist alert to database
                try {
                    await db.insert(inventoryAlerts).values({
                        companyId,
                        branchId: alert.branchId,
                        itemId: alert.itemId,
                        type: alert.currentStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
                        severity: alert.severity,
                        currentStock: alert.currentStock,
                        minLevel: alert.minLevel,
                        status: 'ACTIVE',
                    });
                } catch (error) {
                    console.error(`[StockAlert] Failed to persist alert:`, error);
                }

                // Send notifications to each manager
                for (const manager of managers) {
                    try {
                        // Use notification dispatcher for better routing
                        await NotificationDispatcher.sendInventoryAlert({
                            userId: manager.id,
                            eventType: 'inventory_alert',
                            data: {
                                itemName: alert.itemName,
                                currentStock: alert.currentStock,
                                minLevel: alert.minLevel,
                                severity: alert.severity,
                                branchId: alert.branchId,
                            }
                        });
                        sent++;
                    } catch (error) {
                        console.error(`[StockAlert] Failed to notify ${manager.id}:`, error);
                        failed++;
                    }
                }
            }

            return { sent, failed };

        } catch (error) {
            console.error("[StockAlert] Error sending alerts:", error);
            return { sent: 0, failed: alerts.length };
        }
    }

    /**
     * Get low stock items for a branch
     */
    static async getLowStockItems(branchId: string, limit: number = 50) {
        try {
            // Get batches with their items
            const batches = await db.select({
                itemId: inventoryBatches.itemId,
                itemName: inventoryItems.name,
                sku: inventoryItems.sku,
                category: inventoryItems.category,
                currentStock: inventoryBatches.currentQuantity,
                minLevel: inventoryItems.minLevel,
                maxLevel: inventoryItems.maxLevel,
                unit: inventoryItems.unit,
                lastCost: inventoryItems.lastCost,
                supplierId: inventoryItems.supplierId,
                supplierName: suppliers.name,
                expirationDate: inventoryBatches.expirationDate,
                status: inventoryBatches.status
            })
                .from(inventoryBatches)
                .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
                .leftJoin(suppliers, eq(inventoryItems.supplierId, suppliers.id))
                .where(
                    and(
                        eq(inventoryBatches.branchId, branchId),
                        eq(inventoryBatches.status, "AVAILABLE"),
                        sql`${inventoryBatches.currentQuantity} <= ${inventoryItems.minLevel}`
                    )
                )
                .orderBy(inventoryBatches.currentQuantity)
                .limit(limit);

            return batches;

        } catch (error) {
            console.error("[StockAlert] Error getting low stock items:", error);
            return [];
        }
    }

    /**
     * Get out of stock items
     */
    static async getOutOfStockItems(branchId: string) {
        try {
            const batches = await db.select({
                itemId: inventoryBatches.itemId,
                itemName: inventoryItems.name,
                sku: inventoryItems.sku,
                category: inventoryItems.category,
                unit: inventoryItems.unit,
                lastCost: inventoryItems.lastCost,
                supplierId: inventoryItems.supplierId,
                supplierName: suppliers.name
            })
                .from(inventoryBatches)
                .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
                .leftJoin(suppliers, eq(inventoryItems.supplierId, suppliers.id))
                .where(
                    and(
                        eq(inventoryBatches.branchId, branchId),
                        eq(inventoryBatches.currentQuantity, 0),
                        eq(inventoryBatches.status, "AVAILABLE")
                    )
                );

            return batches;

        } catch (error) {
            console.error("[StockAlert] Error getting out of stock items:", error);
            return [];
        }
    }

    /**
     * Get expiring soon items
     */
    static async getExpiringSoonItems(branchId: string, days: number = 7) {
        try {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + days);

            const batches = await db.select({
                itemId: inventoryBatches.itemId,
                itemName: inventoryItems.name,
                currentStock: inventoryBatches.currentQuantity,
                unit: inventoryItems.unit,
                expirationDate: inventoryBatches.expirationDate,
                lotNumber: inventoryBatches.lotNumber,
                status: inventoryBatches.status
            })
                .from(inventoryBatches)
                .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
                .where(
                    and(
                        eq(inventoryBatches.branchId, branchId),
                        eq(inventoryBatches.status, "AVAILABLE"),
                        sql`${inventoryBatches.expirationDate} <= ${futureDate}`,
                        sql`${inventoryBatches.expirationDate} >= NOW()`
                    )
                )
                .orderBy(inventoryBatches.expirationDate);

            return batches;

        } catch (error) {
            console.error("[StockAlert] Error getting expiring items:", error);
            return [];
        }
    }

    /**
     * Get expired items
     */
    static async getExpiredItems(branchId: string) {
        try {
            const batches = await db.select({
                itemId: inventoryBatches.itemId,
                itemName: inventoryItems.name,
                currentStock: inventoryBatches.currentQuantity,
                unit: inventoryItems.unit,
                expirationDate: inventoryBatches.expirationDate,
                lotNumber: inventoryBatches.lotNumber,
                status: inventoryBatches.status
            })
                .from(inventoryBatches)
                .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
                .where(
                    and(
                        eq(inventoryBatches.branchId, branchId),
                        eq(inventoryBatches.status, "AVAILABLE"),
                        sql`${inventoryBatches.expirationDate} < NOW()`
                    )
                )
                .orderBy(inventoryBatches.expirationDate);

            return batches;

        } catch (error) {
            console.error("[StockAlert] Error getting expired items:", error);
            return [];
        }
    }

    /**
     * Check for price increase compared to 30-day moving average and trigger alert if increase >= 10%
     */
    static async checkPriceIncrease(
        itemId: string,
        newPriceCents: number,
        supplierId: string | null,
        companyId: string,
        branchId: string | null,
        userId?: string
    ): Promise<void> {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Fetch recent batch unit costs in the last 30 days for this item
            const recentBatches = await db.select({
                unitCost: inventoryBatches.unitCost
            })
            .from(inventoryBatches)
            .where(
                and(
                    eq(inventoryBatches.itemId, itemId),
                    sql`${inventoryBatches.receivedAt} >= ${thirtyDaysAgo}`,
                    sql`${inventoryBatches.unitCost} IS NOT NULL`
                )
            );

            const prices = recentBatches
                .map(b => b.unitCost)
                .filter((c): c is number => c !== null && c > 0);

            let avgCost = 0;
            if (prices.length > 0) {
                avgCost = prices.reduce((sum, p) => sum + p, 0) / prices.length;
            } else {
                // Fallback to item's lastCost before this check
                const item = await db.query.inventoryItems.findFirst({
                    where: eq(inventoryItems.id, itemId)
                });
                if (!item || !item.lastCost) return;
                avgCost = item.lastCost;
            }

            // Trigger alert if new price is >= 10% higher than average
            if (avgCost > 0 && newPriceCents >= avgCost * 1.10) {
                const pct = Math.round(((newPriceCents - avgCost) / avgCost) * 100);

                const item = await db.query.inventoryItems.findFirst({
                    where: eq(inventoryItems.id, itemId)
                });
                const itemName = item?.name || "Insumo";

                // Persist the alert
                await db.insert(inventoryAlerts).values({
                    companyId,
                    branchId: branchId || undefined,
                    itemId,
                    type: 'PRICE_INCREASE',
                    severity: pct >= 25 ? 'ALTA' : 'MEDIA',
                    currentStock: 0,
                    minLevel: 0,
                    status: 'ACTIVE',
                    notes: `Alza de costo del ${pct}% detectada. Costo anterior prom: $${(avgCost / 100).toFixed(2)}, nuevo costo: $${(newPriceCents / 100).toFixed(2)}`,
                });

                // Find managers to notify
                const managers = await db.query.users.findMany({
                    where: and(
                        eq(users.companyId, companyId),
                        sql`${users.role} IN ('ADMIN', 'GERENTE')`
                    )
                });

                for (const manager of managers) {
                    try {
                        await NotificationDispatcher.sendInventoryAlert({
                            userId: manager.id,
                            eventType: 'inventory_alert',
                            data: {
                                itemName,
                                currentStock: 0,
                                minLevel: 0,
                                severity: pct >= 25 ? 'ALTA' : 'MEDIA',
                                branchId: branchId || undefined,
                                message: `Alza de precio en ${itemName}: +${pct}% ($${(newPriceCents / 100).toFixed(2)} vs prom $${(avgCost / 100).toFixed(2)})`
                            }
                        });
                    } catch (err) {
                        console.error(`[StockAlert] Failed to notify manager ${manager.id} of price increase:`, err);
                    }
                }
            }
        } catch (error) {
            console.error("[StockAlert] Error checking price increase:", error);
        }
    }
}
