import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { processReceiving } from "@/lib/services/receiving-service";
import { db } from "@/lib/db";
import { inventoryBatches, inventoryItems, suppliers } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * POST /api/inventory/receiving
 * Process a receiving workflow - scan/enter items being received.
 * Body logic lives in lib/services/receiving-service.ts (shared with the
 * workflow extractor, Fase 5).
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "Unauthorized - User must be logged in" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(
            role,
            session.user.branchId,
            (body as { branchId?: string }).branchId ?? null
        );
        if (!branchId) {
            return NextResponse.json(
                { error: "Selecciona una sucursal para registrar la recepción" },
                { status: 400 }
            );
        }

        const receiving = await processReceiving(
            {
                user: { id: session.user.id, companyId: session.user.companyId },
                branchId,
            },
            body
        );

        return NextResponse.json({
            success: true,
            receiving,
        });
    } catch (error) {
        console.error("Receiving workflow error:", error);

        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: "Invalid data", details: error.issues },
            { status: 400 }
          );
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to process receiving" },
            { status: 500 }
        );
    }
}

/**
 * GET /api/inventory/receiving
 * Get pending receiving workflows or recent receiving history
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get("limit") || "50");

        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(role, session.user.branchId, searchParams.get("branchId"));
        if (!branchId) {
            return NextResponse.json(
                { error: "Selecciona una sucursal para ver recepciones" },
                { status: 400 }
            );
        }

        const recentBatches = await db.select({
            id: inventoryBatches.id,
            lotNumber: inventoryBatches.lotNumber,
            itemId: inventoryBatches.itemId,
            branchId: inventoryBatches.branchId,
            initialQuantity: inventoryBatches.initialQuantity,
            receivedAt: inventoryBatches.receivedAt,
            expirationDate: inventoryBatches.expirationDate,
            supplierId: inventoryBatches.supplierId,
            supplierBatchInfo: inventoryBatches.supplierBatchInfo,
            /** Folio capturado en la recepción (guardado en supplierBatchInfo
             *  por processReceiving). Null para recepciones anteriores. */
            invoiceNumber: sql<string | null>`${inventoryBatches.supplierBatchInfo} ->> 'invoiceNumber'`,
            item: {
                name: inventoryItems.name,
                sku: inventoryItems.sku,
            },
            supplier: {
                name: suppliers.name,
            }
        })
        .from(inventoryBatches)
        .leftJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
        .leftJoin(suppliers, eq(inventoryBatches.supplierId, suppliers.id))
        .where(
            and(
                eq(inventoryBatches.branchId, branchId),
            )
        )
        .orderBy((t) => t.receivedAt)
        .limit(limit);

        return NextResponse.json({
            success: true,
            receivings: recentBatches,
        });

    } catch (error) {
        console.error("Get receiving error:", error);
        return NextResponse.json(
            { error: "Failed to fetch receiving data" },
            { status: 500 }
        );
    }
}