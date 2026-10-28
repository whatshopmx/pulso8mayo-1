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
//   2. `produceRecipeWithFefo`: hojas → `recordProduction`, que dentro de la
//      transacción del llamador aplica elegibilidad FEFO, conversión de unidad,
//      descuento, kardex USAGE y cierre de orden. Aquí no se toca ningún lote:
//      el registro manual y el automático son el MISMO servicio (FEFO-04B-3a).
//      El faltante físico rechaza la producción completa y ya no fabrica merma.

import { db } from "@/lib/db";
import { inventoryItems, recipeItems, recipes } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "./fefo-allocator";
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
    /** Texto que quedaba en `inventory_waste` (T16). Sin efecto desde FEFO-04B-3:
     *  el faltante ya no genera merma, rechaza la producción completa. */
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
        /** Siempre vacío: desde FEFO-04B-3 un faltante rechaza la producción. */
        shortfalls: { itemId: string; missing: number; unit: string }[];
    };

/**
 * Produce una receta descontando por FEFO dentro de la transacción del llamador.
 *
 * `executor` DEBE ser el `tx` de un `db.transaction`: el `FOR UPDATE` de
 * `allocateScopedBatches` —que ahora ejecuta `recordProduction`— sólo evita el
 * doble consumo concurrente (R-3) si el lock sigue vivo hasta la escritura.
 *
 * La unidad de cada línea de receta se conserva como unidad de ORIGEN: la
 * conversión a la unidad del insumo la hace `recordProduction` con la tabla de
 * conversiones de la empresa. Antes se sustituía por la unidad del insumo y la
 * cantidad viajaba sin convertir.
 */
export async function produceRecipeWithFefo(
    executor: DbExecutor,
    params: ProduceWithFefoParams,
    cache: LeafCache = new Map()
): Promise<ProduceWithFefoOutcome> {
    const leaves = await expandRecipeLeaves(params.recipeId, params.quantity, cache);
    if (leaves.length === 0) return { status: "no-leaves" };

    const itemInfo = await loadItemInfo(
        params.companyId,
        [...new Set(leaves.map((leaf) => leaf.itemId))]
    );

    const ingredients: Parameters<typeof ProductionService.recordProduction>[0]["ingredients"] = leaves.map((leaf) => ({
        itemId: leaf.itemId,
        expectedQuantity: leaf.quantity,
        actualQuantity: leaf.quantity,
        // La unidad de la línea es la de origen. Sólo si no la declara se cae a
        // la del insumo, que es el destino y no requiere conversión.
        unit: leaf.unit ?? itemInfo.get(leaf.itemId)?.unit ?? "UNIT",
    }));

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
    // ni movimiento que registrar.
    if (!result) return { status: "skipped" };

    return {
        status: "produced",
        resultId: result.id,
        producedQuantity,
        ingredientCost: result.ingredientCost,
        shortfalls: [],
    };
}
