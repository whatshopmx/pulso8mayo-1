import { db } from "@/lib/db";
import {
    productionOrders, productionResults, productionIngredients,
    inventoryBatches, inventoryItems, inventoryMovements, recipes, recipeItems, salesEntries, branches,
} from "@/lib/db/schema";
import { eq, and, gte, sql, sum, desc, inArray } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import type { DbExecutor } from "./fefo-allocator";

export interface ProductionSuggestion {
    recipeId: string;
    recipeName: string;
    suggestedQuantity: number;
    unit: string;
    avgDailySales: number;
    currentStock: number;
}

export class ProductionService {

    static async createOrder(data: {
        companyId: string;
        branchId: string;
        recipeId: string;
        plannedQuantity: number;
        unit: string;
        plannedDate: Date;
        notes?: string;
        createdBy: string;
    }) {
        // C17.2 — la sucursal que produce y la receta tienen que ser de la
        // empresa. Sin la primera, un admin pasaba el id de una sucursal ajena
        // y la orden quedaba con `company_id` de esta empresa y `branch_id` de
        // la otra: una fila que ningún filtro por empresa deshace, porque la
        // escribió esta sesión.
        await assertBranchOfCompany(db, data.companyId, data.branchId);
        await assertRecipeOfCompany(db, data.companyId, data.recipeId);
        const [order] = await db.insert(productionOrders).values(data).returning();
        return order;
    }

    static async getOrders(companyId: string, branchId: string) {
        return db.select({
            order: productionOrders,
            recipe: {
                id: recipes.id,
                name: recipes.name,
            },
        })
            .from(productionOrders)
            .leftJoin(recipes, eq(productionOrders.recipeId, recipes.id))
            .where(and(
                eq(productionOrders.companyId, companyId),
                eq(productionOrders.branchId, branchId),
            ))
            .orderBy(desc(productionOrders.plannedDate));
    }

