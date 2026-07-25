import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/tenant-context";
import { PurchaseOrderService } from "@/lib/services/purchase-order-service";
import { hasPermission } from "@/lib/permissions";

const transitionSchema = z.object({
  action: z.enum(['submit', 'approve', 'reject', 'send', 'close', 'cancel']),
  rejectionReason: z.string().optional(),
  cancellationReason: z.string().optional(),
});

const updateItemsSchema = z.object({
  items: z.array(z.object({
    id: z.string().optional(),
    itemId: z.string().uuid(),
    orderedQuantity: z.number().positive(),
    unitCost: z.number().min(0),
    notes: z.string().optional(),
  })),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'read')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    const { id } = await params;
    const po = await PurchaseOrderService.getPO(id);

    if (!po) {
      return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 });
    }

    return NextResponse.json(po);
  } catch (error: unknown) {
    console.error("Failed to fetch purchase order", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'update')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    // Status transitions
    if (body.action) {
      const { action, rejectionReason, cancellationReason } = transitionSchema.parse(body);

      switch (action) {
        case 'submit':
          return NextResponse.json(await PurchaseOrderService.submitForApproval(id, user.id));
        case 'approve':
          return NextResponse.json(await PurchaseOrderService.approvePO(id, user.id));
        case 'reject':
          if (!rejectionReason) {
            return NextResponse.json({ error: "Se requiere motivo de rechazo" }, { status: 400 });
          }
          return NextResponse.json(await PurchaseOrderService.rejectPO(id, user.id, rejectionReason));
        case 'send':
          return NextResponse.json(await PurchaseOrderService.sendPO(id, user.id));
        case 'close':
          return NextResponse.json(await PurchaseOrderService.closePO(id, user.id));
        case 'cancel':
          if (!cancellationReason) {
            return NextResponse.json({ error: "Se requiere motivo de cancelación" }, { status: 400 });
          }
          return NextResponse.json(await PurchaseOrderService.cancelPO(id, user.id, cancellationReason));
        default:
          return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
      }
    }

    // Update PO items
    if (body.items) {
      const { items } = updateItemsSchema.parse(body);
      const updatedItems = await PurchaseOrderService.updatePOItems(id, items, user.id);
      return NextResponse.json({ items: updatedItems });
    }

    // Update PO details
    const updateData: Record<string, unknown> = {};
    const allowedFields = ['dateRequired', 'expectedDeliveryDate', 'notes', 'termsConditions', 'supplierId'];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length > 0) {
      const updated = await PurchaseOrderService.updatePO(id, updateData as Record<string, unknown>, user.id);
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "No se especificaron cambios" }, { status: 400 });
  } catch (error: unknown) {
    console.error("Failed to update purchase order", error);

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
