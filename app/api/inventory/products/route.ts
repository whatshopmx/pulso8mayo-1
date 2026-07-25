import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryPriceHistory } from "@/lib/db/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";

const createProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  minLevel: z.number().optional(),
  maxLevel: z.number().optional(),
  unit: z.string().default('UNIT'),
  supplierId: z.string().uuid().optional(),
  lastCost: z.number().optional(),
  allergenInfo: z.string().optional(),
  storageRequirements: z.string().optional(),
  typicalShelfLifeDays: z.number().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    // Permission check
    if (!hasPermission(user.role, 'inventory', 'read')) {
      return NextResponse.json(
        { error: "No tienes permisos para ver el inventario" },
        { status: 403 }
      );
    }

    // Strict Tenant Check: Filter by user's company
    if (!tenant.id) {
      return NextResponse.json(
        { error: "Usuario no asignado a una empresa" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || tenant.branchId;
    const category = searchParams.get("category");

    const whereConditions = [eq(inventoryItems.companyId, tenant.id)];
    if (category) {
      whereConditions.push(eq(inventoryItems.category, category));
    }

    const items = await db
      .select()
      .from(inventoryItems)
      .where(and(...whereConditions))
      .orderBy(desc(inventoryItems.createdAt));

    // If branchId is provided, get stock levels for that branch
    let itemsWithStock = items;
    if (branchId) {
      const itemIds = items.map(item => item.id);
      
      if (itemIds.length > 0) {
        // Get stock levels for this branch
        const stockLevels = await db.select({
          itemId: inventoryBatches.itemId,
          totalStock: sql<number>`sum(${inventoryBatches.currentQuantity})`,
        })
        .from(inventoryBatches)
        .where(
          and(
            eq(inventoryBatches.branchId, branchId),
            inArray(inventoryBatches.itemId, itemIds),
            eq(inventoryBatches.status, 'AVAILABLE')
          )
        )
        .groupBy(inventoryBatches.itemId);

        // Map stock to items
        const stockMap = new Map(stockLevels.map(s => [s.itemId, s.totalStock]));
        
        itemsWithStock = items.map(item => ({
          ...item,
          currentStock: stockMap.get(item.id) || 0,
          isLowStock: (stockMap.get(item.id) || 0) < (item.minLevel || 0),
        }));
      }
    }

    return NextResponse.json(itemsWithStock);
  } catch (error) {
    console.error("Failed to fetch products", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuth();

    // Permission check
    if (!hasPermission(user.role, 'inventory', 'create')) {
      return NextResponse.json(
        { error: "No tienes permisos para crear productos" },
        { status: 403 }
      );
    }

    // Strict Tenant Check: Must have company assigned
    if (!user.companyId) {
      return NextResponse.json(
        { error: "Usuario no asignado a una empresa" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const data = createProductSchema.parse(body);

    const newItem = await db.insert(inventoryItems).values({
      companyId: user.companyId,
      ...data,
    }).returning();

    if (data.lastCost) {
      await db.insert(inventoryPriceHistory).values({
        itemId: newItem[0].id,
        newCost: data.lastCost,
        changedBy: user.id,
      });
    }

    return NextResponse.json(newItem[0]);
  } catch (error) {
    console.error("Failed to create product", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
