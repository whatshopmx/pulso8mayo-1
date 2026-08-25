import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryPriceHistory } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  minLevel: z.number().optional(),
  maxLevel: z.number().optional(),
  storageArea: z.string().optional(),
  allergenInfo: z.string().optional(),
  storageRequirements: z.string().optional(),
  // Tipo de almacenamiento del ítem (loteprod §5.2): dirige la validación de
  // temperatura en recepción. Ausente = sin clasificar (regla legacy > 4°C).
  storageType: z.enum(['DRY', 'REFRIGERATED', 'FROZEN']).optional(),
  typicalShelfLifeDays: z.number().optional(),
  supplierId: z.string().uuid().optional(),
  lastCost: z.number().optional(),
  active: z.boolean().optional(),
  brand: z.string().optional(),
  presentation: z.string().optional(),
  standardCost: z.number().optional(),
  // Fase 4: marca de SKU de alto valor (conteo semanal priorizado).
  isHighValue: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'read')) {
      return NextResponse.json(
        { error: "No tienes permisos para ver el inventario" },
        { status: 403 }
      );
    }

    if (!tenant.id) {
      return NextResponse.json(
        { error: "Usuario no asignado a una empresa" },
        { status: 403 }
      );
    }

    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, id),
        eq(inventoryItems.companyId, tenant.id)
      ),
    });

    if (!item) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    const stockResult = await db.select({
      totalStock: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`,
    })
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.itemId, id),
          eq(inventoryBatches.status, 'AVAILABLE')
        )
      );

    const totalStock = stockResult[0]?.totalStock || 0;

    return NextResponse.json({ ...item, totalStock });
  } catch (error) {
    console.error("Failed to fetch product", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'update')) {
      return NextResponse.json(
        { error: "No tienes permisos para modificar productos" },
        { status: 403 }
      );
    }

    if (!user.companyId) {
      return NextResponse.json(
        { error: "Usuario no asignado a una empresa" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const data = updateProductSchema.parse(body);

    // Fase 4: si se enciende isHighValue, validar el límite de 30 SKUs.
    if (data.isHighValue === true) {
      const currentItem = await db.query.inventoryItems.findFirst({
        where: and(
          eq(inventoryItems.id, id),
          eq(inventoryItems.companyId, user.companyId)
        ),
      });
      if (currentItem && !currentItem.isHighValue) {
        const rows = await db
          .select({ n: sql<number>`count(*)` })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.companyId, user.companyId),
              eq(inventoryItems.isHighValue, true)
            )
          );
        if (Number(rows[0]?.n ?? 0) >= 30) {
          return NextResponse.json(
            {
              error: `Límite de SKUs de alto valor alcanzado (30). Desmarca otro SKU antes de marcar este como alto valor.`,
            },
            { status: 400 }
          );
        }
      }
    }

    if (data.lastCost !== undefined) {
      const currentItem = await db.query.inventoryItems.findFirst({
        where: and(
          eq(inventoryItems.id, id),
          eq(inventoryItems.companyId, user.companyId)
        ),
      });

      if (currentItem && currentItem.lastCost !== data.lastCost) {
        await db.insert(inventoryPriceHistory).values({
          itemId: id,
          previousCost: currentItem.lastCost,
          newCost: data.lastCost,
          supplierId: data.supplierId || currentItem.supplierId,
          changedBy: user.id,
        });
      }
    }

    const [updated] = await db.update(inventoryItems)
      .set({ ...data, updatedAt: new Date() })
      .where(and(
        eq(inventoryItems.id, id),
        eq(inventoryItems.companyId, user.companyId)
      ))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Datos inválidos", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to update product", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'delete')) {
      return NextResponse.json(
        { error: "No tienes permisos para eliminar productos" },
        { status: 403 }
      );
    }

    if (!user.companyId) {
      return NextResponse.json(
        { error: "Usuario no asignado a una empresa" },
        { status: 403 }
      );
    }

    const [deleted] = await db.update(inventoryItems)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(inventoryItems.id, id),
        eq(inventoryItems.companyId, user.companyId)
      ))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "Producto eliminado", id: deleted.id });
  } catch (error) {
    console.error("Failed to delete product", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
