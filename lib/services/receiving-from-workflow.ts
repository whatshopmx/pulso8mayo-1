// lib/services/receiving-from-workflow.ts
// Fase 5 (capa dinero): puente entre el template de recepción de mercancía
// (tpl-recepcion-mercancia-v2) y la tabla receiving_reports. Al completar la
// instancia, extrae de las respuestas/evidencia los datos y los guarda vía
// el mismo service que la API (receiving-service), sin duplicar lógica.

import { db } from "@/lib/db";
import { workflowInstances, workflowInstanceSteps, workflowTemplates, users, suppliers, branches, receivingReports, purchaseOrderItems, purchaseOrders } from "@/lib/db/schema";
import { eq, and, ilike, inArray } from "drizzle-orm";
import { processReceiving } from "./receiving-service";
import { templateLibrary } from "@/templates";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("services:receiving-from-workflow");

export const RECEPCION_TEMPLATE_ID = "tpl-recepcion-mercancia-v2";
/** v3: recepción completa desde una OC (captura línea por línea). */
export const RECEPCION_V3_TEMPLATE_ID = "tpl-recepcion-mercancia-v3";

/**
 * Garantiza que la compañía tenga el template v3 en `workflow_templates`
 * (mismo patrón que `StockCountService.getOrCreateTemplate`): los seeds lo
 * insertan, pero un despliegue sobre una BD ya poblada no lo tiene hasta
 * re-correrse. Idempotente.
 */
export async function ensureReceivingV3Template(companyId: string): Promise<void> {
  if (!companyId) return;
  const existing = await db.select({ id: workflowTemplates.id })
    .from(workflowTemplates)
    .where(and(
      eq(workflowTemplates.id, RECEPCION_V3_TEMPLATE_ID),
      eq(workflowTemplates.companyId, companyId)
    ))
    .limit(1);
  if (existing.length > 0) return;

  const staticTemplate = templateLibrary["recepcion-mercancia-v3"];
  if (!staticTemplate) {
    logger.warn({ companyId }, "Template de recepción v3 no está en la librería estática");
    return;
  }

  await db.insert(workflowTemplates).values({
    id: RECEPCION_V3_TEMPLATE_ID,
    companyId,
    name: staticTemplate.title,
    description: staticTemplate.description,
    category: staticTemplate.category,
    steps: JSON.stringify(staticTemplate.steps),
    active: true,
    title: staticTemplate.title,
    duracionEstimada: staticTemplate.duracionEstimada,
    tags: staticTemplate.tags as unknown as string[],
    aiConfig: staticTemplate.aiConfig as unknown as Record<string, unknown>,
    complianceConfig: staticTemplate.complianceConfig as unknown as Record<string, unknown>,
    completionActions: staticTemplate.completionActions as unknown as Record<string, unknown>,
    version: 1,
  }).onConflictDoNothing();
}

function parseStepValue(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return raw.trim();
  }
}

/** Recoge todas las URLs de evidencia de los pasos de foto (JSON o simple). */
function collectEvidence(steps: Array<{ stepId: string; value: string | null }>): string[] {
  const urls: string[] = [];
  for (const s of steps) {
    const raw = s.value ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const u of parsed) if (typeof u === "string" && u.startsWith("http")) urls.push(u);
      } else if (typeof parsed === "string" && parsed.startsWith("http")) {
        urls.push(parsed);
      } else if (parsed && typeof parsed === "object") {
        const v = (parsed as any).url || (parsed as any).evidenceUrl || (parsed as any).photoUrl;
        if (typeof v === "string" && v.startsWith("http")) urls.push(v);
      }
    } catch {
      if (trimmed.startsWith("http")) urls.push(trimmed);
    }
  }
  return urls;
}

/** Resuelve el supplierId a partir del nombre capturado en paso-1. */
async function resolveSupplierId(companyId: string, value: unknown): Promise<string | null> {
  const name = typeof value === "string" ? value.trim() : (value as any)?.value;
  if (!name || !companyId) return null;
  const found = await db.select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.companyId, companyId),
        ilike(suppliers.name, `%${name}%`)
      )
    )
    .limit(1);
  return found[0]?.id ?? null;
}

