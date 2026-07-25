import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { salesEntries, recipes, recipeItems, inventoryBatches, inventoryMovements } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

const salesSchema = z.object({
    sales: z.array(z.object({
        recipeId: z.string().uuid(),
        quantitySold: z.number().positive(),
        totalRevenue: z.number().nonnegative().optional(), // in dollars/pesos
    })),
    saleDate: z.string().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.branchId) {
            return NextResponse.json(
                { error: "Unauthorized - User must be in a branch" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const validated = salesSchema.parse(body);

        const saleDate = validated.saleDate ? new Date(validated.saleDate) : new Date();

        const tx = db;
        for (const sale of validated.sales) {
            const revenueCents = sale.totalRevenue ? Math.round(sale.totalRevenue * 100) : 0;

            // 1. Insert sales entry
            await tx.insert(salesEntries).values({
                companyId: session.user.companyId || "",
                branchId: session.user.branchId,
                recipeId: sale.recipeId,
                quantitySold: sale.quantitySold.toFixed(2),
                saleDate,
                totalRevenue: revenueCents,
            });

            // 2. Perform FIFO inventory deduction of ingredients
            const notes = `Desconsolidación automática por ventas del ${saleDate.toLocaleDateString()}`;
            await deductRecipeIngredients(tx, session.user.branchId, sale.recipeId, sale.quantitySold, session.user.id, notes);
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Sales entry error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to record sales" },
            { status: 500 }
        );
    }
}

async function deductRecipeIngredients(
    tx: any,
    branchId: string,
    recipeId: string,
    quantitySold: number,
    userId: string,
    notes: string
) {
    const [recipe] = await tx.select()
        .from(recipes)
        .where(eq(recipes.id, recipeId));
    if (!recipe) return;

    const baseYield = parseFloat(recipe.baseYield) || 1;

    const items = await tx.select()
        .from(recipeItems)
        .where(eq(recipeItems.recipeId, recipeId));

    for (const item of items) {
        const qtyNeeded = (parseFloat(item.quantity) * quantitySold) / baseYield;

        if (item.isSubRecipe) {
            await deductRecipeIngredients(tx, branchId, item.itemId, qtyNeeded, userId, notes);
        } else {
            await deductItemFIFO(tx, branchId, item.itemId, qtyNeeded, userId, notes);
        }
    }
}

async function deductItemFIFO(
    tx: any,
    branchId: string,
    itemId: string,
    quantityToDeduct: number,
    userId: string,
    reason: string
) {
    const batches = await tx.select()
        .from(inventoryBatches)
        .where(
            and(
                eq(inventoryBatches.branchId, branchId),
                eq(inventoryBatches.itemId, itemId),
                eq(inventoryBatches.status, 'AVAILABLE'),
                sql`${inventoryBatches.currentQuantity} > 0`
            )
        )
        .orderBy(inventoryBatches.expirationDate, inventoryBatches.createdAt);

    let remainingToDeduct = quantityToDeduct;

    for (const batch of batches) {
        if (remainingToDeduct <= 0) break;

        const currentQty = parseFloat(batch.currentQuantity);
        const deductQty = Math.min(currentQty, remainingToDeduct);

        await tx.update(inventoryBatches)
            .set({
                currentQuantity: (currentQty - deductQty).toFixed(4),
                updatedAt: new Date(),
            })
            .where(eq(inventoryBatches.id, batch.id));

        await tx.insert(inventoryMovements).values({
            branchId,
            itemId,
            batchId: batch.id,
            type: 'USAGE',
            quantityChange: -deductQty,
            reason: reason,
            performedBy: userId,
        });

        remainingToDeduct -= deductQty;
    }

    if (remainingToDeduct > 0) {
        const lastBatch = batches[batches.length - 1];
        if (lastBatch) {
            const currentQty = parseFloat(lastBatch.currentQuantity);
            await tx.update(inventoryBatches)
                .set({
                    currentQuantity: (currentQty - remainingToDeduct).toFixed(4),
                    updatedAt: new Date(),
                })
                .where(eq(inventoryBatches.id, lastBatch.id));
            
            await tx.insert(inventoryMovements).values({
                branchId,
                itemId,
                batchId: lastBatch.id,
                type: 'USAGE',
                quantityChange: -remainingToDeduct,
                reason: `${reason} (Ajuste negativo por falta de stock)`,
                performedBy: userId,
            });
        } else {
            const [dummyBatch] = await tx.insert(inventoryBatches).values({
                branchId,
                itemId,
                initialQuantity: 0,
                currentQuantity: (-remainingToDeduct).toFixed(4),
                lotNumber: `DUMMY-NEG-${Date.now()}`,
                status: 'AVAILABLE',
            }).returning();

            await tx.insert(inventoryMovements).values({
                branchId,
                itemId,
                batchId: dummyBatch.id,
                type: 'USAGE',
                quantityChange: -remainingToDeduct,
                reason: `${reason} (Ajuste negativo inicial)`,
                performedBy: userId,
            });
        }
    }
}
export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.branchId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const list = await db.select()
            .from(salesEntries)
            .where(eq(salesEntries.branchId, session.user.branchId));

        return NextResponse.json(list);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch sales entries" }, { status: 500 });
    }
}
