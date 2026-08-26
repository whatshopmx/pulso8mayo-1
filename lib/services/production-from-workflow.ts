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
//   1. Explosión de la receta (sub-recetas, `baseYield`, `yieldPercent`),
//   2. `allocateFEFO` por insumo dentro de la MISMA transacción que escribe,
//   3. `recordProduction` con un `ingredients[]` por par (item, lote), y
//   4. el faltante por lote insuficiente a `inventory_waste`
//
// ...ya no viven aquí: son `produceRecipeWithFefo` en `recipe-production.ts`.
// Task 6 (prep list §6.2) completa una línea por ese mismo camino, y dos copias
// del cálculo es exactamente la regresión que este workstream ya corrigió tres
// veces. Este archivo se queda con lo suyo: leer los pasos de la instancia.

import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowInstanceSteps,
  workflowTemplates,
  branches,
  users,
  recipes,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { produceRecipeWithFefo, type LeafCache } from "./recipe-production";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("services:production-from-workflow");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const leafCache: LeafCache = new Map();

    await db.transaction(async (tx) => {
      for (const [recipeId, portions] of portionsByRecipe) {
        const [recipe] = await db
          .select({ name: recipes.name, unit: recipes.unit })
          .from(recipes)
          .where(eq(recipes.id, recipeId));
        const unit = recipe?.unit || "PORTION";

        // Explosión + FEFO + merma por lote insuficiente viven en
        // `recipe-production.ts`: Task 6 completa una línea de la prep list con
        // exactamente el mismo camino y no puede ser una segunda copia.
        // Porciones capturadas son enteras (NUMBER); el redondeo a integer de
        // `producedQuantity` lo hace el helper.
        const outcome = await produceRecipeWithFefo(
          tx,
          {
            companyId,
            branchId: instance.branchId,
            recipeId,
            quantity: portions,
            unit,
            recordedBy,
            notes,
            workflowInstanceId: instanceId,
            shortfallNotes: `Lote insuficiente en producción; instance:${instanceId}; motivo=lote_insuficiente`,
          },
          leafCache
        );

        if (outcome.status === "no-leaves") {
          logger.warn({ instanceId, recipeId }, "Receta sin insumos hoja: se omite");
          continue;
        }
        if (outcome.status === "skipped") {
          logger.info({ instanceId, recipeId }, "La receta de esta instancia ya estaba procesada: se omite");
          continue;
        }

        logger.info(
          {
            instanceId,
            companyId,
            branchId: instance.branchId,
            recipeId,
            producedQuantity: outcome.producedQuantity,
            unit,
            mermas: outcome.shortfalls.length,
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