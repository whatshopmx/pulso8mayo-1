// lib/services/production-from-workflow.ts
//
// Puente entre una instancia de producción diaria completada y el motor de
// producción (T15, `tasks/plan-conteo-produccion-merma.md` Phase 4). Mismo
// patrón que `receiving-from-workflow.ts`: best-effort, idempotente, no
// bloquea al operador.
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
  productionResults,
  inventoryWaste,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { ProductionService } from "./production-service";
import { allocateFEFO, type FefoAllocation } from "./fefo-allocator";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LeafRequirement {
  itemId: string;
  /** Cantidad bruta necesaria, con yield aplicado (antes de conversión de unidad). */
  quantity: number;
  unit: string | null;
}

/** Expande una receta en sus insumos hoja, recursando sub-recetas. */
async function expandRecipeLeaves(
  recipeId: string,
  quantityNeeded: number,
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
  const scale = quantityNeeded / baseYield;

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
    const qty = parseFloat(String(item.quantity)) * scale;

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

    // Idempotencia (AD-4): la instancia ya se procesó si dejó un resultado con
    // el marcador en `notes`. `recordProduction` también escribe `notes`.
    const existing = await db
      .select({ id: productionResults.id })
      .from(productionResults)
      .where(sql`${productionResults.notes} LIKE ${`%instance:${instanceId}%`}`)
      .limit(1);
    if (existing.length > 0) return;

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
      console.warn(`[ProductionFromWorkflow] Sin companyId para instancia ${instanceId}: se omite`);
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
          console.warn(
            `[ProductionFromWorkflow] Receta ${recipeId} sin insumos hoja: se omite`
          );
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
            // El lote ya es numeric(12,4) (T1): la fracción se conserva en el
            // descuento del lote (`recordProduction` descuenta por
            // `actualQuantity`). La columna `production_ingredients.actual_quantity`
            // sigue siendo integer; el redondeo explícito vive ahí, en el insert.
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
            producedQuantity,
            unit,
            notes,
            recordedBy,
            ingredients,
          },
          tx
        );

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
            notes: `Lote insuficiente en producción; instance:${instanceId}; motivo=lote_insuficiente`,
          });
        }

        if (wasteRows.length > 0) {
          await tx.insert(inventoryWaste).values(wasteRows);
        }

        console.log(
          `[ProductionFromWorkflow] Receta ${recipeId} × ${producedQuantity} ${unit}: ` +
            `${ingredients.length} descuentos de lote, ${wasteRows.length} mermas (instancia ${instanceId})`,
          result.shortfalls.length > 0 ? `shortfalls: ${result.shortfalls.length}` : ""
        );
      }
    });

    console.log(`[ProductionFromWorkflow] Producción persistida para instancia ${instanceId}`);
  } catch (error) {
    console.error(`[ProductionFromWorkflow] Error persistiendo producción de instancia ${instanceId}:`, error);
  }
}