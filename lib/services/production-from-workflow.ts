// lib/services/production-from-workflow.ts
//
// Puente entre una instancia de producción diaria completada y el motor de
// producción (T15, `tasks/plan-conteo-produccion-merma.md` Phase 4). Mismo
// patrón que `receiving-from-workflow.ts`: idempotente y sin bloquear al
// operador, despachado por `workflow-extractors` (Inngest). Ya NO es
// best-effort: propaga errores (A2/R-5).
//
// El template declara un paso dinámico `prod-qty` sobre `entity: 'recipe'`
// (filtro por tag `receta_activa`); `resolveDynamicSteps` lo expande a N
// sub-pasos `prod-qty-{recipeId}` — uno por receta etiquetada.
//
// Por cada receta con porciones capturadas:
//   1. Expande `recipe_items` con recursión de sub-recetas (misma forma que
//      `TheoreticalConsumptionService.deductRecipeIngredients`), aplicando
//      `baseYield` y `yieldPercent`.
//   2. Corre `allocateFEFO` por insumo dentro de la MISMA transacción que
//      escribe — el `FOR UPDATE` evita doble consumo concurrente (R-3).
//   3. Llama `recordProduction` con un `ingredients[]` por par (item, lote).
//      El descuento lo hace exclusivamente `recordProduction` (R-4): aquí no
//      se vuelve a tocar ningún lote.
//   4. El faltante (lote insuficiente) va a `inventory_waste` con reason
//      OTHER y `motivo=lote_insuficiente` — auditoría en vez de silencio (T16).

import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowInstanceSteps,
  workflowTemplates,
  branches,
  users,
  inventoryItems,
  recipes,
  recipeItems,
  inventoryWaste,
} from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { ProductionService } from "./production-service";
import { allocateFEFO, type FefoAllocation } from "./fefo-allocator";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("services:production-from-workflow");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LeafRequirement {
  itemId: string;
  /** Cantidad bruta necesaria, con yield aplicado (antes de conversión de unidad). */
  quantity: number;
  unit: string | null;
}

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
async function expandRecipeLeaves(
  recipeId: string,
  quantityNeeded: number,
  cache: Map<string, LeafRequirement[]>
): Promise<LeafRequirement[]> {
  const perUnit = await leavesPerUnit(recipeId, cache);
  return perUnit.map((leaf) => ({ ...leaf, quantity: leaf.quantity * quantityNeeded }));
}

/**
 * Hojas necesarias para producir **una unidad** de la receta (`baseYield`
 * dividido ya aplicado). Es lo único que se cachea.
 */
async function leavesPerUnit(
  recipeId: string,
  cache: Map<string, LeafRequirement[]>
): Promise<LeafRequirement[]> {
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

async function loadItemInfo(
  companyId: string,
  itemIds: string[]
): Promise<Map<string, { unit: string | null; averageCost: number | null }>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
    .select({ id: inventoryItems.id, unit: inventoryItems.unit, averageCost: inventoryItems.averageCost })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.companyId, companyId), inArray(inventoryItems.id, itemIds)));
  return new Map(rows.map((r) => [r.id, { unit: r.unit, averageCost: r.averageCost }]));
}

