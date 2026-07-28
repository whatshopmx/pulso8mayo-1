import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { PurchaseOrderService } from "@/lib/services/purchase-order-service";
import { hasPermission } from "@/lib/permissions";

const createPOSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  requisitionId: z.string().uuid().optional(),
  dateRequired: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  termsConditions: z.string().optional(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    orderedQuantity: z.number().positive(),
    unitCost: z.number().min(0),
    notes: z.string().optional(),
  })).min(1),
});

const createRequisitionSchema = z.object({
  branchId: z.string().uuid(),
  notes: z.string().optional(),
  dateRequired: z.string().optional(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    requestedQuantity: z.number().positive(),
    notes: z.string().optional(),
  })).min(1),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'read')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;
    const supplierId = searchParams.get("supplierId") || undefined;
    const status = searchParams.get("status") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const type = searchParams.get("type") || "po";
    const search = searchParams.get("search") || undefined;
    const sortField = searchParams.get("sortField") || undefined;
    const sortOrder = (searchParams.get("sortOrder") as 'asc' | 'desc') || undefined;
    const dateFromStr = searchParams.get("dateFrom") || undefined;
    const dateToStr = searchParams.get("dateTo") || undefined;
    const dateFrom = dateFromStr ? new Date(dateFromStr) : undefined;
    const dateTo = dateToStr ? new Date(dateToStr) : undefined;

    if (type === "requisition") {
      const requisitions = await PurchaseOrderService.listRequisitions(tenant.id!, branchId);
      return NextResponse.json({ requisitions });
    }

    const result = await PurchaseOrderService.listPOs({
      companyId: tenant.id!,
      branchId,
      supplierId,
      status: status as 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'CLOSED' | 'CANCELLED' | undefined,
      search,
      sortField,
      sortOrder,
      dateFrom,
      dateTo,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Failed to fetch purchase orders", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno del servidor" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'create')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    const body = await req.json();
    const type = body.type || "po";

    if (type === "requisition") {
      const data = createRequisitionSchema.parse(body);
      const result = await PurchaseOrderService.createRequisition({
        companyId: tenant.id!,
        branchId: data.branchId,
        requestedBy: user.id,
        notes: data.notes,
        dateRequired: data.dateRequired ? new Date(data.dateRequired) : undefined,
        items: data.items,
      });
      return NextResponse.json(result, { status: 201 });
    }

    const data = createPOSchema.parse(body);
    const result = await PurchaseOrderService.createPO({
      companyId: tenant.id!,
      branchId: body.branchId || tenant.branchId!,
      supplierId: data.supplierId,
      requestedBy: user.id,
      requisitionId: data.requisitionId,
      dateRequired: data.dateRequired ? new Date(data.dateRequired) : undefined,
      expectedDeliveryDate: data.expectedDeliveryDate ? new Date(data.expectedDeliveryDate) : undefined,
      notes: data.notes,
      termsConditions: data.termsConditions,
      items: data.items,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to create purchase order", error);

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
