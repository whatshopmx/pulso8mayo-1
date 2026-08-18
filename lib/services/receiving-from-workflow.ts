// lib/services/receiving-from-workflow.ts
// Fase 5 (capa dinero): puente entre el template de recepción de mercancía
// (tpl-recepcion-mercancia-v2) y la tabla receiving_reports. Al completar la
// instancia, extrae de las respuestas/evidencia los datos y los guarda vía
// el mismo service que la API (receiving-service), sin duplicar lógica.

import { db } from "@/lib/db";
import { workflowInstances, workflowInstanceSteps, workflowTemplates, users, suppliers, branches, receivingReports } from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";
import { processReceiving } from "./receiving-service";

export const RECEPCION_TEMPLATE_ID = "tpl-recepcion-mercancia-v2";

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

    // Solo para el template de recepción y cuando ya quedó completado.
    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, instance.workflowTemplateId),
    });
    if (!template || template.id !== RECEPCION_TEMPLATE_ID) return;
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

    const supplierName = valueOf("paso-1");
    let companyId = actorUser?.companyId || template.companyId || "";
    if (!companyId) {
      // Fallback: la empresa de la sucursal de la instancia.
      const branch = await db.query.branches.findFirst({
        where: eq(branches.id, instance.branchId),
      });
      companyId = branch?.companyId || "";
    }
    const supplierId = await resolveSupplierId(companyId, supplierName);

    const poId = valueOf("paso-orden-compra");
    const invoiceId = valueOf("paso-factura");

    const decisionVal = valueOf("paso-8");
    const discrepancies = valueOf("paso-10");
    const confirmation = valueOf("paso-12");
    const photos = collectEvidence(steps);

    const notes = [
      `instance:${instanceId}`,
      discrepancies ? `Discrepancias: ${discrepancies}` : null,
      decisionVal ? `Decisión: ${decisionVal}` : null,
      confirmation ? `Confirmación: ${confirmation}` : null,
    ].filter(Boolean).join(" | ");

    // El template no captura ítems línea por línea; registramos el reporte de
    // recepción con proveedor, evidencia y notas para la analítica (Fase 5).
    const receiving = await processReceiving(
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

    console.log(
      `[ReceivingFromWorkflow] Reporte ${receiving.id} para instancia ${instanceId} ` +
        `(${photos.length} fotos, proveedor=${supplierId ?? "n/a"})`
    );
  } catch (error) {
    console.error(`[ReceivingFromWorkflow] Error procesando recepción para instancia ${instanceId}:`, error);
  }
}