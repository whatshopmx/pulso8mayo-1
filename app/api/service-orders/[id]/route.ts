import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import {
    getOrderDetail,
    updateDraft,
} from "@/lib/services/service-order-service";

const patchOrderSchema = z.object({
    branchId: z.string().uuid().optional(),
    type: z.enum(["CORRECTIVO", "PREVENTIVO", "CONTRACTUAL", "EXTRAORDINARIO"]).optional(),
    urgency: z.enum(["NORMAL", "URGENTE", "EMERGENCIA"]).optional(),
    equipmentId: z.string().uuid().nullable().optional(),
    complianceServiceId: z.string().uuid().nullable().optional(),
    scope: z.string().max(4000).nullable().optional(),
    justification: z.string().max(8000).nullable().optional(),
    technicalReport: z.string().max(20000).nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
    amount: z.number().int().min(0).nullable().optional(), // centavos
    scheduledDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
    costCenterId: z.string().uuid().nullable().optional(),
});

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "read")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const { id } = await params;
        const detail = await getOrderDetail(tenant.id!, id);
        if (!detail) {
            return NextResponse.json({ error: "Orden de servicio no encontrada" }, { status: 404 });
        }
        return NextResponse.json(detail);
    } catch (error: unknown) {
        console.error("Failed to fetch service order", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 },
        );
    }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "update")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const { id } = await params;
        const data = patchOrderSchema.parse(await req.json());

        if (Object.keys(data).length === 0) {
            return NextResponse.json({ error: "No se especificaron cambios" }, { status: 400 });
        }

        // Roles con sucursal fija no pueden mover la orden a otra sucursal.
        if (data.branchId && tenant.branchId && data.branchId !== tenant.branchId) {
            data.branchId = tenant.branchId;
        }

        const order = await updateDraft(
            id,
            {
                ...data,
                scheduledDate:
                    data.scheduledDate === undefined
                        ? undefined
                        : data.scheduledDate === null
                          ? null
                          : new Date(data.scheduledDate),
            },
            tenant.id!,
        );

        return NextResponse.json({ order });
    } catch (error: unknown) {
        console.error("Failed to update service order", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 },
            );
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 },
        );
    }
}
