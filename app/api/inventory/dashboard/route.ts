import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, inventoryAlerts, inventoryWaste, invoices } from "@/lib/db/schema";
import { eq, and, sql, desc, lte, gte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'read')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    if (!tenant.id) {
      return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || tenant.branchId;

    const totalProducts = await db.select({ count: sql<number>`count(*)` })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.companyId, tenant.id),
        eq(inventoryItems.active, true)
      ))
      .then(r => r[0]?.count || 0);

    const activeAlertsCount = branchId ? await db.select({ count: sql<number>`count(*)` })
      .from(inventoryAlerts)
      .where(and(
        eq(inventoryAlerts.companyId, tenant.id),
        eq(inventoryAlerts.branchId, branchId),
        eq(inventoryAlerts.status, 'ACTIVE')
      ))
      .then(r => r[0]?.count || 0) : 0;

    const totalStockValue = branchId ? await db.select({
      value: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity} * ${inventoryBatches.unitCost}), 0)`
    })
      .from(inventoryBatches)
      .where(and(
        eq(inventoryBatches.branchId, branchId),
        eq(inventoryBatches.status, 'AVAILABLE')
      ))
      .then(r => r[0]?.value || 0) : 0;

    const branchesWithStock = branchId ? await db.select({
      branchId: inventoryBatches.branchId,
    })
      .from(inventoryBatches)
      .groupBy(inventoryBatches.branchId)
      .then(r => r.length) : 0;

    const stockByCategory = await db.select({
      category: inventoryItems.category,
      count: sql<number>`count(*)`,
    })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.companyId, tenant.id),
        eq(inventoryItems.active, true),
      ))
      .groupBy(inventoryItems.category)
      .orderBy(inventoryItems.category);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentMovements = branchId ? await db.select({
      date: sql<string>`date_trunc('day', ${inventoryMovements.timestamp})::text`,
      type: inventoryMovements.type,
      count: sql<number>`count(*)`,
    })
      .from(inventoryMovements)
      .where(and(
        eq(inventoryMovements.branchId, branchId),
        gte(inventoryMovements.timestamp, sevenDaysAgo)
      ))
      .groupBy(sql`date_trunc('day', ${inventoryMovements.timestamp})`, inventoryMovements.type)
      .orderBy(sql`date_trunc('day', ${inventoryMovements.timestamp})`) : [];

    const topLowStock = branchId ? await db.select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      minLevel: inventoryItems.minLevel,
      unit: inventoryItems.unit,
      totalStock: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`,
    })
      .from(inventoryItems)
      .leftJoin(inventoryBatches, eq(inventoryItems.id, inventoryBatches.itemId))
      .where(and(
        eq(inventoryItems.companyId, tenant.id),
        eq(inventoryItems.active, true),
        eq(inventoryBatches.branchId, branchId),
        eq(inventoryBatches.status, 'AVAILABLE')
      ))
      .groupBy(inventoryItems.id, inventoryItems.name, inventoryItems.minLevel, inventoryItems.unit)
      .having(sql`coalesce(sum(${inventoryBatches.currentQuantity}), 0) < ${inventoryItems.minLevel}`)
      .orderBy(sql`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`)
      .limit(5) : [];

    const threeWayMatchRate = await db.select({
      total: sql<number>`count(*)`,
      matched: sql<number>`sum(case when ${invoices.receivingReportId} is not null then 1 else 0 end)`,
    })
      .from(invoices)
      .where(and(
        eq(invoices.companyId, tenant.id)
      ))
      .then(r => {
        const row = r[0];
        return row && row.total > 0 ? Math.round((row.matched / row.total) * 100 * 10) / 10 : null;
      });

    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    const wasteLossTotal = branchId ? await db.select({
      total: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
    })
      .from(inventoryWaste)
      .where(and(
        eq(inventoryWaste.companyId, tenant.id),
        eq(inventoryWaste.branchId, branchId),
        gte(inventoryWaste.recordedAt, currentMonthStart)
      ))
      .then(r => r[0]?.total || 0) : 0;

    const wasteLossRatio = totalStockValue > 0 ? Math.round((wasteLossTotal / totalStockValue) * 100 * 10) / 10 : null;

    const topExpiring = branchId ? await db.select({
      id: inventoryBatches.id,
      itemId: inventoryBatches.itemId,
      itemName: inventoryItems.name,
      lotNumber: inventoryBatches.lotNumber,
      expirationDate: inventoryBatches.expirationDate,
      currentQuantity: inventoryBatches.currentQuantity,
      unit: inventoryItems.unit,
    })
      .from(inventoryBatches)
      .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
      .where(and(
        eq(inventoryBatches.branchId, branchId),
        eq(inventoryBatches.status, 'AVAILABLE'),
        sql`${inventoryBatches.expirationDate} IS NOT NULL`,
        sql`${inventoryBatches.expirationDate} >= now()`
      ))
      .orderBy(inventoryBatches.expirationDate)
      .limit(5) : [];

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      totalProducts,
      activeAlertsCount,
      totalStockValue,
      branchesWithStock,
      threeWayMatchRate,
      wasteLossRatio,
      stockByCategory,
      recentMovements,
      topLowStock,
      topExpiring,
    });
  } catch (error) {
    console.error("Failed to fetch dashboard data", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