export async function extractProductionFromInstance(instanceId: string): Promise<void> {
  try {
    const instance = await db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, instanceId),
    });
    if (!instance) return;
    if (instance.status !== "COMPLETED") return;

    const rawSteps = await db
      .select({
        stepId: workflowInstanceSteps.stepId,
        value: workflowInstanceSteps.value,
      })
      .from(workflowInstanceSteps)
      .where(eq(workflowInstanceSteps.instanceId, instanceId));

    // `prod-qty-{recipeId}` → porciones a producir.
    const portionsByRecipe = new Map<string, number>();
    for (const step of rawSteps) {
      if (!step.stepId.startsWith("prod-qty-")) continue;
      const recipeId = step.stepId.slice(-36);
      if (!UUID_RE.test(recipeId)) continue;

      const raw = step.value;
      let value: unknown = raw;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed) {
          try {
            value = JSON.parse(trimmed);
          } catch {
            value = trimmed;
          }
        }
      }
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) portionsByRecipe.set(recipeId, n);
    }
    if (portionsByRecipe.size === 0) return;

    // A9 — la idempotencia ya NO se chequea aquí. El `SELECT ... notes LIKE`
    // que vivía en este punto era un check-then-insert no atómico: dos
    // ejecuciones simultáneas leían las dos "no existe" y escribían las dos, y
    // en producción eso descontaba el lote por duplicado. Ahora la guarda es el
    // único parcial `(workflow_instance_id, recipe_id)` que `recordProduction`
    // resuelve con `onConflictDoNothing` ANTES de tocar ningún lote: si
    // devuelve null, esta receta de esta instancia ya estaba procesada.

    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, instance.workflowTemplateId),
    });
    let companyId = template?.companyId || "";
    if (!companyId) {
      const branch = await db.query.branches.findFirst({
        where: eq(branches.id, instance.branchId),
      });
      companyId = branch?.companyId || "";
    }
    if (!companyId) {
      logger.warn({ instanceId, branchId: instance.branchId }, "Sin companyId: se omite");
      return;
    }

    const recordedBy = instance.assigneeId
      ? (await db.query.users.findFirst({ where: eq(users.id, instance.assigneeId) }))?.id ?? "system"
      : "system";

    const notes = `Producción diaria desde workflow; instance:${instanceId}`;
    const leafCache = new Map<string, LeafRequirement[]>();

    await db.transaction(async (tx) => {
      for (const [recipeId, portions] of portionsByRecipe) {
        const leaves = await expandRecipeLeaves(recipeId, portions, leafCache);
        if (leaves.length === 0) {
          logger.warn({ instanceId, recipeId }, "Receta sin insumos hoja: se omite");
          continue;
        }

        const itemIds = [...new Set(leaves.map((l) => l.itemId))];
        const itemInfo = await loadItemInfo(companyId, itemIds);

        // Porciones capturadas son enteras (NUMBER); `producedQuantity` es integer.
        const producedQuantity = Math.round(portions);
        const [recipe] = await db
          .select({ name: recipes.name, unit: recipes.unit })
          .from(recipes)
          .where(eq(recipes.id, recipeId));
        const unit = recipe?.unit || "PORTION";

        const ingredients: Parameters<typeof ProductionService.recordProduction>[0]["ingredients"] = [];
        const shortfallByItem = new Map<string, number>();

        for (const leaf of leaves) {
          // FEFO dentro de la tx: el lock cubre la escritura de recordProduction.
          const allocations: FefoAllocation[] = await allocateFEFO(
            tx,
            leaf.itemId,
            instance.branchId,
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

        const result = await ProductionService.recordProduction(
          {
            companyId,
            branchId: instance.branchId,
            recipeId,
            workflowInstanceId: instanceId,
            producedQuantity,
            unit,
            notes,
            recordedBy,
            ingredients,
          },
          tx
        );

        // null = otra ejecución ya escribió esta receta para esta instancia.
        // Ni lote descontado ni merma que registrar: se pasa a la siguiente.
        if (!result) {
          logger.info({ instanceId, recipeId }, "La receta de esta instancia ya estaba procesada: se omite");
          continue;
        }

        // Lote insuficiente → merma (T16): el faltante no desaparece en silencio.
        const wasteRows: (typeof inventoryWaste.$inferInsert)[] = [];
        for (const [itemId, missing] of shortfallByItem) {
          if (missing <= 0) continue;
          const info = itemInfo.get(itemId);
          const averageCost = info?.averageCost ?? null;
          wasteRows.push({
            companyId,
            branchId: instance.branchId,
            batchId: null,
            itemId,
            quantity: String(missing), // numeric(12,4): string en TS; la fracción se conserva
            unit: info?.unit || "UNIT",
            reason: "OTHER",
            costPerUnit: averageCost,
            totalLoss: averageCost !== null ? Math.round(averageCost * missing) : null,
            recordedBy,
            // A9: el origen deja de vivir sólo en el texto de `notes`. Estas
            // filas quedan FUERA del único parcial a propósito — una instancia
            // con dos recetas cortas del mismo insumo escribe dos filas
            // legítimas — y su idempotencia la da el único de
            // `production_results`, que ya cortó arriba si la receta se repetía.
            workflowInstanceId: instanceId,
            origin: "lote_insuficiente",
            notes: `Lote insuficiente en producción; instance:${instanceId}; motivo=lote_insuficiente`,
          });
        }

        if (wasteRows.length > 0) {
          await tx.insert(inventoryWaste).values(wasteRows);
        }

        logger.info(
          {
            instanceId,
            companyId,
            branchId: instance.branchId,
            recipeId,
            producedQuantity,
            unit,
            descuentos: ingredients.length,
            mermas: wasteRows.length,
            shortfalls: result.shortfalls.length,
          },
          "Receta producida"
        );
      }
    });

    logger.info({ instanceId, companyId, recetas: portionsByRecipe.size }, "Producción persistida");
  } catch (error) {
    logger.error({ instanceId, err: String(error) }, "Error persistiendo la producción");
    // R-5: el error se propaga a propósito. Antes moría aquí y la corrida
    // quedaba indistinguible de un éxito. Ahora el llamador es
    // `workflow-extractors` (Inngest), que lo convierte en un run FALLIDO y
    // reintenta sólo este extractor. `completeStockCount` —el otro llamador—
    // ya trae su propio try/catch, así que su ruta no cambia.
    throw error;
  }
}