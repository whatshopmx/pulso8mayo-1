import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { db } from "@/lib/db";
import { productionOrders, productionResults, productionIngredients, recipes, inventoryItems, inventoryBatches } from "@/lib/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { ProductionService } from "@/lib/services/production-service";
import { expandRecipeLeaves, produceRecipeWithFefo, loadItemInfo, type LeafCache } from "@/lib/services/recipe-production";

const createOrderSchema = z.object({
    recipeId: z.string().min(1),
    plannedQuantity: z.number().int().positive(),
    unit: z.string().default("PORTION"),
    plannedDate: z.string().transform(s => new Date(s)),
    notes: z.string().optional(),
});

const recordProductionSchema = z.object({
    orderId: z.string().optional(),
    recipeId: z.string().min(1),
    producedQuantity: z.number().int().positive(),
    unit: z.string().default("PORTION"),
    notes: z.string().optional(),
    ingredients: z.array(z.object({
        itemId: z.string().min(1),
        batchId: z.string().optional(),
        expectedQuantity: z.number().nonnegative(),
        actualQuantity: z.number().nonnegative(),
        unit: z.string(),
        unitCost: z.number().int().optional(),
        yieldPercent: z.number().int().min(0).max(100).optional(),
    })).optional().default([]),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(role, session.user.branchId, searchParams.get("branchId"));

        if (!branchId) {
            return NextResponse.json({ error: "branchId requerido" }, { status: 400 });
        }

        // Vista previa de asignación FEFO para una receta y cantidad
        const isPreview = searchParams.get("preview") === "true";
        const previewRecipeId = searchParams.get("recipeId");
        if (isPreview && previewRecipeId) {
            const quantity = parseFloat(searchParams.get("quantity") || "1") || 1;
            const cache: LeafCache = new Map();
            const leaves = await expandRecipeLeaves(previewRecipeId, quantity, cache);

            if (leaves.length === 0) {
                return NextResponse.json({ success: true, preview: [] });
            }

            const itemIds = [...new Set(leaves.map(l => l.itemId))];
            const itemInfo = await loadItemInfo(session.user.companyId, itemIds);

            // Obtener nombres de items
            const itemsData = await db
                .select({ id: inventoryItems.id, name: inventoryItems.name, sku: inventoryItems.sku })
                .from(inventoryItems)
                .where(and(eq(inventoryItems.companyId, session.user.companyId), inArray(inventoryItems.id, itemIds)));
            const itemNameMap = new Map(itemsData.map(i => [i.id, i.name]));

            const preview = [];
            for (const leaf of leaves) {
                const info = itemInfo.get(leaf.itemId);
                const unit = info?.unit || leaf.unit || "UNIT";
                const itemName = itemNameMap.get(leaf.itemId) || "Insumo";

                // Consultar lotes disponibles ordenados por FEFO
                const batches = await db
                    .select({
                        id: inventoryBatches.id,
                        lotNumber: inventoryBatches.lotNumber,
                        currentQuantity: inventoryBatches.currentQuantity,
                        expirationDate: inventoryBatches.expirationDate,
                    })
                    .from(inventoryBatches)
                    .where(
                        and(
                            eq(inventoryBatches.branchId, branchId),
                            eq(inventoryBatches.itemId, leaf.itemId),
                            eq(inventoryBatches.status, "AVAILABLE"),
                            sql`${inventoryBatches.currentQuantity} > 0`
                        )
                    )
                    .orderBy(inventoryBatches.expirationDate, inventoryBatches.createdAt);

                let remainingNeeded = leaf.quantity;
                const allocations = [];

                for (const b of batches) {
                    if (remainingNeeded <= 0) break;
                    const available = Number(b.currentQuantity);
                    const take = Math.min(available, remainingNeeded);
                    if (take <= 0) continue;

                    allocations.push({
                        batchId: b.id,
                        lotNumber: b.lotNumber || "Sin folio",
                        expirationDate: b.expirationDate,
                        quantity: take,
                    });
                    remainingNeeded -= take;
                }

                preview.push({
                    itemId: leaf.itemId,
                    itemName,
                    requiredQuantity: leaf.quantity,
                    unit,
                    allocations,
                    allocatedQuantity: leaf.quantity - Math.max(0, remainingNeeded),
                    shortfall: Math.max(0, remainingNeeded),
                });
            }

            return NextResponse.json({ success: true, preview });
        }

        const orders = await ProductionService.getOrders(session.user.companyId, branchId);
        return NextResponse.json({ success: true, orders });
    } catch (error) {
        console.error("Get production orders error:", error);
        return NextResponse.json({ error: "Error al obtener órdenes" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const body = await req.json();
        const { action, branchId: requestedBranchId } = body;
        const role = (session.user as { role?: Role }).role ?? "ADMIN";
        const branchId = enforceBranchScope(role, session.user.branchId, requestedBranchId ?? null);

        if (!branchId) {
            return NextResponse.json({ error: "Selecciona una sucursal para registrar producción" }, { status: 400 });
        }

        if (action === "record") {
            const validated = recordProductionSchema.parse(body);

            // Si se envían ingredientes explícitos con lotes manuales, usar el registro directo
            if (validated.ingredients && validated.ingredients.length > 0) {
                const result = await ProductionService.recordProduction({
                    companyId: session.user.companyId,
                    branchId,
                    orderId: validated.orderId,
                    recipeId: validated.recipeId,
                    producedQuantity: validated.producedQuantity,
                    unit: validated.unit,
                    notes: validated.notes,
                    recordedBy: session.user.id,
                    ingredients: validated.ingredients,
                });

                if (!result) {
                    return NextResponse.json({ error: "La producción ya estaba registrada" }, { status: 409 });
                }

                return NextResponse.json({ success: true, result });
            }

            // Si no se envían ingredientes manuales, usar la deducción automática por FEFO
            const outcome = await db.transaction(async (tx) => {
                return await produceRecipeWithFefo(tx, {
                    companyId: session.user.companyId,
                    branchId,
                    recipeId: validated.recipeId,
                    quantity: validated.producedQuantity,
                    unit: validated.unit,
                    recordedBy: session.user.id,
                    orderId: validated.orderId,
                    notes: validated.notes,
                });
            });

            if (outcome.status === "skipped") {
                return NextResponse.json({ error: "La producción ya estaba registrada" }, { status: 409 });
            }

            if (outcome.status === "no-leaves") {
                // Registrar resultado base cuando la receta no tiene ingredientes hoja
                const basicResult = await ProductionService.recordProduction({
                    companyId: session.user.companyId,
                    branchId,
                    orderId: validated.orderId,
                    recipeId: validated.recipeId,
                    producedQuantity: validated.producedQuantity,
                    unit: validated.unit,
                    notes: validated.notes,
                    recordedBy: session.user.id,
                    ingredients: [],
                });
                return NextResponse.json({ success: true, result: basicResult });
            }

            return NextResponse.json({
                success: true,
                result: {
                    id: outcome.resultId,
                    producedQuantity: outcome.producedQuantity,
                    ingredientCost: outcome.ingredientCost,
                    shortfalls: outcome.shortfalls,
                },
            });
        }

        const validated = createOrderSchema.parse(body);
        const order = await ProductionService.createOrder({
            companyId: session.user.companyId,
            branchId,
            recipeId: validated.recipeId,
            plannedQuantity: validated.plannedQuantity,
            unit: validated.unit,
            plannedDate: validated.plannedDate,
            notes: validated.notes,
            createdBy: session.user.id,
        });

        return NextResponse.json({ success: true, order });
    } catch (error) {
        console.error("Create production order error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Datos inválidos", details: error.issues }, { status: 400 });
        }
        return NextResponse.json({ error: "Error al crear orden" }, { status: 500 });
    }
}
