// lib/services/stock-count-from-workflow.ts
//
// Puente entre una instancia de conteo completada y la tabla `stock_counts`.
// Mismo patrón que `receiving-from-workflow.ts`: no bloquea al operador —lo
// despacha `workflow-extractors` (Inngest) al completar la instancia— y es
// idempotente. Ya NO es best-effort: los errores se propagan (A2/R-5).
//
// Cubre los DOS orígenes de pasos de conteo:
//   1. `StockCountService.generateStockCountSteps` — pasos `count-{itemId}`
//      cuyo `value` es el JSON `{systemQuantity, itemId, inputValue}`.
//   2. `resolveDynamicSteps` — pasos `{parentId}-{entityId}` de un template con
//      `metadata.dynamicSource`. Al completarse por la vía genérica el `value`
//      queda plano (el JSON de metadata se sobrescribe), así que el ítem se
//      recupera del sufijo UUID del propio `stepId`.
//
// NO aplica ajustes de inventario: eso sigue siendo exclusivo de
// `StockCountService.applyStockCountAdjustments`, que exige aprobación humana.

import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowInstanceSteps,
  workflowTemplates,
  branches,
  users,
  inventoryItems,
  inventoryBatches,
  stockCounts,
  inventoryWaste,
  tenantOperatingConfig,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { roundQty } from "./stock-count-service";
import { localDateString } from "@/lib/workflows/today";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fila lista para insertar, ya normalizada desde el paso correspondiente. */
interface ParsedCount {
  itemId: string;
  countedQuantity: number;
  /** `null` cuando el paso no la traía: se resuelve después contra los lotes. */
  systemQuantity: number | null;
  evidenceUrl: string | null;
}

function parseStepValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function toQty(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? roundQty(n) : null;
}

/**
 * Extrae el itemId de un paso de conteo: primero del payload, y si no,
 * del sufijo UUID del `stepId` (`count-{itemId}` / `{parentId}-{entityId}`).
 */
function resolveItemId(stepId: string, parsed: unknown): string | null {
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    for (const key of ["itemId", "entityId"]) {
      const v = p[key];
      if (typeof v === "string" && UUID_RE.test(v)) return v;
    }
  }
  // El id de la entidad es siempre el ÚLTIMO segmento tipo UUID del stepId.
  const suffix = stepId.slice(-36);
  return UUID_RE.test(suffix) ? suffix : null;
}

/** Convierte un paso de conteo en fila, o `null` si no es un paso de conteo. */
function parseCountStep(step: { stepId: string; value: unknown }): ParsedCount | null {
  if (!step.stepId.startsWith("count-")) return null;

  const parsed = parseStepValue(step.value);
  const itemId = resolveItemId(step.stepId, parsed);
  if (!itemId) return null;

  let countedQuantity: number | null;
  let systemQuantity: number | null = null;
  let evidenceUrl: string | null = null;

  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    countedQuantity = toQty(p.inputValue ?? p.value);
    systemQuantity = toQty(p.systemQuantity);
    const url = p.evidenceUrl ?? p.photoUrl ?? p.url;
    if (typeof url === "string" && url.startsWith("http")) evidenceUrl = url;
  } else {
    countedQuantity = toQty(parsed);
  }

  // Un paso sin cantidad capturada no es un conteo: no inventamos un 0 que
  // luego se leería como "contamos y no había nada".
  if (countedQuantity === null) return null;

  return { itemId, countedQuantity, systemQuantity, evidenceUrl };
}

/** Stock disponible por ítem en la sucursal — misma definición que `getProductsWithStock`. */
async function loadCurrentStock(branchId: string, itemIds: string[]): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();

  const rows = await db
    .select({
      itemId: inventoryBatches.itemId,
      qty: sql<string>`COALESCE(sum(${inventoryBatches.currentQuantity}), 0)`,
    })
    .from(inventoryBatches)
    .where(
      and(
        eq(inventoryBatches.branchId, branchId),
        eq(inventoryBatches.status, "AVAILABLE"),
        inArray(inventoryBatches.itemId, itemIds)
      )
    )
    .groupBy(inventoryBatches.itemId);

  return new Map(rows.map((r) => [r.itemId, roundQty(parseFloat(String(r.qty)))]));
}

