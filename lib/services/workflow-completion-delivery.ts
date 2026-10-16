import { db } from "@/lib/db";
import { workflowCompletionOutbox as outbox, workflowInstances } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { workflowInstanceCompleted } from "@/lib/inngest/events";
import { ApiError } from "@/lib/api/error";

const MAX_ATTEMPTS = 5;

/** Una fila bloqueada hasta confirmar el envío; una caída posterior reenvía el mismo id. */
export async function publishWorkflowCompletion(instanceId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(outbox)
      .where(eq(outbox.instanceId, instanceId)).for("update");
    if (!row || row.status !== "pending") return { delivered: false };

    let sent = false;
    try {
      await inngest.send({
        name: workflowInstanceCompleted.name,
        id: `workflow-extractors:${instanceId}:${row.generation}`,
        data: { instanceId, generation: row.generation },
      });
      sent = true;
    } catch {
      // No persistir credenciales ni cuerpos de respuesta del proveedor.
    }

    const attempts = row.attempts + 1;
    const terminal = !sent && attempts >= MAX_ATTEMPTS;
    await tx.update(outbox).set({
      attempts,
      status: sent ? "delivered" : terminal ? "failed" : "pending",
      lastError: sent ? null : "No se pudo entregar el evento de finalización.",
      deliveredAt: sent ? new Date() : null,
      processedAt: new Date(),
    }).where(eq(outbox.id, row.id));
    if (terminal) {
      await tx.update(workflowInstances).set({ completionEffectsStatus: "failed" })
        .where(eq(workflowInstances.id, instanceId));
    }
    return { delivered: sent };
  });
}

export async function pendingWorkflowCompletions() {
  return db.select({ instanceId: outbox.instanceId }).from(outbox)
    .where(eq(outbox.status, "pending"))
    .orderBy(outbox.createdAt).limit(25);
}

/** Permisos y alcance se verifican en la entrada antes de llamar al servicio. */
export async function resetWorkflowCompletion(instanceId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(outbox)
      .where(eq(outbox.instanceId, instanceId)).for("update");
    const [instance] = await tx.select().from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    if (!row || !instance || instance.status !== "COMPLETED") {
      throw ApiError.conflict("Esta ejecución no tiene una entrega recuperable.");
    }
    if (instance.completionEffectsStatus !== "failed") {
      // Doble clic o reintento HTTP: no abre una segunda generación.
      return { queued: false };
    }
    await tx.update(outbox).set({
      status: "pending", attempts: 0, generation: row.generation + 1,
      lastError: null, deliveredAt: null, processedAt: null,
    }).where(eq(outbox.id, row.id));
    await tx.update(workflowInstances).set({ completionEffectsStatus: "pending" })
      .where(eq(workflowInstances.id, instanceId));
    return { queued: true };
  });
}

/** El lock también protege entregas duplicadas en corridas distintas. */
export async function runCompletionExtractor(
  instanceId: string, name: string, extract: (id: string) => Promise<void>, generation?: number,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`extractors:${instanceId}`}, 0))`);
    const [row] = await tx.select().from(outbox)
      .where(eq(outbox.instanceId, instanceId)).for("update");
    if (row && (row.completedExtractors.includes(name) ||
      (generation ?? 0) !== row.generation)) return;

    await extract(instanceId);
    if (row) {
      await tx.update(outbox).set({ completedExtractors: [...row.completedExtractors, name] })
        .where(eq(outbox.id, row.id));
    }
  });
}

export async function setWorkflowExtractionStatus(
  instanceId: string, status: "processing" | "completed" | "failed", generation?: number,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(outbox)
      .where(eq(outbox.instanceId, instanceId)).for("update");
    // Eventos anteriores al outbox no convierten lo desconocido en éxito.
    if (!row || (generation ?? 0) !== row.generation) return;
    const [instance] = await tx.select().from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    if (instance?.completionEffectsStatus === "completed") return;
    await tx.update(workflowInstances).set({ completionEffectsStatus: status })
      .where(and(eq(workflowInstances.id, instanceId), eq(workflowInstances.status, "COMPLETED")));
    await tx.update(outbox).set({
      lastError: status === "failed" ? "Uno o más extractores agotaron sus reintentos." : null,
      processedAt: new Date(),
    }).where(eq(outbox.id, row.id));
  });
}
