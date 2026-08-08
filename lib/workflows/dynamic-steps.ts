// lib/workflows/dynamic-steps.ts
//
// Resolver genérico de pasos dinámicos. Un paso de plantilla que lleva
// `metadata.dynamicSource` se expande, al crear la instancia, en N sub-pasos
// del MISMO tipo (NUMBER / SELECT / PHOTO / ...) — uno por entidad que cumpla
// el filtro. El id del sub-paso es `{parentId}-{entityId}` y la entidad queda
// embebida en `metadata.entityId`, siguiendo la forma que ya produce
// `StockCountService.generateStockCountSteps`.
//
// No se añade un tipo nuevo a `WorkflowStepType`: esa unión está duplicada en
// 7 archivos y todos los renderers ya saben pintar los tipos generados.

import { db } from "@/lib/db";
import { inventoryItems, recipes } from "@/lib/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { DynamicSource, DynamicSourceFilter, WorkflowStep } from "@/lib/types/workflow";

export interface DynamicResolveContext {
  companyId: string;
  branchId?: string;
}

/** Forma mínima común a las entidades expandibles. */
interface ResolvedEntity {
  id: string;
  name: string;
  sku?: string | null;
  unit?: string | null;
  category?: string | null;
}

/**
 * `true` si algún paso declara `metadata.dynamicSource`. Permite al llamador
 * evitar el trabajo de resolver `companyId` cuando no hay nada que expandir.
 */
export function hasDynamicSteps(steps: unknown): boolean {
  return Array.isArray(steps) && steps.some((s) => !!(s as WorkflowStep)?.metadata?.dynamicSource);
}

async function queryInventoryItems(
  companyId: string,
  filter: DynamicSourceFilter | undefined
): Promise<ResolvedEntity[]> {
  const conditions: SQL[] = [
    eq(inventoryItems.companyId, companyId),
    eq(inventoryItems.active, filter?.active ?? true),
  ];

  if (filter?.isHighValue !== undefined) {
    conditions.push(eq(inventoryItems.isHighValue, filter.isHighValue));
  }
  if (filter?.category) {
    conditions.push(eq(inventoryItems.category, filter.category));
  }
  if (filter?.tags && filter.tags.length > 0) {
    // jsonb containment: el item debe llevar TODAS las etiquetas pedidas.
    conditions.push(sql`${inventoryItems.tags} @> ${JSON.stringify(filter.tags)}::jsonb`);
  }

  return db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      unit: inventoryItems.unit,
      category: inventoryItems.category,
    })
    .from(inventoryItems)
    .where(and(...conditions))
    .orderBy(inventoryItems.name);
}

async function queryRecipes(
  companyId: string,
  filter: DynamicSourceFilter | undefined
): Promise<ResolvedEntity[]> {
  // `recipes` no tiene `active`, `category`, `tags` ni `is_high_value`.
  // Se avisa en vez de fallar en silencio con un filtro que no se aplicó.
  const unsupported = (["isHighValue", "category", "tags", "active"] as const).filter(
    (k) => filter?.[k] !== undefined
  );
  if (unsupported.length > 0) {
    console.warn(
      `[DynamicSteps] Filtros no soportados para entity 'recipe' (ignorados): ${unsupported.join(", ")}`
    );
  }

  return db
    .select({
      id: recipes.id,
      name: recipes.name,
      unit: recipes.unit,
    })
    .from(recipes)
    .where(eq(recipes.companyId, companyId))
    .orderBy(recipes.name);
}

async function loadEntities(source: DynamicSource, ctx: DynamicResolveContext): Promise<ResolvedEntity[]> {
  switch (source.entity) {
    case "inventory_item":
      return queryInventoryItems(ctx.companyId, source.filter);
    case "recipe":
      return queryRecipes(ctx.companyId, source.filter);
    default:
      console.warn(`[DynamicSteps] Entity desconocida: ${String((source as DynamicSource).entity)}`);
      return [];
  }
}

/** Sustituye `{{name}}` / `{{sku}}` / `{{unit}}` en un texto de plantilla. */
function interpolate(text: string, entity: ResolvedEntity): string {
  return text
    .replace(/\{\{\s*name\s*\}\}/g, entity.name)
    .replace(/\{\{\s*sku\s*\}\}/g, entity.sku || "")
    .replace(/\{\{\s*unit\s*\}\}/g, entity.unit || "");
}

function expandStep(parent: WorkflowStep, entity: ResolvedEntity): WorkflowStep {
  const { dynamicSource: _dropped, ...parentMetadata } = parent.metadata || {};

  // Sin placeholders, el título por defecto es el de la entidad — misma forma
  // que los pasos `count-{itemId}` del conteo de inventario.
  const title = parent.title?.includes("{{")
    ? interpolate(parent.title, entity)
    : entity.sku
      ? `${entity.name} (SKU: ${entity.sku})`
      : entity.name;

  const description = parent.description?.includes("{{")
    ? interpolate(parent.description, entity)
    : parent.description;

  return {
    ...parent,
    id: `${parent.id}-${entity.id}`,
    title,
    description,
    unit: entity.unit || parent.unit,
    metadata: {
      ...parentMetadata,
      dynamicParentId: parent.id,
      entityId: entity.id,
      entityName: entity.name,
      ...(entity.sku ? { entitySku: entity.sku } : {}),
    },
  };
}

/**
 * Expande los pasos con `metadata.dynamicSource`. Los demás pasan intactos.
 * Es un no-op (cero queries) si ningún paso declara `dynamicSource`.
 *
 * Cada `dynamicSource` distinto se consulta UNA sola vez, aunque lo declaren
 * varios pasos.
 */
export async function resolveDynamicSteps(
  steps: WorkflowStep[],
  ctx: DynamicResolveContext
): Promise<WorkflowStep[]> {
  if (!Array.isArray(steps) || steps.length === 0) return steps || [];
  if (!hasDynamicSteps(steps)) return steps;

  if (!ctx.companyId) {
    console.warn("[DynamicSteps] Falta companyId: los pasos dinámicos se dejan sin expandir");
    return steps;
  }

  const cache = new Map<string, ResolvedEntity[]>();
  const resolved: WorkflowStep[] = [];

  for (const step of steps) {
    const source = step?.metadata?.dynamicSource;
    if (!source) {
      resolved.push(step);
      continue;
    }

    const cacheKey = JSON.stringify(source);
    let entities = cache.get(cacheKey);
    if (!entities) {
      entities = await loadEntities(source, ctx);
      cache.set(cacheKey, entities);
    }

    if (entities.length === 0) {
      console.warn(
        `[DynamicSteps] Paso '${step.id}' (${source.entity}) no coincidió con ninguna entidad: se omite`
      );
      continue;
    }

    resolved.push(...entities.map((entity) => expandStep(step, entity)));
  }

  return resolved;
}
