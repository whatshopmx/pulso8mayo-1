// lib/services/merma-from-workflow.ts
//
// Puente entre una instancia de merma completada y `inventory_waste` (T11,
// `tasks/plan-conteo-produccion-merma.md` Phase 3). Mismo patrón que
// `receiving-from-workflow.ts` / `stock-count-from-workflow.ts`: lo despacha
// `workflow-extractors` (Inngest) al completar la instancia, no bloquea al
// operador y es idempotente. Ya NO es best-effort: propaga errores (A2/R-5).
//
// El template de merma declara TRES pasos dinámicos sobre `inventory_item`
// (filtro por tag `merma`), que `resolveDynamicSteps` expande a N sub-pasos
// `{parent}-{itemId}`:
//   - `merma-qty-{itemId}`       → cantidad en merma (NUMBER; 0 = no aplica)
//   - `merma-reason-{itemId}`    → motivo (SELECT: caducidad/caida/error_cocina/cortesia)
//   - `merma-evidence-{itemId}`  → foto de la merma (PHOTO, obligatoria)
//
// Sólo se crea la fila si motivo Y cantidad > 0 están presentes. La evidencia
// se exige a nivel de paso (`required: true`): el flujo no se completa sin
// foto, así que aquí la URL se guarda si vino, sin bloquear la extracción.
//
// NO mueve inventario: la baja del lote sigue siendo competencia del operador
// (o de la merma automática por varianza de conteo, T12).

import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowInstanceSteps,
  workflowTemplates,
  branches,
  users,
  inventoryItems,
  inventoryBatches,
  inventoryWaste,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import type { inventoryWasteReasonEnum } from "@/lib/db/schema";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("services:merma-from-workflow");

type WasteReason = (typeof inventoryWasteReasonEnum.enumValues)[number];

/** Claves del template → enum de `inventory_waste_reason` (OQ-1: cortesía = COURTESY, no merma). */
const REASON_MAP: Record<string, WasteReason> = {
  caducidad: "EXPIRED",
  vencido: "EXPIRED",
  caducado: "EXPIRED",
  caida: "SPILLAGE",
  derrame: "SPILLAGE",
  error_cocina: "QUALITY",
  error_de_cocina: "QUALITY",
  mala_preparacion: "QUALITY",
  cortesia: "COURTESY",
};

/** Normaliza el valor del SELECT: minúsculas, sin acentos, espacios → `_`. */
function normalizeReasonKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/\s+/g, "_");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return Number.isFinite(n) ? n : null;
}

function toUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.startsWith("[") ? (JSON.parse(value)[0] ?? null) : value;
  return typeof v === "string" && v.startsWith("http") ? v : null;
}

interface ParsedMerma {
  itemId: string;
  quantity: number;
  reasonKey: string;
  evidenceUrl: string | null;
}

/** Extrae (itemId, quantity/reason/evidence) de los pasos `merma-*-{itemId}`. */
function parseMermaSteps(steps: { stepId: string; value: unknown }[]): Map<string, ParsedMerma> {
  const byItem = new Map<string, ParsedMerma>();

  for (const step of steps) {
    // El id de la entidad es el ÚLTIMO segmento tipo UUID del stepId.
    const suffix = step.stepId.slice(-36);
    if (!UUID_RE.test(suffix)) continue;

    const prefix = step.stepId.slice(0, -37); // quita `-{uuid}`
    const parsed = parseStepValue(step.value);
    const p = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

    let current = byItem.get(suffix);
    if (!current) {
      current = { itemId: suffix, quantity: 0, reasonKey: "", evidenceUrl: null };
      byItem.set(suffix, current);
    }

    if (prefix.startsWith("merma-qty")) {
      const qty = toQty(p.inputValue ?? p.value ?? parsed);
      if (qty !== null) current.quantity = qty;
    } else if (prefix.startsWith("merma-reason")) {
      const reason = String(p.inputValue ?? p.value ?? parsed ?? "").trim();
      if (reason) current.reasonKey = reason;
    } else if (prefix.startsWith("merma-evidence")) {
      const url = toUrl(p.evidenceUrl ?? p.photoUrl ?? p.value ?? parsed);
      if (url) current.evidenceUrl = url;
    }
  }

  return byItem;
}

