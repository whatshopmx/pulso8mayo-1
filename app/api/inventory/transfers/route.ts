import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope, assertBranchOfCompany } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { InventoryService } from "@/lib/services/inventory-service";
import { isApiError } from "@/lib/api/error";
import { z } from "zod";

const transferRequestSchema = z.object({
    fromBranchId: z.string().uuid().optional(),
    toBranchId: z.string().uuid(),
    items: z.array(z.object({
        itemId: z.string().uuid(),
        batchId: z.string().uuid().optional(),
        requestedQuantity: z.number().positive(),
        notes: z.string().optional(),
    })),
    notes: z.string().optional(),
});

/**
 * POST /api/inventory/transfers
 * Create a new transfer request
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized - User must be logged in" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const validatedData = transferRequestSchema.parse(body);

        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const fromBranchId = enforceBranchScope(
            role,
            session.user.branchId,
            validatedData.fromBranchId ?? null
        );
        if (!fromBranchId) {
            return NextResponse.json(
                { error: "Selecciona la sucursal de origen de la transferencia" },
                { status: 400 }
            );
        }

        // Create transfer
        const result = await InventoryService.createTransfer({
            companyId: session.user.companyId,
            fromBranchId,
            toBranchId: validatedData.toBranchId,
            requestedBy: session.user.id,
            items: validatedData.items,
            notes: validatedData.notes,
        });

        return NextResponse.json({
            success: true,
            transfer: result.transfer,
            items: result.items,
        });

    } catch (error) {
        console.error("Transfer request error:", error);

        // C17.3 — las guardas de pertenencia y de empresa fallan con `ApiError`
        // y traen su status: sin esta traducción, un destino de otra empresa
        // llegaba al cliente como 500 genérico.
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
            { error: "Failed to create transfer request" },
            { status: 500 }
        );
    }
}

/**
 * GET /api/inventory/transfers
 * Get transfers for the current user's branch
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const role = searchParams.get("role") as 'from' | 'to' | 'both' || 'both';
        const status = searchParams.get("status");

        const userRole = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(userRole, session.user.branchId, searchParams.get("branchId"));
        if (!branchId) {
            return NextResponse.json(
                { error: "Selecciona una sucursal para ver transferencias" },
                { status: 400 }
            );
        }
        // C17.3 — el listado acepta `branchId` de la query para los roles que
        // ven todas las sucursales: sin esta guarda, el ADMIN de una empresa
        // listaba las transferencias de otra pasando su id.
        await assertBranchOfCompany(session.user.companyId, branchId);

        // Get transfers
        const transfers = await InventoryService.getTransfersByBranch(
            branchId,
            role
        );

        // Filter by status if provided
        let filteredTransfers = transfers;
        if (status) {
            filteredTransfers = transfers.filter(t => t.transfer.status === status);
        }

        return NextResponse.json({
            success: true,
            transfers: filteredTransfers,
        });

    } catch (error) {
        console.error("Get transfers error:", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
            { error: "Failed to fetch transfers" },
            { status: 500 }
        );
    }
}
