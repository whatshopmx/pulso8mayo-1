import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isBranchScopedRole } from "@/lib/branch-scope";
import { hasPermission, type Role } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import { InventoryService } from "@/lib/services/inventory-service";
import { z } from "zod";

const approveSchema = z.object({
    action: z.literal("approve"),
    items: z.array(z.object({
        id: z.string().uuid(),
        approvedQuantity: z.number().positive(),
    })).optional(),
});

const rejectSchema = z.object({
    action: z.literal("reject"),
    reason: z.string().min(1),
});

const shipSchema = z.object({
    action: z.literal("ship"),
});

const receiveSchema = z.object({
    action: z.literal("receive"),
    items: z.array(z.object({
        id: z.string().uuid(),
        receivedQuantity: z.number().nonnegative(),
    })).optional(),
});

const actionSchema = z.union([approveSchema, rejectSchema, shipSchema, receiveSchema]);

/**
 * GET /api/inventory/transfers/[id]
 * Get details of a specific transfer
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { id } = await params;
        // C17.3 — el detalle se buscaba sólo por id: cualquier usuario
        // autenticado con un UUID veía una transferencia de otra empresa.
        // Una transferencia ajena devuelve null y la ruta responde 404.
        const transfer = await InventoryService.getTransfer(id, session.user.companyId);

        if (!transfer) {
            return NextResponse.json(
                { error: "Transfer not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            transfer,
        });

    } catch (error) {
        console.error("Get transfer error:", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Failed to fetch transfer" },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/inventory/transfers/[id]
 * Perform actions on a transfer (approve, reject, ship, receive)
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.branchId || !session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const userRole = (session.user as { role?: Role }).role ?? "ADMIN";
        // C17.3 — las transiciones son escrituras de inventario: quien sólo
        // lee (`EMPLEADO`, `READONLY`) no aprueba, envía ni recibe. Es el mismo
        // `inventory:update` que exige el resto de rutas de inventario.
        if (!hasPermission(userRole, "inventory", "update")) {
            return NextResponse.json(
                { error: "No tienes permiso para actualizar transferencias de inventario" },
                { status: 403 }
            );
        }

        const { id } = await params;
        const body = await req.json();
        const validatedData = actionSchema.parse(body);

        const transfer = await InventoryService.getTransfer(id, session.user.companyId);
        if (!transfer) {
            return NextResponse.json(
                { error: "Transfer not found" },
                { status: 404 }
            );
        }

        // C17.3 — el lado que ejecuta cada acción es el que la interfaz
        // muestra: el destino aprueba o rechaza, el origen envía, el destino
        // recibe. Para los roles con sucursal asignada, su sucursal tiene que
        // ser ese lado; los roles que ven toda la empresa operan dentro de la
        // suya — el servicio ya acotó la transferencia por empresa.
        const accionesPorDestino = ["approve", "reject", "receive"];
        const ladoRequerido = accionesPorDestino.includes(validatedData.action)
            ? transfer.toBranchId
            : transfer.fromBranchId;
        if (isBranchScopedRole(userRole) && session.user.branchId !== ladoRequerido) {
            return NextResponse.json(
                { error: "Esta transferencia no pertenece a tu sucursal: el lado que ejecuta esta acción es el otro extremo." },
                { status: 403 }
            );
        }

        let result;

        switch (validatedData.action) {
            case "approve":
                result = await InventoryService.approveTransfer(
                    id,
                    session.user.companyId,
                    session.user.id,
                    validatedData.items
                );
                break;

            case "reject":
                result = await InventoryService.rejectTransfer(
                    id,
                    session.user.companyId,
                    session.user.id,
                    validatedData.reason,
                );
                break;

            case "ship":
                result = await InventoryService.shipTransfer(
                    id,
                    session.user.companyId,
                    session.user.id,
                );
                break;

            case "receive":
                result = await InventoryService.receiveTransfer(
                    id,
                    session.user.companyId,
                    session.user.id,
                    validatedData.items,
                );
                break;

            default:
                return NextResponse.json(
                    { error: "Invalid action" },
                    { status: 400 }
                );
        }

        return NextResponse.json({
            success: true,
            transfer: result,
        });

    } catch (error) {
        console.error("Transfer action error:", error);

        // C17.3 — una transición sobre una transferencia ajena responde 404 con
        // el motivo, no 500: el 404 no filtra que exista.
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid data", details: error.issues },
                { status: 400 }
            );
        }

        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }

        return NextResponse.json(
            { error: "Failed to process transfer action" },
            { status: 500 }
        );
    }
}