/**
 * Persiste en `stock_counts` los resultados de una instancia de conteo
 * completada. Idempotente por el único parcial `(workflowInstanceId, itemId)`:
 * volver a llamarla actualiza la fila en vez de duplicarla.
 *
 * Propaga el error (R-5). Ya no corre como `void` tras la respuesta sino
 * dentro de `workflow-extractors` (Inngest), que lo reintenta y lo deja
 * visible como run fallido.
 */
export async function extractStockCountFromInstance(instanceId: string): Promise<void> {
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

    const parsedByItem = new Map<string, ParsedCount>();
    for (const step of rawSteps) {
      const parsed = parseCountStep(step);
      // Si el mismo ítem apareciera dos veces, gana el último paso: el único
      // de la tabla es por (instancia, ítem) y no admite dos filas.
      if (parsed) parsedByItem.set(parsed.itemId, parsed);
    }
    if (parsedByItem.size === 0) return;

    // La compañía sale del template; si el template no la lleva, de la sucursal.
    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, instance.workflowTemplateId),
    });
    // La sucursal se consulta siempre: su huso decide la fecha operativa (A4).
    const branch = await db.query.branches.findFirst({
      where: eq(branches.id, instance.branchId),
    });
    const companyId = template?.companyId || branch?.companyId || "";
    if (!companyId) {
      console.warn(`[StockCountFromWorkflow] Sin companyId para instancia ${instanceId}: se omite`);
      return;
    }

    // Sólo ítems que existan y pertenezcan a la compañía — las FK de
    // `stock_counts` lo exigen y un stepId manipulado no debe tumbar el insert.
    const candidateIds = [...parsedByItem.keys()];
    const validItems = await db
      .select({
        id: inventoryItems.id,
        unit: inventoryItems.unit,
        averageCost: inventoryItems.averageCost,
      })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.companyId, companyId), inArray(inventoryItems.id, candidateIds)));
    const validIds = new Set(validItems.map((i) => i.id));
    const itemsById = new Map(validItems.map((i) => [i.id, i]));

    // Respaldo para `systemQuantity` cuando el paso no la trae (pasos dinámicos
    // genéricos): el stock que los lotes reportan ahora.
    const missingSystemQty = candidateIds.filter(
      (id) => validIds.has(id) && parsedByItem.get(id)!.systemQuantity === null
    );
    const currentStock = await loadCurrentStock(instance.branchId, missingSystemQty);

    const countedBy = instance.assigneeId
      ? (await db.query.users.findFirst({ where: eq(users.id, instance.assigneeId) }))?.id ?? null
      : null;

    // A4/O-2: la fecha operativa es la del huso de la SUCURSAL, no UTC. En
    // UTC-6 un cierre a las 18:30 se sellaba con la fecha de mañana y el
    // snapshot del día ya no lo encontraba: `countedStock` y `variance` NULL
    // justo para el conteo de cierre, que es el caso normal.
    const countDate = localDateString(instance.completedAt ?? new Date(), branch?.timezone);

    const rows = candidateIds
      .filter((id) => validIds.has(id))
      .map((id) => {
        const p = parsedByItem.get(id)!;
        return {
          companyId,
          branchId: instance.branchId,
          itemId: id,
          workflowInstanceId: instanceId,
          countedQuantity: String(p.countedQuantity),
          systemQuantity: String(p.systemQuantity ?? currentStock.get(id) ?? 0),
          evidenceUrl: p.evidenceUrl,
          countedBy,
          countDate,
        };
      });

    if (rows.length === 0) return;

    await db
      .insert(stockCounts)
      .values(rows)
      .onConflictDoUpdate({
        target: [stockCounts.workflowInstanceId, stockCounts.itemId],
        targetWhere: sql`${stockCounts.workflowInstanceId} IS NOT NULL`,
        set: {
          countedQuantity: sql`excluded.counted_quantity`,
          systemQuantity: sql`excluded.system_quantity`,
          evidenceUrl: sql`excluded.evidence_url`,
          countedBy: sql`excluded.counted_by`,
          countDate: sql`excluded.count_date`,
        },
      });

    console.log(
      `[StockCountFromWorkflow] ${rows.length} conteos persistidos para instancia ${instanceId}`
    );

    // T12 — merma automática por varianza: si el faltante supera el umbral del
    // tenant (mermaVarianceThresholdPct, default 5%), la diferencia se registra
    // como merma con motivo OTHER y origen `diferencia_conteo`. El sobrante
    // NUNCA genera merma. No mueve stock: `applyStockCountAdjustments` sigue
    // siendo el único punto que escribe ajustes (aprobación humana).
    await maybeCreateMermaFromVariance({
      instanceId,
      companyId,
      branchId: instance.branchId,
      counts: rows.map((r) => ({
        itemId: r.itemId,
        counted: Number(r.countedQuantity),
        system: Number(r.systemQuantity),
      })),
      itemsById,
      recordedBy: countedBy,
    });
  } catch (error) {
    console.error(
      `[StockCountFromWorkflow] Error persistiendo conteo de instancia ${instanceId}:`,
      error
    );
    // R-5: el error se propaga a propósito. Antes moría aquí y la corrida
    // quedaba indistinguible de un éxito. Ahora el llamador es
    // `workflow-extractors` (Inngest), que lo convierte en un run FALLIDO y
    // reintenta sólo este extractor. `completeStockCount` —el otro llamador—
    // ya trae su propio try/catch, así que su ruta no cambia.
    throw error;
  }
}

