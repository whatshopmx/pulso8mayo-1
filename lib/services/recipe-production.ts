// lib/services/recipe-production.ts
//
// Explosión de receta + producción con FEFO. Este código vivía dentro de
// `production-from-workflow.ts` como funciones privadas; Task 6
// (plan-loteprod-gaps §6.2) necesita exactamente lo mismo para completar una
// línea de la Hoja de Producción Diaria, y la alternativa era una segunda copia
// del mismo cálculo. El workstream ya borró tres mapas duplicados por esa vía;
// aquí se corta antes.
//
// Dos responsabilidades, en este orden:
//   1. `expandRecipeLeaves`: receta → insumos hoja, recursando sub-recetas y
//      aplicando `baseYield` (por unidad) y `yieldPercent` (por línea).
//   2. `produceRecipeWithFefo`: hojas → `allocateFEFO` por insumo dentro de la
//      transacción del llamador → `recordProduction` → merma por lote
//      insuficiente. El descuento lo hace exclusivamente `recordProduction`
//      (R-4): aquí no se vuelve a tocar ningún lote.

import { db } from "@/lib/db";
import { inventoryItems, inventoryWaste, recipeItems, recipes } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { allocateFEFO, type DbExecutor, type FefoAllocation } from "./fefo-allocator";
import { ProductionService } from "./production-service";

export interface LeafRequirement {
    itemId: string;
    /** Cantidad bruta necesaria, con yield aplicado (antes de conversión de unidad). */
    quantity: number;
    unit: string | null;
}

/** Cache de hojas por receta. Vive lo que dure la operación del llamador. */
export type LeafCache = Map<string, LeafRequirement[]>;

/**
 * Expande una receta en sus insumos hoja, recursando sub-recetas.
 *
 * A6/O-3 — qué guarda el cache. Antes guardaba las hojas ya multiplicadas por
 * el `quantityNeeded` de la primera expansión, con `recipeId` como única clave:
 * dos recetas que compartieran una sub-receta con cantidades distintas hacían
 * que la segunda recibiera las de la primera y el inventario se descontaba mal.
 *
 * Ahora el cache guarda las hojas **por una unidad de `baseYield`** y el escalado
 * ocurre al leer. Así la entrada no depende de quién la pidió primero y
 * `expandRecipeLeaves(r, n)` es siempre `n × leavesPerUnit(r)`.
 *
 * `yieldPercent` se sigue aplicando UNA sola vez por nivel, dentro de
 * `leavesPerUnit`: es un factor propio de la línea de receta, no de la cantidad,
 * así que escalar después no lo altera.
 */
export async function expandRecipeLeaves(
    recipeId: string,
    quantityNeeded: number,
    cache: LeafCache
): Promise<LeafRequirement[]> {
    const perUnit = await leavesPerUnit(recipeId, cache);
    return perUnit.map((leaf) => ({ ...leaf, quantity: leaf.quantity * quantityNeeded }));
}

/**
 * Hojas necesarias para producir **una unidad** de la receta (`baseYield`
 * dividido ya aplicado). Es lo único que se cachea.
 */
async function leavesPerUnit(recipeId: string, cache: LeafCache): Promise<LeafRequirement[]> {
    const cached = cache.get(recipeId);
    if (cached) return cached;

    const [recipe] = await db
        .select({ baseYield: recipes.baseYield })
        .from(recipes)
        .where(eq(recipes.id, recipeId));
    if (!recipe) return [];

    const baseYield = parseFloat(recipe.baseYield) || 1;

    const items = await db
        .select({
            itemId: recipeItems.itemId,
            quantity: recipeItems.quantity,
            unit: recipeItems.unit,
            isSubRecipe: recipeItems.isSubRecipe,
            yieldPercent: recipeItems.yieldPercent,
        })
        .from(recipeItems)
        .where(eq(recipeItems.recipeId, recipeId));

    const leaves: LeafRequirement[] = [];
    for (const item of items) {
        // Cantidad de esta línea para UNA unidad de la receta.
        const qty = parseFloat(String(item.quantity)) / baseYield;

        if (item.isSubRecipe) {
            leaves.push(...(await expandRecipeLeaves(item.itemId, qty, cache)));
        } else {
            // yield: para producir `qty` útil necesito `qty * (100 / yield)` crudo.
            const yieldPct = item.yieldPercent ?? 100;
            const effective = qty * (100 / yieldPct);
            leaves.push({ itemId: item.itemId, quantity: effective, unit: item.unit || null });
        }
    }

    cache.set(recipeId, leaves);
    return leaves;
}

export interface ItemInfo {
    unit: string | null;
    averageCost: number | null;
}

export async function loadItemInfo(
    companyId: string,
    itemIds: string[]
): Promise<Map<string, ItemInfo>> {
    if (itemIds.length === 0) return new Map();
    const rows = await db
        .select({ id: inventoryItems.id, unit: inventoryItems.unit, averageCost: inventoryItems.averageCost })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.companyId, companyId), inArray(inventoryItems.id, itemIds)));
    return new Map(rows.map((r) => [r.id, { unit: r.unit, averageCost: r.averageCost }]));
}

export interface ProduceWithFefoParams {
    companyId: string;
    branchId: string;
    recipeId: string;
    /** Cantidad producida en la unidad de la receta. Se redondea: la columna es integer. */
    quantity: number;
    unit: string;
    recordedBy: string;
    notes?: string;
    /** Orden de producción que se cierra al producir (Task 6). */
    orderId?: string;
    /** Instancia de workflow: activa la idempotencia A9 de `recordProduction`. */
    workflowInstanceId?: string;
    /** Texto que queda en `inventory_waste.origin` para el faltante de lote (T16). */
    shortfallOrigin?: string;
    shortfallNotes?: string;
}

