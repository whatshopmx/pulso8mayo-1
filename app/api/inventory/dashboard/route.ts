import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, inventoryAlerts, inventoryWaste, invoices, branches } from "@/lib/db/schema";
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

    // Tenant-level rollup: when branchId is absent, scope branch-only tables
    // (inventoryBatches / inventoryMovements have no companyId) via JOIN to
    // branches.companyId. Tables with their own companyId (inventoryAlerts /
    // inventoryWaste) just drop the branch guard.

    const activeAlertsCount = await db.select({ count: sql<number>`count(*)` })
      .from(inventoryAlerts)
      .where(and(
        eq(inventoryAlerts.companyId, tenant.id),
        ...(branchId ? [eq(inventoryAlerts.branchId, branchId)] : []),
        eq(inventoryAlerts.status, 'ACTIVE')
      ))
      .then(r => r[0]?.count || 0);

    const totalStockValue = branchId
      ? await db.select({
          value: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity} * ${inventoryBatches.unitCost}), 0)`
        })
          .from(inventoryBatches)
          .where(and(
            eq(inventoryBatches.branchId, branchId),
            eq(inventoryBatches.status, 'AVAILABLE')
          ))
          .then(r => r[0]?.value || 0)
      : await db.select({
          value: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity} * ${inventoryBatches.unitCost}), 0)`
        })
        .from(inventoryBatches)
        .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
        .where(and(
          eq(branches.companyId, tenant.id),
          eq(inventoryBatches.status, 'AVAILABLE')
        ))
        .then(r => r[0]?.value || 0);

    // Cross-branch signal: distinct branches with available stock, tenant-scoped.
    // Meaningful in both modes (in single-branch mode it tells you whether the
    // selected branch is among those with stock; in all-branches mode it's the
    // "how many of my branches have stock" morning-brief number).
    const branchesWithStock = await db.select({
      branchId: inventoryBatches.branchId,
    })
      .from(inventoryBatches)
      .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
      .where(and(
        eq(branches.companyId, tenant.id),
        eq(inventoryBatches.status, 'AVAILABLE')
      ))
      .groupBy(inventoryBatches.branchId)
      .then(r => r.length);

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

    const recentMovements = branchId
      ? await db.select({
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
        .orderBy(sql`date_trunc('day', ${inventoryMovements.timestamp})`)
      : await db.select({
          date: sql<string>`date_trunc('day', ${inventoryMovements.timestamp})::text`,
          type: inventoryMovements.type,
          count: sql<number>`count(*)`,
        })
        .from(inventoryMovements)
        .innerJoin(branches, eq(inventoryMovements.branchId, branches.id))
        .where(and(
          eq(branches.companyId, tenant.id),
          gte(inventoryMovements.timestamp, sevenDaysAgo)
        ))
        .groupBy(sql`date_trunc('day', ${inventoryMovements.timestamp})`, inventoryMovements.type)
        .orderBy(sql`date_trunc('day', ${inventoryMovements.timestamp})`);

    // Per-item-per-branch so each row is actionable ("which branch needs me").
    // Single-branch mode groups by item (branch fixed); all-branches groups by
    // item + branch and raises the limit so one branch's lows don't crowd others.
    const topLowStock = branchId
      ? await db.select({
          itemId: inventoryItems.id,
          itemName: inventoryItems.name,
          minLevel: inventoryItems.minLevel,
          unit: inventoryItems.unit,
          branchId: inventoryBatches.branchId,
          branchName: branches.name,
          totalStock: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`,
        })
        .from(inventoryItems)
        .leftJoin(inventoryBatches, eq(inventoryItems.id, inventoryBatches.itemId))
        .leftJoin(branches, eq(inventoryBatches.branchId, branches.id))
        .where(and(
          eq(inventoryItems.companyId, tenant.id),
          eq(inventoryItems.active, true),
          eq(inventoryBatches.branchId, branchId),
          eq(inventoryBatches.status, 'AVAILABLE')
        ))
        .groupBy(inventoryItems.id, inventoryItems.name, inventoryItems.minLevel, inventoryItems.unit, inventoryBatches.branchId, branches.name)
        .having(sql`(coalesce(sum(${inventoryBatches.currentQuantity}), 0) < coalesce(${inventoryItems.minLevel}, 0)) or (coalesce(sum(${inventoryBatches.currentQuantity}), 0) = 0)`)
        .orderBy(sql`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`)
        .limit(5)
      : await db.select({
          itemId: inventoryItems.id,
          itemName: inventoryItems.name,
          minLevel: inventoryItems.minLevel,
          unit: inventoryItems.unit,
          branchId: inventoryBatches.branchId,
          branchName: branches.name,
          totalStock: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`,
        })
        .from(inventoryItems)
        .leftJoin(inventoryBatches, eq(inventoryItems.id, inventoryBatches.itemId))
        .leftJoin(branches, eq(inventoryBatches.branchId, branches.id))
        .where(and(
          eq(inventoryItems.companyId, tenant.id),
          eq(inventoryItems.active, true),
          eq(branches.companyId, tenant.id),
          eq(inventoryBatches.status, 'AVAILABLE')
        ))
        .groupBy(inventoryItems.id, inventoryItems.name, inventoryItems.minLevel, inventoryItems.unit, inventoryBatches.branchId, branches.name)
        .having(sql`(coalesce(sum(${inventoryBatches.currentQuantity}), 0) < coalesce(${inventoryItems.minLevel}, 0)) or (coalesce(sum(${inventoryBatches.currentQuantity}), 0) = 0)`)
        .orderBy(sql`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`)
        .limit(10);

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

    const wasteLossTotal = await db.select({
      total: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
    })
      .from(inventoryWaste)
      .where(and(
        eq(inventoryWaste.companyId, tenant.id),
        ...(branchId ? [eq(inventoryWaste.branchId, branchId)] : []),
        gte(inventoryWaste.recordedAt, currentMonthStart)
      ))
      .then(r => r[0]?.total || 0);

    const wasteLossRatio = totalStockValue > 0 ? Math.round((wasteLossTotal / totalStockValue) * 100 * 10) / 10 : null;

    const topExpiring = branchId
      ? await db.select({
          id: inventoryBatches.id,
          itemId: inventoryBatches.itemId,
          itemName: inventoryItems.name,
          lotNumber: inventoryBatches.lotNumber,
          expirationDate: inventoryBatches.expirationDate,
          currentQuantity: inventoryBatches.currentQuantity,
          unit: inventoryItems.unit,
          branchId: inventoryBatches.branchId,
          branchName: branches.name,
        })
        .from(inventoryBatches)
        .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
        .leftJoin(branches, eq(inventoryBatches.branchId, branches.id))
        .where(and(
          eq(inventoryBatches.branchId, branchId),
          eq(inventoryBatches.status, 'AVAILABLE'),
          sql`${inventoryBatches.expirationDate} IS NOT NULL`,
          sql`${inventoryBatches.expirationDate} >= now()`
        ))
        .orderBy(inventoryBatches.expirationDate)
        .limit(5)
      : await db.select({
          id: inventoryBatches.id,
          itemId: inventoryBatches.itemId,
          itemName: inventoryItems.name,
          lotNumber: inventoryBatches.lotNumber,
          expirationDate: inventoryBatches.expirationDate,
          currentQuantity: inventoryBatches.currentQuantity,
          unit: inventoryItems.unit,
          branchId: inventoryBatches.branchId,
          branchName: branches.name,
        })
        .from(inventoryBatches)
        .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
        .leftJoin(branches, eq(inventoryBatches.branchId, branches.id))
        .where(and(
          eq(branches.companyId, tenant.id),
          eq(inventoryBatches.status, 'AVAILABLE'),
          sql`${inventoryBatches.expirationDate} IS NOT NULL`,
          sql`${inventoryBatches.expirationDate} >= now()`
        ))
        .orderBy(inventoryBatches.expirationDate)
        .limit(10);

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