/**
 * T12 — convierte una varianza negativa (faltante) que supera el umbral en
 * una fila de `inventory_waste`. Idempotente por el marcador
 * `instance:{id}; origen=diferencia_conteo` en `notes` (AD-4).
 */
async function maybeCreateMermaFromVariance(params: {
  instanceId: string;
  companyId: string;
  branchId: string;
  counts: { itemId: string; counted: number; system: number }[];
  itemsById: Map<string, { unit: string | null; averageCost: number | null }>;
  recordedBy: string | null;
}): Promise<void> {
  const { instanceId, companyId, branchId, counts, itemsById, recordedBy } = params;

  const cfg = await db.query.tenantOperatingConfig.findFirst({
    where: eq(tenantOperatingConfig.companyId, companyId),
  });
  const thresholdPct = cfg?.mermaVarianceThresholdPct
    ? Number(cfg.mermaVarianceThresholdPct)
    : 5;

  const wasteRows: (typeof inventoryWaste.$inferInsert)[] = [];
  for (const c of counts) {
    if (c.system <= 0) continue; // sin stock calculado no hay % que medir

    const variancePct = ((c.counted - c.system) / c.system) * 100;
    if (variancePct >= 0) continue; // sobrante nunca genera merma
    if (Math.abs(variancePct) <= thresholdPct) continue; // dentro de tolerancia

    const missing = c.system - c.counted; // faltante, positivo
    if (missing <= 0) continue;

    const item = itemsById.get(c.itemId);
    const averageCost = item?.averageCost ?? null;
    wasteRows.push({
      companyId,
      branchId,
      batchId: null,
      itemId: c.itemId,
      quantity: String(missing), // numeric(12,4): string en TS; la fracción se conserva
      unit: item?.unit || "UNIT",
      reason: "OTHER",
      costPerUnit: averageCost,
      totalLoss: averageCost !== null ? Math.round(averageCost * missing) : null,
      recordedBy: recordedBy || "system",
      notes: `Varianza de conteo; instance:${instanceId}; origen=diferencia_conteo`,
    });
  }

  if (wasteRows.length === 0) return;

  // Idempotencia: el marcador del instance ya está en el histórico.
  const existing = await db
    .select({ id: inventoryWaste.id })
    .from(inventoryWaste)
    .where(
      sql`${inventoryWaste.notes} LIKE ${`%instance:${instanceId}%origen=diferencia_conteo%`}`
    )
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(inventoryWaste).values(wasteRows);
  console.log(
    `[StockCountFromWorkflow] ${wasteRows.length} mermas automáticas por varianza (instancia ${instanceId})`
  );
}
