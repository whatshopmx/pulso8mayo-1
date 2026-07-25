import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, users } from "@/lib/db/schema";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
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
    const typeParam = searchParams.get("type");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const itemId = searchParams.get("itemId");
    const performedBy = searchParams.get("performedBy");
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const offset = Number(searchParams.get("offset")) || 0;

    const conditions = [eq(inventoryMovements.branchId, branchId)];

    if (typeParam) {
      const types = typeParam.split(",");
      conditions.push(inArray(inventoryMovements.type, types as any));
    }

    if (dateFrom) {
      conditions.push(gte(inventoryMovements.timestamp, new Date(dateFrom)));
    }

    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(inventoryMovements.timestamp, end));
    }

    if (itemId) {
      conditions.push(eq(inventoryMovements.itemId, itemId));
    }

    if (performedBy) {
      conditions.push(eq(inventoryMovements.performedBy, performedBy));
    }

    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(inventoryMovements)
      .where(and(...conditions));

    const movements = await db.select({
      id: inventoryMovements.id,
      branchId: inventoryMovements.branchId,
      itemId: inventoryMovements.itemId,
      batchId: inventoryMovements.batchId,
      type: inventoryMovements.type,
      quantityChange: inventoryMovements.quantityChange,
      reason: inventoryMovements.reason,
      performedBy: inventoryMovements.performedBy,
      timestamp: inventoryMovements.timestamp,
      itemName: inventoryItems.name,
      itemSku: inventoryItems.sku,
      batchNumber: inventoryBatches.lotNumber,
      unitCost: inventoryBatches.unitCost,
    })
      .from(inventoryMovements)
      .leftJoin(inventoryItems, eq(inventoryMovements.itemId, inventoryItems.id))
      .leftJoin(inventoryBatches, eq(inventoryMovements.batchId, inventoryBatches.id))
      .where(and(...conditions))
      .orderBy(desc(inventoryMovements.timestamp))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      movements,
      total: count,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch movements", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