    static async recordProduction(data: {
        companyId: string;
        branchId: string;
        orderId?: string;
        recipeId: string;
        /** Instancia de workflow que la originó. Con ella la escritura es idempotente (A9). */
        workflowInstanceId?: string;
        producedQuantity: number;
        unit: string;
        notes?: string;
        recordedBy: string;
        ingredients: {
            itemId: string;
            batchId?: string;
            expectedQuantity: number;
            actualQuantity: number;
            unit: string;
            unitCost?: number;
            yieldPercent?: number;
        }[];
    }, executor?: DbExecutor) {
        // T16: si no alcanza el lote, se descuenta lo disponible y el faltante se
        // devuelve en `shortfalls` en vez de omitir el descuento en silencio
        // (antes hacía `if (batch && batch.currentQuantity >= ing.actualQuantity)`
        // y si no, no hacía NADA, perdiendo la señal de auditoría).
        const q: DbExecutor = executor || db;
        const { ingredients, ...resultData } = data;
        const shortfalls: {
            itemId: string;
            batchId: string | null;
            missing: number;
            unit: string;
        }[] = [];

        // C17.2 — antes de escribir nada: la receta es de la empresa y los
        // lotes explícitos son de la sucursal que produce. El camino de
        // ingredientes manuales no corre dentro de una transacción, así que un
        // rechazo en mitad del bucle de descuento dejaría lotes descontados a
        // medias — la comprobación va antes del primer insert.
        //
        // Un lote de otra sucursal no es faltante (eso es merma de stock
        // propio): es una escritura que no debería ocurrir, y se rechaza
        // nombrando el lote. Que el lote no exista sigue siendo shortfall, que
        // es el contrato T16 que el camino FEFO ya usa.
        await assertBranchOfCompany(q, data.companyId, data.branchId);
        await assertRecipeOfCompany(q, data.companyId, data.recipeId);
        const batchIds = ingredients
            .map((ing) => ing.batchId)
            .filter((id): id is string => Boolean(id));
        if (batchIds.length > 0) {
            const lotes = await q
                .select({ id: inventoryBatches.id, branchId: inventoryBatches.branchId })
                .from(inventoryBatches)
                .where(inArray(inventoryBatches.id, batchIds));
            const ajeno = lotes.find((lote) => lote.branchId !== data.branchId);
            if (ajeno) {
                throw ApiError.badRequest(
                    `El lote ${ajeno.id} no pertenece a la sucursal ${data.branchId}: la producción sólo descuenta lotes propios.`
                );
            }
        }

        // Task 4 (§6.4) — ventana de retención en línea. El vencimiento sale de
        // `now()` del servidor, no del reloj del proceso: `production_date` usa
        // el default `now()` y si mezcláramos ambos relojes en una máquina con
        // huso local (Windows en CST) `expires_at` nacería corrido varias horas.
        // Receta sin hold time → null y la producción sigue igual que antes.
        const [recipe] = await q
            .select({ holdTimeMinutes: recipes.holdTimeMinutes })
            .from(recipes)
            .where(eq(recipes.id, data.recipeId))
            .limit(1);
        const holdTimeMinutes = recipe?.holdTimeMinutes ?? null;
        const expiresAt = holdTimeMinutes && holdTimeMinutes > 0
            ? sql`now() + (${holdTimeMinutes} || ' minutes')::interval`
            : null;

        // A9 — el resultado se inserta ANTES de tocar ningún lote. El único
        // parcial `(workflow_instance_id, recipe_id)` convierte este insert en
        // la guarda de idempotencia: si la instancia ya se procesó, el
        // `onConflictDoNothing` no devuelve fila y se sale sin descontar nada.
        // Con la guarda al final —o con el `notes LIKE` de antes— la segunda
        // ejecución alcanzaba a descontar el lote por segunda vez.
        // `ingredientCost` todavía no se conoce: se calcula abajo y se escribe
        // con un UPDATE al cerrar.
        const [result] = await q.insert(productionResults)
            .values({ ...resultData, ingredientCost: 0, expiresAt: expiresAt as any })
            .onConflictDoNothing()
            .returning();

        if (!result) return null;

        // Costo total de los insumos, en centavos. Se acumula con la cantidad
        // EXACTA y se redondea una sola vez al escribir (A7): el centavo es la
        // unidad mínima y `production_results.ingredient_cost` sigue en integer.
        let ingredientCost = 0;

        // Deduct ingredients from inventory batches
        for (const ing of ingredients) {
            const cost = ing.unitCost ?? 0;
            const total = cost * ing.actualQuantity;
            ingredientCost += total;

            if (ing.batchId) {
                const [batch] = await q
                    .select({
                        id: inventoryBatches.id,
                        currentQuantity: inventoryBatches.currentQuantity,
                    })
                    .from(inventoryBatches)
                    .where(eq(inventoryBatches.id, ing.batchId))
                    .limit(1);

                if (!batch) {
                    shortfalls.push({ itemId: ing.itemId, batchId: ing.batchId, missing: ing.actualQuantity, unit: ing.unit });
                    continue;
                }

                const available = Number(batch.currentQuantity);
                const deduct = Math.min(available, ing.actualQuantity);

                if (deduct > 0) {
                    await q.update(inventoryBatches)
                        .set({
                            currentQuantity: sql`${inventoryBatches.currentQuantity} - ${deduct}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(inventoryBatches.id, ing.batchId));
                }

                if (deduct < ing.actualQuantity) {
                    shortfalls.push({
                        itemId: ing.itemId,
                        batchId: ing.batchId,
                        missing: ing.actualQuantity - deduct,
                        unit: ing.unit,
                    });
                }
            } else {
                // Sin lote asignado no hay nada que descontar: se reporta para
                // que el llamador decida (p.ej. merma por lote insuficiente).
                shortfalls.push({ itemId: ing.itemId, batchId: null, missing: ing.actualQuantity, unit: ing.unit });
            }
        }

        // Create ingredient records
        if (ingredients.length > 0) {
            await q.insert(productionIngredients).values(
                ingredients.map(ing => ({
                    resultId: result.id,
                    ...ing,
                    // A7b: las cantidades ya son `numeric(12,4)` — string en TS —
                    // y se guardan exactas, igual que el descuento del lote. El
                    // `Math.round` que vivía aquí perdía toda línea de receta por
                    // debajo de media unidad.
                    expectedQuantity: String(ing.expectedQuantity),
                    actualQuantity: String(ing.actualQuantity),
                    // El costo sí se redondea: es centavos sobre integer.
                    totalCost: Math.round((ing.unitCost ?? 0) * ing.actualQuantity),
                    yieldPercent: ing.yieldPercent ?? 100,
                }))
            );
        }

        // El costo ya es conocido: se cierra el resultado que se abrió arriba.
        const totalCost = Math.round(ingredientCost);
        if (totalCost !== 0) {
            await q.update(productionResults)
                .set({ ingredientCost: totalCost, updatedAt: new Date() })
                .where(eq(productionResults.id, result.id));
        }

        // Record inventory movement (finished goods produced as positive movement)
        // TODO: insert into inventoryBatches for finished goods

        // Update order status if linked
        if (data.orderId) {
            await q.update(productionOrders)
                .set({
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(productionOrders.id, data.orderId));
        }

        return { ...result, ingredientCost: totalCost, shortfalls };
    }

    static async getSuggestions(companyId: string, branchId: string): Promise<ProductionSuggestion[]> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Get recipes with their inventory items
        const allRecipes = await db.select()
            .from(recipes)
            .where(eq(recipes.companyId, companyId));

        const suggestions: ProductionSuggestion[] = [];

        for (const recipe of allRecipes) {
            // Average daily sales for this recipe
            const salesData = await db.select({
                totalSold: sql<number>`COALESCE(SUM(CAST(${salesEntries.quantitySold} AS INTEGER)), 0)`,
            })
                .from(salesEntries)
                .where(and(
                    eq(salesEntries.recipeId, recipe.id),
                    eq(salesEntries.branchId, branchId),
                    gte(salesEntries.saleDate, sevenDaysAgo),
                ));

            const totalSold = salesData[0]?.totalSold ?? 0;
            const avgDailySales = Math.round(totalSold / 7);

            // Get recipe items to check stock of ingredients
            const recipeIngs = await db.select({
                itemId: recipeItems.itemId,
                quantity: recipeItems.quantity,
            })
                .from(recipeItems)
                .where(eq(recipeItems.recipeId, recipe.id));

            // Find minimum stock coverage among ingredients
            let minStockRatio = Infinity;
            for (const ri of recipeIngs) {
                const stockSum = await db.select({
                    total: sql<number>`COALESCE(SUM(${inventoryBatches.currentQuantity}), 0)`,
                })
                    .from(inventoryBatches)
                    .where(and(
                        eq(inventoryBatches.itemId, ri.itemId),
                        eq(inventoryBatches.branchId, branchId),
                    ));

                const currentStock = stockSum[0]?.total ?? 0;
                const neededPerBatch = Number(ri.quantity);
                const ratio = neededPerBatch > 0 ? currentStock / neededPerBatch : Infinity;
                if (ratio < minStockRatio) minStockRatio = ratio;
            }

            const currentStock = minStockRatio === Infinity ? 999 : Math.floor(minStockRatio);

            suggestions.push({
                recipeId: recipe.id,
                recipeName: recipe.name,
                suggestedQuantity: Math.max(0, avgDailySales * 2 - currentStock),
                unit: recipe.unit,
                avgDailySales,
                currentStock,
            });
        }

        return suggestions
            .filter(s => s.suggestedQuantity > 0)
            .sort((a, b) => b.suggestedQuantity - a.suggestedQuantity);
    }
}

/**
 * C17.2 — la receta tiene que ser de la empresa que produce.
 *
 * `recipes` no guarda sucursal: la receta es del grupo y se produce en la
 * sucursal que la registra. Sin esta guarda, un `recipeId` de otra empresa
 * creaba órdenes y registraba producciones contra recetas ajenas — y
 * `getOrders` devolvía el nombre de esa receta ajena en la pantalla de la
 * víctima, porque el join es por id.
 */
/**
 * C17.2 — la sucursal que produce es de la empresa.
 *
 * `production_orders` y `production_results` guardan las dos cosas —empresa y
 * sucursal— y nadie las contrastaba: `enforceBranchScope` devuelve la sucursal
 * del cuerpo tal cual para los roles que ven toda la empresa. Con una sucursal
 * ajena, la producción descontaba lotes de la otra empresa (que es donde
 * estaban) y escribía el movimiento con la empresa de esta.
 *
 * Va por `executor` y no por el `db` global para que, dentro de la transacción
 * de `produceRecipeWithFefo`, lea con el mismo ejecutor que va a escribir.
 */
async function assertBranchOfCompany(
    executor: DbExecutor,
    companyId: string,
    branchId: string,
): Promise<void> {
    const [row] = await executor
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
        .limit(1);

    if (!row) {
        throw ApiError.badRequest(
            "La sucursal seleccionada no existe para esta empresa. Recarga el catálogo e inténtalo de nuevo."
        );
    }
}

async function assertRecipeOfCompany(
    executor: DbExecutor,
    companyId: string,
    recipeId: string,
): Promise<void> {
    const [recipe] = await executor
        .select({ id: recipes.id })
        .from(recipes)
        .where(and(eq(recipes.id, recipeId), eq(recipes.companyId, companyId)))
        .limit(1);

    if (!recipe) {
        throw ApiError.badRequest(
            `La receta ${recipeId} no existe para esta empresa. Recarga el catálogo de recetas e inténtalo de nuevo.`
        );
    }
}
