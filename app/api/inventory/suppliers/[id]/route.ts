import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { AuditService } from "@/lib/services/audit-service";
import { db } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const supplierSchema = z.object({
    name: z.string().min(1, "Name is required").optional(),
    contactName: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional(),
    address: z.string().optional(),
    taxId: z.string().optional(),
    active: z.boolean().default(true).optional(),
    matchTolerancePercent: z.number().int().min(0).max(100).default(5).optional(),
});

/**
 * GET /api/inventory/suppliers/[id]
 * Get details of a specific supplier
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const supplier = await db.query.suppliers.findFirst({
            where: and(
                eq(suppliers.id, id),
                eq(suppliers.companyId, session.user.companyId!)
            ),
        });

        if (!supplier) {
            return NextResponse.json(
                { error: "Supplier not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            supplier,
        });

    } catch (error) {
        console.error("Get supplier error:", error);
        return NextResponse.json(
            { error: "Failed to fetch supplier" },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/inventory/suppliers/[id]
 * Update a supplier
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const body = await req.json();
        const validatedData = supplierSchema.parse(body);

        // Verify supplier belongs to company
        const existingSupplier = await db.query.suppliers.findFirst({
            where: and(
                eq(suppliers.id, id),
                eq(suppliers.companyId, session.user.companyId!)
            ),
        });

        if (!existingSupplier) {
            return NextResponse.json(
                { error: "Supplier not found" },
                { status: 404 }
            );
        }

        const [updatedSupplier] = await db.update(suppliers)
            .set({
                ...validatedData,
                updatedAt: new Date(),
            })
            .where(eq(suppliers.id, id))
            .returning();

        AuditService.logInventoryAction({
            companyId: session.user.companyId,
            branchId: enforceBranchScope(
                (session.user.role as Role) ?? "ADMIN",
                session.user.branchId,
                null
            ) ?? '',
            action: 'UPDATE',
            entityType: 'SUPPLIER',
            entityId: id,
            oldValue: existingSupplier,
            newValue: updatedSupplier,
            performedBy: session.user.id,
            reason: 'Supplier updated',
        });

        return NextResponse.json({
            success: true,
            supplier: updatedSupplier,
        });

    } catch (error) {
        console.error("Update supplier error:", error);
        
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update supplier" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/inventory/suppliers/[id]
 * Soft delete a supplier (set active = false)
 */
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { id } = await params;

        // Verify supplier belongs to company
        const existingSupplier = await db.query.suppliers.findFirst({
            where: and(
                eq(suppliers.id, id),
                eq(suppliers.companyId, session.user.companyId!)
            ),
        });

        if (!existingSupplier) {
            return NextResponse.json(
                { error: "Supplier not found" },
                { status: 404 }
            );
        }

        // Soft delete
        await db.update(suppliers)
            .set({
                active: false,
                updatedAt: new Date(),
            })
            .where(eq(suppliers.id, id));

        AuditService.logInventoryAction({
            companyId: session.user.companyId,
            branchId: enforceBranchScope(
                (session.user.role as Role) ?? "ADMIN",
                session.user.branchId,
                null
            ) ?? '',
            action: 'DELETE',
            entityType: 'SUPPLIER',
            entityId: id,
            oldValue: existingSupplier,
            performedBy: session.user.id,
            reason: 'Supplier soft-deleted',
        });

        return NextResponse.json({
            success: true,
            message: "Supplier deleted successfully",
        });

    } catch (error) {
        console.error("Delete supplier error:", error);
        return NextResponse.json(
            { error: "Failed to delete supplier" },
            { status: 500 }
        );
    }
}
