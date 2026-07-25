import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const transfer = await InventoryService.getTransfer(id);

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
        if (!session?.user?.id || !session?.user?.branchId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const body = await req.json();
        const validatedData = actionSchema.parse(body);

        const transfer = await InventoryService.getTransfer(id);
        if (!transfer) {
            return NextResponse.json(
                { error: "Transfer not found" },
                { status: 404 }
            );
        }

        let result;

        switch (validatedData.action) {
            case "approve":
                // Check if user is manager of the destination branch
                // For now, just approve
                result = await InventoryService.approveTransfer(
                    id,
                    session.user.id,
                    validatedData.items
                );
                break;

            case "reject":
                result = await InventoryService.rejectTransfer(
                    id,
                    session.user.id,
                    validatedData.reason,
                );
                break;

            case "ship":
                result = await InventoryService.shipTransfer(
                    id,
                    session.user.id,
                );
                break;

            case "receive":
                result = await InventoryService.receiveTransfer(
                    id,
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
        
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to process transfer action" },
      { status: 500 }
    );
  }
}
