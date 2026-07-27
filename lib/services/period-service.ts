import { db } from "@/lib/db";
import { inventoryPeriods, inventoryItems, inventoryBatches } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

type PeriodStatus = 'OPEN' | 'LOCKED' | 'CLOSED';

export class PeriodService {
  static async getPeriods(companyId: string, branchId?: string) {
    const conditions = [eq(inventoryPeriods.companyId, companyId)];
    if (branchId) conditions.push(eq(inventoryPeriods.branchId, branchId));

    return db.select()
      .from(inventoryPeriods)
      .where(and(...conditions))
      .orderBy(desc(inventoryPeriods.periodStart));
  }

  static async getPeriod(id: string) {
    return db.query.inventoryPeriods.findFirst({
      where: eq(inventoryPeriods.id, id),
    });
  }

  static async getOpenPeriod(branchId: string) {
    return db.query.inventoryPeriods.findFirst({
      where: and(
        eq(inventoryPeriods.branchId, branchId),
        eq(inventoryPeriods.status, 'OPEN'),
      ),
      orderBy: desc(inventoryPeriods.periodStart),
    });
  }

  static async createPeriod(data: {
    companyId: string;
    branchId: string;
    periodStart: Date;
    periodEnd: Date;
    notes?: string;
  }) {
    // Check for overlapping open periods
    const existing = await this.getOpenPeriod(data.branchId);
    if (existing) {
      throw new Error(`Ya existe un período abierto (${existing.periodStart.toISOString().split('T')[0]} - ${existing.periodEnd.toISOString().split('T')[0]}). Ciérralo antes de crear uno nuevo.`);
    }

    const [period] = await db.insert(inventoryPeriods).values({
      companyId: data.companyId,
      branchId: data.branchId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: 'OPEN',
      notes: data.notes || null,
    }).returning();

    return period;
  }

  static async closePeriod(id: string, closedBy: string, notes?: string) {
    const period = await this.getPeriod(id);
    if (!period) throw new Error("Period not found");
    if (period.status === 'CLOSED') throw new Error("Period is already closed");

    const [closed] = await db.update(inventoryPeriods)
      .set({
        status: 'CLOSED',
        closedBy,
        closedAt: new Date(),
        notes: notes || null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryPeriods.id, id))
      .returning();

    return closed;
  }

  static async getClosingReport(periodId: string, companyId: string, branchId: string) {
    const period = await this.getPeriod(periodId);
    if (!period) throw new Error("Period not found");

    // Get final stock snapshot for all items in this branch
    const stockSnapshot = await db.select({
      itemId: inventoryBatches.itemId,
      itemName: inventoryItems.name,
      itemSku: inventoryItems.sku,
      itemUnit: inventoryItems.unit,
      totalQuantity: sql<number>`sum(${inventoryBatches.currentQuantity})`,
      totalValue: sql<number>`sum(${inventoryBatches.currentQuantity} * ${inventoryBatches.unitCost})`,
      batchCount: sql<number>`count(${inventoryBatches.id})`,
    })
      .from(inventoryBatches)
      .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
      .where(
        and(
          eq(inventoryBatches.branchId, branchId),
          eq(inventoryBatches.status, 'AVAILABLE'),
        )
      )
      .groupBy(inventoryBatches.itemId, inventoryItems.name, inventoryItems.sku, inventoryItems.unit);

    const totalValue = stockSnapshot.reduce((s, r) => s + Number(r.totalValue || 0), 0);
    const totalItems = stockSnapshot.length;

    return {
      period,
      stockSnapshot,
      summary: {
        totalItems,
        totalValue,
        totalQuantity: stockSnapshot.reduce((s, r) => s + Number(r.totalQuantity || 0), 0),
      },
    };
  }
}