/**
 * Extrae y registra la recepción de mercancía asociada a una instancia del
 * template de recepción. Idempotente: no-op si ya existe un reporte para la
 * instancia. Falla silencioso — es un paso best-effort fuera del request.
 */
export async function extractReceivingFromInstance(instanceId: string): Promise<void> {
  try {
    const instance = await db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, instanceId),
    });
    if (!instance) return;

    // Solo para los templates de recepción y cuando ya quedó completado.
    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, instance.workflowTemplateId),
    });
    const isV3 = template?.id === RECEPCION_V3_TEMPLATE_ID;
    if (!template || (template.id !== RECEPCION_TEMPLATE_ID && !isV3)) return;
    if (instance.status !== "COMPLETED") return;

    // Idempotencia: un reporte ya marcado con este instanceId.
    const existing = await db.select({ id: receivingReports.id })
      .from(receivingReports)
      .where(ilike(receivingReports.notes, `%instance:${instanceId}%`))
      .limit(1);
    if (existing.length > 0) return;

    const rawSteps = await db.select({
      stepId: workflowInstanceSteps.stepId,
      value: workflowInstanceSteps.value,
      status: workflowInstanceSteps.status,
    })
      .from(workflowInstanceSteps)
      .where(eq(workflowInstanceSteps.instanceId, instanceId));

    const steps = rawSteps.map((s) => ({
      stepId: s.stepId,
      value: (typeof s.value === "string" ? s.value : "") as string,
    }));

    const valueOf = (id: string): unknown => {
      const s = steps.find((st) => st.stepId === id);
      return s ? parseStepValue(s.value) : null;
    };

    const actorUser = instance.assigneeId
      ? await db.query.users.findFirst({ where: eq(users.id, instance.assigneeId) })
      : null;

    let companyId = actorUser?.companyId || template.companyId || "";
    if (!companyId) {
      // Fallback: la empresa de la sucursal de la instancia.
      const branch = await db.query.branches.findFirst({
        where: eq(branches.id, instance.branchId),
      });
      companyId = branch?.companyId || "";
    }

    const decisionVal = valueOf("paso-decision");
    const discrepancies = valueOf("paso-discrepancias");
    const confirmation = valueOf("paso-completada") ?? valueOf("paso-12");
    const photos = collectEvidence(steps);

    let receiving;

    if (isV3) {
      receiving = await extractV3Items({
        instance,
        companyId,
        steps,
        valueOf,
        photos,
        contextNotes: [
          discrepancies ? `Discrepancias: ${discrepancies}` : null,
          decisionVal ? `Decisión: ${decisionVal}` : null,
          confirmation ? `Confirmación: ${confirmation}` : null,
          valueOf("paso-factura-total") ? `Total factura: ${valueOf("paso-factura-total")}` : null,
        ],
        actorUser,
      });
    } else {
      // v2 (solo inspección): el template no captura ítems línea por línea;
      // registramos el reporte con proveedor, evidencia y notas (Fase 5).
      const supplierName = valueOf("paso-1");
      const supplierId = await resolveSupplierId(companyId, supplierName);
      const poId = valueOf("paso-orden-compra");
      const invoiceId = valueOf("paso-factura");

      const notes = [
        `instance:${instanceId}`,
        discrepancies ? `Discrepancias: ${discrepancies}` : null,
        valueOf("paso-8") ? `Decisión: ${valueOf("paso-8")}` : null,
        confirmation ? `Confirmación: ${confirmation}` : null,
      ].filter(Boolean).join(" | ");

      receiving = await processReceiving(
        {
          user: { id: actorUser?.id || "system", companyId: companyId || null },
          branchId: instance.branchId,
        },
        {
          items: [],
          supplierId,
          purchaseOrderId: typeof poId === "string" ? poId : undefined,
          invoiceId: typeof invoiceId === "string" ? invoiceId : undefined,
          notes,
          photoUrls: photos,
        }
      );
    }

    logger.info(
      {
        instanceId,
        companyId,
        branchId: instance.branchId,
        reportId: receiving.id,
        templateId: template.id,
        fotos: photos.length,
      },
      "Reporte de recepción creado"
    );
  } catch (error) {
    logger.error({ instanceId, err: String(error) }, "Error procesando la recepción");
    // R-5: el error se propaga a propósito. Antes moría aquí y la corrida
    // quedaba indistinguible de un éxito. Ahora el llamador es
    // `workflow-extractors` (Inngest), que lo convierte en un run FALLIDO y
    // reintenta sólo este extractor. `completeStockCount` —el otro llamador—
    // ya trae su propio try/catch, así que su ruta no cambia.
    throw error;
  }
}

