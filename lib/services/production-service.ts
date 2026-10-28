import { db } from "@/lib/db";
import {
    productionOrders, productionResults, productionIngredients,
    inventoryBatches, inventoryItems, inventoryMovements, recipes, recipeItems, salesEntries, branches,
    unitConversions,
} from "@/lib/db/schema";
import { eq, and, gte, sql, desc, inArray } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { allocateScopedBatches, type DbExecutor } from "./fefo-allocator";

/** Insumo capturado por el llamador (manual o explosión de receta). */
export interface ProductionIngredientInput {
    itemId: string;
    batchId?: string;
    expectedQuantity: number;
    actualQuantity: number;
    /** Unidad de la captura; `recordProduction` la convierte a la del insumo. */
    unit: string;
    unitCost?: number;
    yieldPercent?: number;
}

/** Entrada del registro de producción (manual y automático comparten contrato). */
export interface RecordProductionInput {
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
    ingredients: ProductionIngredientInput[];
}

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

    /**
     * FEFO-04B-3a — registro ÚNICO de producción, manual y automático.
     *
     * Toda la operación (resultado, elegibilidad FEFO, descuento de lote,
     * kardex USAGE, insumos, costo y cierre de orden) ocurre en UNA
     * transacción. Si el llamador ya trae una (`produceRecipeWithFefo`), se
     * escribe en ella; si no, se abre una propia. Así un rechazo a mitad del
     * recorrido no deja lotes descontados a medias.
     *
     * El faltante físico YA NO se acepta parcialmente (sustituye T16): la
     * producción completa se rechaza con 409 y no se inventa merma. La
     * elegibilidad es la misma que la venta/transferencia: lote AVAILABLE,
     * vencimiento futuro, de la empresa/sucursal/producto y con lock de fila.
     */
    static async recordProduction(data: RecordProductionInput, executor?: DbExecutor) {
        if (executor) return recordProductionInTransaction(executor, data);
        return db.transaction((tx) => recordProductionInTransaction(tx, data));
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

/**
 * C17.2 ampliado — la orden que se cierra es de la empresa Y de la sucursal
 * que produce. Antes el UPDATE iba sólo por `id`: una orden ajena quedaba
 * COMPLETED desde otra empresa.
 */
async function assertOrderOfProduction(
    executor: DbExecutor,
    companyId: string,
    branchId: string,
    orderId: string,
): Promise<void> {
    const [order] = await executor
        .select({ id: productionOrders.id })
        .from(productionOrders)
        .where(and(
            eq(productionOrders.id, orderId),
            eq(productionOrders.companyId, companyId),
            eq(productionOrders.branchId, branchId),
        ))
        .limit(1);

    if (!order) {
        throw ApiError.badRequest(
            `La orden ${orderId} no existe para esta empresa y sucursal.`
        );
    }
}

interface NormalizedIngredient {
    itemId: string;
    batchId?: string;
    expectedQuantity: number;
    actualQuantity: number;
    /** Unidad del insumo ya resuelta (destino de la conversión). */
    unit: string;
    unitCost?: number;
    yieldPercent?: number;
}

/** Cantidad `numeric(12,4)` sin notación científica ni pérdida de fracción. */
function toQuantity(value: number): string {
    if (!Number.isFinite(value)) throw new RangeError(`Cantidad inválida: ${value}`);
    const rounded = Math.round(value * 10_000) / 10_000;
    return (Object.is(rounded, -0) ? 0 : rounded).toFixed(4);
}

/**
 * Convierte la unidad capturada a la unidad del insumo con la tabla de SU
 * empresa. Sin fila no se asume equivalencia: es un 400, no un descuento
 * silencioso en otra unidad.
 */
async function unitFactor(
    executor: DbExecutor,
    companyId: string,
    from: string,
    to: string,
    cache: Map<string, number>,
): Promise<number> {
    if (from === to) return 1;
    const key = `${from}->${to}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const [row] = await executor
        .select({ factor: unitConversions.factor })
        .from(unitConversions)
        .where(and(
            eq(unitConversions.companyId, companyId),
            eq(unitConversions.fromUnit, from),
            eq(unitConversions.toUnit, to),
        ))
        .limit(1);

    if (!row) {
        throw ApiError.badRequest(
            `No hay conversión de ${from} a ${to} para esta empresa: no se asume equivalencia entre unidades.`
        );
    }

    const factor = Number(row.factor);
    if (!Number.isFinite(factor) || factor <= 0) {
        throw ApiError.badRequest(
            `La conversión de ${from} a ${to} no es válida para esta empresa.`
        );
    }
    cache.set(key, factor);
    return factor;
}

/**
 * Valida alcance y unidades antes de abrir el resultado. Así un lote de otra
 * sucursal/producto o una conversión ajena se rechaza sin escribir, y la
 * cantidad que llega a FEFO ya está en la unidad del insumo.
 */
async function normalizeIngredients(
    executor: DbExecutor,
    data: RecordProductionInput,
): Promise<NormalizedIngredient[]> {
    if (data.ingredients.length === 0) return [];

    // El lote explícito se revisa antes de cualquier otra lectura. Un lote de
    // otra sucursal o de otro producto no es un faltante físico: es una
    // escritura que no debe ocurrir y se nombra. Un lote inexistente sigue
    // siendo faltante y se rechaza al asignar.
    const batchIds = [...new Set(
        data.ingredients
            .map((ing) => ing.batchId)
            .filter((id): id is string => Boolean(id)),
    )];
    if (batchIds.length > 0) {
        const lotes = await executor
            .select({
                id: inventoryBatches.id,
                branchId: inventoryBatches.branchId,
                itemId: inventoryBatches.itemId,
            })
            .from(inventoryBatches)
            .where(inArray(inventoryBatches.id, batchIds));
        const byId = new Map(lotes.map((lote) => [lote.id, lote]));
        for (const ing of data.ingredients) {
            if (!ing.batchId) continue;
            const lote = byId.get(ing.batchId);
            if (!lote) continue;
            if (lote.branchId !== data.branchId) {
                throw ApiError.badRequest(
                    `El lote ${lote.id} no pertenece a la sucursal ${data.branchId}: la producción sólo descuenta lotes propios.`
                );
            }
            if (lote.itemId !== ing.itemId) {
                throw ApiError.badRequest(
                    `El lote ${lote.id} no corresponde al insumo ${ing.itemId}: la producción no sustituye lotes entre productos.`
                );
            }
        }
    }

    const itemIds = [...new Set(data.ingredients.map((ing) => ing.itemId))];
    const items = await executor
        .select({ id: inventoryItems.id, unit: inventoryItems.unit })
        .from(inventoryItems)
        .where(and(
            eq(inventoryItems.companyId, data.companyId),
            inArray(inventoryItems.id, itemIds),
        ));
    const itemUnit = new Map(items.map((item) => [item.id, item.unit]));
    const missing = itemIds.find((itemId) => !itemUnit.has(itemId));
    if (missing) {
        throw ApiError.badRequest(`El insumo ${missing} no existe para esta empresa.`);
    }

    const cache = new Map<string, number>();
    const normalized: NormalizedIngredient[] = [];
    for (const ing of data.ingredients) {
        if (!Number.isFinite(ing.expectedQuantity) || ing.expectedQuantity < 0
            || !Number.isFinite(ing.actualQuantity) || ing.actualQuantity < 0) {
            throw ApiError.badRequest(
                `Cantidad inválida para el insumo ${ing.itemId}: usa cantidades positivas con hasta 4 decimales.`
            );
        }
        const from = ing.unit?.trim();
        if (!from) {
            throw ApiError.badRequest(`El insumo ${ing.itemId} no declara unidad.`);
        }
        const to = (itemUnit.get(ing.itemId) || from).trim();
        const factor = await unitFactor(executor, data.companyId, from, to, cache);
        normalized.push({
            itemId: ing.itemId,
            batchId: ing.batchId,
            expectedQuantity: ing.expectedQuantity * factor,
            actualQuantity: ing.actualQuantity * factor,
            unit: to,
            unitCost: ing.unitCost,
            yieldPercent: ing.yieldPercent,
        });
    }
    return normalized;
}

/**
 * Cuerpo transaccional de FEFO-04B-3a. No abre transacción: la recibe para
 * que `produceRecipeWithFefo` conserve el lock hasta la última escritura.
 */
async function recordProductionInTransaction(
    q: DbExecutor,
    data: RecordProductionInput,
): Promise<{
    id: string;
    ingredientCost: number;
    shortfalls: { itemId: string; batchId: string | null; missing: number; unit: string }[];
} & Record<string, unknown> | null> {
    await assertBranchOfCompany(q, data.companyId, data.branchId);
    await assertRecipeOfCompany(q, data.companyId, data.recipeId);
    if (data.orderId) {
        await assertOrderOfProduction(q, data.companyId, data.branchId, data.orderId);
    }

    const ingredients = await normalizeIngredients(q, data);

    // Task 4 (§6.4) — ventana de retención en línea. El vencimiento sale de
    // `now()` del servidor, no del reloj del proceso: `production_date` usa
    // el default `now()` y si mezcláramos ambos relojes en una máquina con
    // huso local (Windows en CST) `expires_at` nacería corrido varias horas.
    // Receta sin hold time → null y la producción sigue igual que antes.
    const [recipe] = await q
        .select({ holdTimeMinutes: recipes.holdTimeMinutes })
        .from(recipes)
        .where(and(eq(recipes.id, data.recipeId), eq(recipes.companyId, data.companyId)))
        .limit(1);
    const holdTimeMinutes = recipe?.holdTimeMinutes ?? null;
    const expiresAt = holdTimeMinutes && holdTimeMinutes > 0
        ? sql`now() + (${holdTimeMinutes} || ' minutes')::interval`
        : null;

    // A9 — el resultado se inserta ANTES de tocar ningún lote. El único
    // parcial `(workflow_instance_id, recipe_id)` convierte este insert en
    // la guarda de idempotencia: si la instancia ya se procesó, el
    // `onConflictDoNothing` no devuelve fila y se sale sin descontar nada.
    const [result] = await q.insert(productionResults)
        .values({
            companyId: data.companyId,
            branchId: data.branchId,
            orderId: data.orderId,
            recipeId: data.recipeId,
            workflowInstanceId: data.workflowInstanceId,
            producedQuantity: data.producedQuantity,
            unit: data.unit,
            notes: data.notes,
            recordedBy: data.recordedBy,
            ingredientCost: 0,
            expiresAt: expiresAt as unknown as Date | null,
        })
        .onConflictDoNothing()
        .returning();

    if (!result) return null;

    const now = new Date();
    // Costo exacto acumulado; se redondea UNA vez al escribir (A7).
    let ingredientCostExact = 0;
    const rows: (typeof productionIngredients.$inferInsert)[] = [];

    for (const ing of ingredients) {
        if (ing.actualQuantity <= 0) {
            rows.push({
                resultId: result.id,
                itemId: ing.itemId,
                batchId: ing.batchId ?? null,
                expectedQuantity: toQuantity(ing.expectedQuantity),
                actualQuantity: toQuantity(0),
                unit: ing.unit,
                unitCost: ing.unitCost === undefined ? null : Math.round(ing.unitCost),
                totalCost: 0,
                yieldPercent: ing.yieldPercent ?? 100,
            });
            continue;
        }

        // Misma elegibilidad/lock que transferencias y venta. El faltante se
        // rechaza completo (FEFO-02): no hay descuento parcial ni merma
        // ficticia.
        const plan = await allocateScopedBatches(q, {
            companyId: data.companyId,
            branchId: data.branchId,
            itemId: ing.itemId,
            quantity: ing.actualQuantity,
            batchId: ing.batchId,
        });

        if (plan.allocations.length === 0 || plan.shortfallQuantity > 0) {
            throw ApiError.conflict(
                `Stock insuficiente para ${ing.itemId}: se requieren ${toQuantity(ing.actualQuantity)} ${ing.unit}`
                + ` y faltan ${toQuantity(plan.shortfallQuantity)}. La producción no se registró.`
            );
        }

        for (const allocation of plan.allocations) {
            await q.update(inventoryBatches)
                .set({
                    currentQuantity: sql`${inventoryBatches.currentQuantity} - ${allocation.quantity}`,
                    updatedAt: now,
                })
                .where(eq(inventoryBatches.id, allocation.batchId));

            const unitCost = ing.unitCost ?? allocation.unitCost ?? 0;
            const lineCost = unitCost * allocation.quantity;
            ingredientCostExact += lineCost;

            // El esperado de una línea FEFO se reparte en la misma proporción
            // que la cantidad asignada: la suma de líneas sigue siendo el
            // esperado de la receta, no N veces el total.
            const expected = plan.allocatedQuantity > 0
                ? ing.expectedQuantity * (allocation.quantity / plan.allocatedQuantity)
                : 0;

            rows.push({
                resultId: result.id,
                itemId: ing.itemId,
                batchId: allocation.batchId,
                expectedQuantity: toQuantity(expected),
                actualQuantity: toQuantity(allocation.quantity),
                unit: ing.unit,
                unitCost: Math.round(unitCost),
                totalCost: Math.round(lineCost),
                yieldPercent: ing.yieldPercent ?? 100,
            });

            await q.insert(inventoryMovements).values({
                branchId: data.branchId,
                itemId: ing.itemId,
                batchId: allocation.batchId,
                type: "USAGE",
                quantityChange: toQuantity(-allocation.quantity),
                reason: `Consumo de producción ${result.id}`,
                referenceId: result.id,
                performedBy: data.recordedBy,
            });
        }
    }

    if (rows.length > 0) {
        await q.insert(productionIngredients).values(rows);
    }

    const ingredientCost = Math.round(ingredientCostExact);
    await q.update(productionResults)
        .set({ ingredientCost, updatedAt: now })
        .where(eq(productionResults.id, result.id));

    if (data.orderId) {
        await q.update(productionOrders)
            .set({ status: "COMPLETED", completedAt: now, updatedAt: now })
            .where(and(
                eq(productionOrders.id, data.orderId),
                eq(productionOrders.companyId, data.companyId),
            ));
    }

    return { ...result, ingredientCost, shortfalls: [] };
}