export async function extractMermaFromInstance(instanceId: string): Promise<void> {
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

    const byItem = parseMermaSteps(rawSteps);
    if (byItem.size === 0) return;

    // A9 — la idempotencia ya NO se chequea aquí. El `SELECT ... notes LIKE`
    // que vivía en este punto era un check-then-insert no atómico: dos
    // ejecuciones simultáneas leían las dos "no existe" y duplicaban la merma.
    // Ahora la guarda es el único parcial
    // `(workflow_instance_id, item_id, origin)` con `onConflictDoNothing`.

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

    // Motivo obligatorio: un item capturado sin motivo no es merma.
    const validItems: ParsedMerma[] = [];
    for (const m of byItem.values()) {
      const reason = REASON_MAP[normalizeReasonKey(m.reasonKey)];
      if (!reason) {
        logger.warn(
          { instanceId, itemId: m.itemId, motivo: m.reasonKey },
          "Motivo de merma desconocido: se omite el item"
        );
        continue;
      }
      if (m.quantity <= 0) continue;
      validItems.push({ ...m, reasonKey: reason });
    }
    if (validItems.length === 0) return;

    // Sólo ítems que existan y pertenezcan a la compañía.
    const itemRows = await db
      .select({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.companyId, companyId),
          inArray(inventoryItems.id, validItems.map((v) => v.itemId))
        )
      );
    const itemsById = new Map(itemRows.map((i) => [i.id, i]));

    // unitCost del último lote AVAILABLE para costear la merma (opcional).
    const batches = await db
      .select({
        itemId: inventoryBatches.itemId,
        unitCost: inventoryBatches.unitCost,
      })
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.branchId, instance.branchId),
          eq(inventoryBatches.status, "AVAILABLE"),
          inArray(
            inventoryBatches.itemId,
            validItems.map((v) => v.itemId)
          ),
          sql`${inventoryBatches.unitCost} IS NOT NULL`
        )
      )
      .orderBy(inventoryBatches.createdAt);
    const costByItem = new Map<string, number>();
    for (const b of batches) {
      if (!costByItem.has(b.itemId)) costByItem.set(b.itemId, Number(b.unitCost));
    }

    const recordedBy = instance.assigneeId
      ? (await db.query.users.findFirst({ where: eq(users.id, instance.assigneeId) }))?.id ?? "system"
      : "system";

    const rows = validItems
      .map((m) => {
        const item = itemsById.get(m.itemId);
        if (!item) return null;
        const unitCost = costByItem.get(m.itemId) ?? null;
        return {
          companyId,
          branchId: instance.branchId,
          batchId: null,
          itemId: m.itemId,
          quantity: String(m.quantity), // numeric(12,4): string en TS; la fracción se conserva
          unit: item.unit || "UNIT",
          reason: m.reasonKey as WasteReason,
          costPerUnit: unitCost,
          totalLoss: unitCost !== null ? Math.round(unitCost * m.quantity) : null,
          recordedBy,
          // A9: instancia y origen en columnas, no sólo en el texto de `notes`.
          workflowInstanceId: instanceId,
          origin: "workflow_merma",
          notes: `Merma registrada desde workflow; instance:${instanceId}; origen=workflow_merma`,
        };
      })
      .filter((r) => r !== null);

    if (rows.length === 0) return;

    // El conflicto contra el único parcial significa "otra ejecución ya la
    // escribió": no es un error, es la idempotencia haciendo su trabajo. Se
    // registra lo que REALMENTE se insertó, no lo que se intentó: un log que
    // canta 3 cuando escribió 0 es justo lo que vuelve invisible este defecto.
    const insertadas = await db
      .insert(inventoryWaste)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: inventoryWaste.id });
    logger.info(
      { instanceId, companyId, branchId: instance.branchId, escritas: insertadas.length, candidatas: rows.length },
      "Mermas persistidas"
    );
  } catch (error) {
    logger.error({ instanceId, err: String(error) }, "Error persistiendo la merma");
    // R-5: el error se propaga a propósito. Antes moría aquí y la corrida
    // quedaba indistinguible de un éxito. Ahora el llamador es
    // `workflow-extractors` (Inngest), que lo convierte en un run FALLIDO y
    // reintenta sólo este extractor. `completeStockCount` —el otro llamador—
    // ya trae su propio try/catch, así que su ruta no cambia.
    throw error;
  }
}