/**
 * v3 — traduce los sub-pasos dinámicos (`rec-cantidad-{poLineId}`, `rec-lote-*`,
 * `rec-caducidad-*`, `rec-costo-*`) a `items[]` y registra la recepción contra
 * la OC. Rechazo total ⇒ no mueve stock: sólo deja el reporte con evidencia.
 */
async function extractV3Items(args: {
  instance: typeof workflowInstances.$inferSelect;
  companyId: string;
  steps: Array<{ stepId: string; value: string }>;
  valueOf: (id: string) => unknown;
  photos: string[];
  contextNotes: Array<string | null>;
  actorUser: typeof users.$inferSelect | null;
}): Promise<{ id: string }> {
  const { instance, companyId, valueOf, photos, contextNotes, actorUser } = args;

  const purchaseId = (instance.data as Record<string, any> | null)?.purchaseId;
  if (!purchaseId || typeof purchaseId !== "string") {
    throw new Error(`Instancia ${instance.id} de recepción v3 sin purchaseId en data`);
  }

  const [po] = await db.select({
    id: purchaseOrders.id,
    supplierId: purchaseOrders.supplierId,
    status: purchaseOrders.status,
  })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseId), eq(purchaseOrders.companyId, companyId)))
    .limit(1);
  if (!po) {
    throw new Error(`OC ${purchaseId} no encontrada para la compañía`);
  }

  // Líneas de la OC expandidas en pasos: entityId ⇒ itemId.
  const lineIds = args.steps
    .map((s) => s.stepId)
    .filter((id) => id.startsWith("rec-cantidad-"))
    .map((id) => id.slice("rec-cantidad-".length));
  const lines = lineIds.length > 0
    ? await db.select({ id: purchaseOrderItems.id, itemId: purchaseOrderItems.itemId })
        .from(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.id, lineIds))
    : [];
  const lineToItem = new Map(lines.map((l) => [l.id, l.itemId]));

  // Rechazo total: no se registra mercancía, sólo el reporte con evidencia.
  const rejected = valueOf("paso-decision") === "Rechazar";

  const items: Array<{
    itemId: string;
    quantity: number;
    batchNumber?: string;
    expirationDate?: string;
    unitCost?: number;
  }> = [];

  for (const [lineId, itemId] of lineToItem) {
    const qtyRaw = valueOf(`rec-cantidad-${lineId}`);
    const quantity = typeof qtyRaw === "number" ? qtyRaw : Number(qtyRaw);
    if (!Number.isFinite(quantity) || quantity <= 0 || rejected) continue;

    const batchNumber = typeof valueOf(`rec-lote-${lineId}`) === "string"
      ? (valueOf(`rec-lote-${lineId}`) as string).trim() || undefined
      : undefined;
    const expirationDate = typeof valueOf(`rec-caducidad-${lineId}`) === "string"
      ? (valueOf(`rec-caducidad-${lineId}`) as string).trim() || undefined
      : undefined;
    const costRaw = valueOf(`rec-costo-${lineId}`);
    const unitCostNum = typeof costRaw === "number" ? costRaw : Number(costRaw);

    items.push({
      itemId,
      quantity,
      batchNumber,
      expirationDate,
      ...(Number.isFinite(unitCostNum) && unitCostNum > 0 ? { unitCost: unitCostNum } : {}),
    });
  }

  const notes = [
    `instance:${instance.id}`,
    ...contextNotes.filter(Boolean),
  ].join(" | ");

  return processReceiving(
    {
      user: { id: actorUser?.id || "system", companyId },
      branchId: instance.branchId,
    },
    {
      items: rejected ? [] : items,
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      notes,
      photoUrls: photos,
    }
  );
}