export type ProduceWithFefoOutcome =
    /** La receta no tiene insumos hoja: no hay nada que descontar. */
    | { status: "no-leaves" }
    /** El único parcial dijo que esa producción ya estaba escrita (A9). */
    | { status: "skipped" }
    | {
        status: "produced";
        resultId: string;
        producedQuantity: number;
        ingredientCost: number;
        /** Insumo que el stock no alcanzó a cubrir; ya quedó en `inventory_waste`. */
        shortfalls: { itemId: string; missing: number; unit: string }[];
    };

/**
 * Produce una receta descontando por FEFO dentro de la transacción del llamador.
 *
 * `executor` DEBE ser el `tx` de un `db.transaction`: el `FOR UPDATE` de
 * `allocateFEFO` sólo evita el doble consumo concurrente (R-3) si el lock sigue
 * vivo hasta que `recordProduction` escribe.
 *
 * El faltante (lote insuficiente) NO desaparece en silencio: va a
 * `inventory_waste` con reason OTHER y `origin` propio — auditoría en vez de
 * silencio (T16).
 */
export async function produceRecipeWithFefo(
    executor: DbExecutor,
    params: ProduceWithFefoParams,
    cache: LeafCache = new Map()
): Promise<ProduceWithFefoOutcome> {
    const leaves = await expandRecipeLeaves(params.recipeId, params.quantity, cache);
    if (leaves.length === 0) return { status: "no-leaves" };

    const itemIds = [...new Set(leaves.map((l) => l.itemId))];
    const itemInfo = await loadItemInfo(params.companyId, itemIds);

    const ingredients: Parameters<typeof ProductionService.recordProduction>[0]["ingredients"] = [];
    const shortfallByItem = new Map<string, number>();

    for (const leaf of leaves) {
        // FEFO dentro de la tx: el lock cubre la escritura de recordProduction.
        const allocations: FefoAllocation[] = await allocateFEFO(
            executor,
            leaf.itemId,
            params.branchId,
            leaf.quantity
        );
        const allocated = allocations.reduce((s, a) => s + a.quantity, 0);

        const info = itemInfo.get(leaf.itemId);
        for (const alloc of allocations) {
            // Lote y registro de insumo son ya `numeric(12,4)` (T1 y A7b): la
            // fracción se conserva de punta a punta. `recordProduction` descuenta
            // por `actualQuantity` y guarda ese mismo valor, sin redondear.
            ingredients.push({
                itemId: leaf.itemId,
                batchId: alloc.batchId,
                expectedQuantity: leaf.quantity,
                actualQuantity: alloc.quantity,
                unit: info?.unit || leaf.unit || "UNIT",
                unitCost: alloc.unitCost ?? undefined,
            });
        }

        if (allocated < leaf.quantity) {
            shortfallByItem.set(
                leaf.itemId,
                (shortfallByItem.get(leaf.itemId) ?? 0) + (leaf.quantity - allocated)
            );
        }
    }

    if (ingredients.length === 0) {
        // Sin lotes disponibles: se registra la producción igualmente y TODO el
        // insumo va a la merma por lote insuficiente (señal de auditoría).
        for (const leaf of leaves) {
            shortfallByItem.set(
                leaf.itemId,
                (shortfallByItem.get(leaf.itemId) ?? 0) + leaf.quantity
            );
        }
    }

    const producedQuantity = Math.round(params.quantity);

    const result = await ProductionService.recordProduction(
        {
            companyId: params.companyId,
            branchId: params.branchId,
            orderId: params.orderId,
            recipeId: params.recipeId,
            workflowInstanceId: params.workflowInstanceId,
            producedQuantity,
            unit: params.unit,
            notes: params.notes,
            recordedBy: params.recordedBy,
            ingredients,
        },
        executor
    );

    // null = otra ejecución ya escribió esta producción (A9). Ni lote descontado
    // ni merma que registrar.
    if (!result) return { status: "skipped" };

    const shortfalls: { itemId: string; missing: number; unit: string }[] = [];
    const wasteRows: (typeof inventoryWaste.$inferInsert)[] = [];
    for (const [itemId, missing] of shortfallByItem) {
        if (missing <= 0) continue;
        const info = itemInfo.get(itemId);
        const averageCost = info?.averageCost ?? null;
        const unit = info?.unit || "UNIT";
        shortfalls.push({ itemId, missing, unit });
        wasteRows.push({
            companyId: params.companyId,
            branchId: params.branchId,
            batchId: null,
            itemId,
            quantity: String(missing), // numeric(12,4): string en TS; la fracción se conserva
            unit,
            reason: "OTHER",
            costPerUnit: averageCost,
            totalLoss: averageCost !== null ? Math.round(averageCost * missing) : null,
            recordedBy: params.recordedBy,
            // A9: el origen deja de vivir sólo en el texto de `notes`. Estas
            // filas quedan FUERA del único parcial a propósito — una instancia
            // con dos recetas cortas del mismo insumo escribe dos filas
            // legítimas — y su idempotencia la da el único de
            // `production_results`, que ya cortó arriba si la receta se repetía.
            workflowInstanceId: params.workflowInstanceId ?? null,
            origin: params.shortfallOrigin ?? "lote_insuficiente",
            notes: params.shortfallNotes ?? "Lote insuficiente en producción; motivo=lote_insuficiente",
        });
    }

    if (wasteRows.length > 0) {
        await executor.insert(inventoryWaste).values(wasteRows);
    }

    return {
        status: "produced",
        resultId: result.id,
        producedQuantity,
        ingredientCost: result.ingredientCost,
        shortfalls,
    };
}
