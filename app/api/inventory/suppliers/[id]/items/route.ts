import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { supplierItems, inventoryItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const linkItemSchema = z.object({
    itemId: z.string().uuid("Invalid item ID"),
    supplierSku: z.string().optional(),
    price: z.number().min(0).optional(), // in pesos/decimals
    presentation: z.string().optional(),
    leadTimeDays: z.number().min(0).default(3),
});

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: supplierId } = await params;
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, 'inventory', 'read')) {
            return NextResponse.json(
                { error: "No tienes permisos para ver el inventario" },
                { status: 403 }
            );
        }

        const items = await db.select({
            id: supplierItems.id,
            itemId: supplierItems.itemId,
            name: inventoryItems.name,
            category: inventoryItems.category,
            unit: inventoryItems.unit,
            supplierSku: supplierItems.supplierSku,
            price: supplierItems.price,
            presentation: supplierItems.presentation,
            leadTimeDays: supplierItems.leadTimeDays,
            baseLastCost: inventoryItems.lastCost,
        })
        .from(supplierItems)
        .innerJoin(inventoryItems, eq(supplierItems.itemId, inventoryItems.id))
        .where(
            and(
                eq(supplierItems.supplierId, supplierId),
                eq(supplierItems.companyId, tenant.id)
            )
        );

        return NextResponse.json({
            success: true,
            items: items.map(item => ({
                ...item,
                price: item.price ? item.price / 100 : null,
                baseLastCost: item.baseLastCost ? item.baseLastCost / 100 : null,
            })),
        });

    } catch (error) {
        console.error("Get supplier items error:", error);
        return NextResponse.json(
            { error: "Failed to fetch supplier items" },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: supplierId } = await params;
        const { user } = await requireAuth();

        if (!hasPermission(user.role, 'inventory', 'update')) {
            return NextResponse.json(
                { error: "No tienes permisos para modificar proveedores" },
                { status: 403 }
            );
        }

        if (!user.companyId) {
            return NextResponse.json(
                { error: "Usuario no asignado a una empresa" },
                { status: 403 }
            );
        }

        const body = await req.json();
        const data = linkItemSchema.parse(body);

        const priceInCents = data.price ? Math.round(data.price * 100) : null;

        const [newItem] = await db.insert(supplierItems).values({
            companyId: user.companyId,
            supplierId,
            itemId: data.itemId,
            supplierSku: data.supplierSku || null,
            price: priceInCents,
            presentation: data.presentation || null,
            leadTimeDays: data.leadTimeDays,
        })
        .onConflictDoUpdate({
            target: [supplierItems.supplierId, supplierItems.itemId],
            set: {
                supplierSku: data.supplierSku || null,
                price: priceInCents,
                presentation: data.presentation || null,
                leadTimeDays: data.leadTimeDays,
                updatedAt: new Date(),
            }
        })
        .returning();

        return NextResponse.json({
            success: true,
            item: newItem,
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 }
            );
        }
        console.error("Link supplier item error:", error);
        return NextResponse.json(
            { error: "Failed to link item to supplier" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: supplierId } = await params;
        const { user } = await requireAuth();

        if (!hasPermission(user.role, 'inventory', 'update')) {
            return NextResponse.json(
                { error: "No tienes permisos para modificar proveedores" },
                { status: 403 }
            );
        }

        if (!user.companyId) {
            return NextResponse.json(
                { error: "Usuario no asignado a una empresa" },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(req.url);
        const itemId = searchParams.get("itemId");

        if (!itemId) {
            return NextResponse.json(
                { error: "itemId required" },
                { status: 400 }
            );
        }

        const [deleted] = await db.delete(supplierItems)
            .where(
                and(
                    eq(supplierItems.supplierId, supplierId),
                    eq(supplierItems.itemId, itemId),
                    eq(supplierItems.companyId, user.companyId)
                )
            )
            .returning();

        if (!deleted) {
            return NextResponse.json(
                { error: "Item connection not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Item unlinked from supplier",
        });

    } catch (error) {
        console.error("Unlink supplier item error:", error);
        return NextResponse.json(
            { error: "Failed to unlink item" },
            { status: 500 }
        );
    }
}
