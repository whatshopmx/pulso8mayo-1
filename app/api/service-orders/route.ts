import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import {
    createDraft,
    listOrders,
} from "@/lib/services/service-order-service";

const createOrderSchema = z.object({
    branchId: z.string().uuid(),
    type: z.enum(["CORRECTIVO", "PREVENTIVO", "CONTRACTUAL", "EXTRAORDINARIO"]),
    urgency: z.enum(["NORMAL", "URGENTE", "EMERGENCIA"]).optional(),
    equipmentId: z.string().uuid().nullable().optional(),
    complianceServiceId: z.string().uuid().nullable().optional(),
    scope: z.string().max(4000).nullable().optional(),
    justification: z.string().max(8000).nullable().optional(),
    technicalReport: z.string().max(20000).nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
    serviceProviderId: z.string().uuid().nullable().optional(),
    amount: z.number().int().min(0).nullable().optional(), // centavos
    scheduledDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
    costCenterId: z.string().uuid().nullable().optional(),
});

export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "read")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        // El alcance de sucursal del tenant (GERENTE/SUPERVISOR fijos) manda sobre el query param.
        const branchId = tenant.branchId ?? searchParams.get("branchId") ?? undefined;

        const result = await listOrders({
            companyId: tenant.id!,
            branchId,
            status: searchParams.get("status") || undefined,
            type: searchParams.get("type") || undefined,
            complianceServiceId: searchParams.get("complianceServiceId") || undefined,
            limit: parseInt(searchParams.get("limit") || "50"),
            offset: parseInt(searchParams.get("offset") || "0"),
        });

        return NextResponse.json(result);
    } catch (error: unknown) {
        console.error("Failed to list service orders", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 },
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, "inventory", "create")) {
            return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
        }

        const data = createOrderSchema.parse(await req.json());

        // Roles con sucursal fija no pueden crear órdenes en otra sucursal.
        const branchId = tenant.branchId ?? data.branchId;

        const order = await createDraft(
            {
                ...data,
                branchId,
                scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
            },
            tenant.id!,
            user.id,
        );

        return NextResponse.json({ order }, { status: 201 });
    } catch (error: unknown) {
        console.error("Failed to create service order", error);
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
