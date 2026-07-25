import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { PurchaseOrderService } from "@/lib/services/purchase-order-service";
import { hasPermission } from "@/lib/permissions";

const priceCheckSchema = z.object({
  supplierId: z.string().uuid(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    unitCost: z.number().min(0), // unitCost in cents
  })),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'read')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    const body = await req.json();
    const { supplierId, items } = priceCheckSchema.parse(body);

    const alerts = [];

    for (const item of items) {
      const avgCost = await PurchaseOrderService.getHistoricalAverageCost(
        tenant.id!,
        supplierId,
        item.itemId,
        90 // 90 days average
      );

      if (avgCost !== null && avgCost > 0) {
        const increasePercentage = ((item.unitCost - avgCost) / avgCost) * 100;
        alerts.push({
          itemId: item.itemId,
          unitCost: item.unitCost,
          avgCost,
          increasePercentage: Math.round(increasePercentage * 100) / 100,
          exceedsThreshold: increasePercentage > 10, // exceeds 10% threshold
        });
      } else {
        // No historical price data or fallback price found
        alerts.push({
          itemId: item.itemId,
          unitCost: item.unitCost,
          avgCost: null,
          increasePercentage: 0,
          exceedsThreshold: false,
        });
      }
    }

    return NextResponse.json({ alerts });
  } catch (error: unknown) {
    console.error("Failed to perform price check", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Datos inválidos", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno del servidor" },
      { status: 500 }
    );
  }
}
