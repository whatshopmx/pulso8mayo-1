/**
 * Verificación P4 (handoff §6): el recordatorio REUTILIZA el token vigente.
 *
 * Sección 6, punto 6 del plan: "Dejar pasar el recordatorio: debe reutilizar el
 * mismo token, no crear otro."
 *
 * Esquema:
 *  1. Crear instancia + asignación PENDING con dueDate en ~28 min (ventana del
 *     recordatorio de 30 min) y un smart link vigente (getOrCreateForInstance,
 *     igual que assignWorkflow).
 *  2. Monitorear NotificationDispatcher.sendNotification (payload real).
 *  3. Correr sendWorkflowReminders() — el cron real de recordatorios.
 *  4. Assert:
 *     a. El recordatorio salió con metadata.smartLinkUrl = MISMO token.
 *     b. NO se creó fila nueva en magic_links (sigue habiendo exactamente 1).
 *     c. La asignación quedó con notificationsSent 30min.
 *  5. Limpieza total.
 *
 * Uso: npx tsx --env-file=.env scripts/verify-reminder-reuse.ts
 */
import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowAssignments,
  magicLinks,
  notifications,
  workflowTemplates,
  branches,
  users,
} from "@/lib/db/schema";
import { eq, and, gte, isNull, desc } from "drizzle-orm";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";
import { sendWorkflowReminders } from "@/lib/cron/workflow-reminders";

let failures = 0;
function assert(cond: boolean, label: string, detail?: string) {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  ${ok}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// --- Spy sobre el dispatcher: captura el payload real del recordatorio ---
const captured: { eventType: string; smartLinkUrl?: string; metadata?: any; userId?: string }[] = [];
const original = NotificationDispatcher.sendNotification.bind(NotificationDispatcher);
(NotificationDispatcher as any).sendNotification = async (payload: any) => {
  captured.push({
    eventType: payload.eventType,
    smartLinkUrl: payload.metadata?.smartLinkUrl,
    metadata: payload.metadata,
    userId: payload.userId,
  });
  return original(payload as never);
};

async function main() {
  console.log(`=== P4: recordatorio reutiliza token (${new Date().toISOString()}) ===\n`);

  // 0. Contexto: plantilla con intervalos por defecto (incluye 30min) + branch + usuario
  const ts = await db.select().from(workflowTemplates);
  const template = ts.find((t) => {
    const ri = (t.reminderIntervals as number[] | null) || [1440, 60, 30];
    return ri.includes(30) && t.name && !t.name.startsWith("[") && t.category !== "TRAINING" && t.category !== "CAPACITACION";
  });
  if (!template) { console.error("No template with 30-min reminder interval"); process.exit(1); }

  const [branch] = await db.select().from(branches).limit(1);
  if (!branch) { console.error("No branches"); process.exit(1); }
  const user = await db.query.users.findFirst({ where: eq(users.branchId, branch.id) });
  if (!user) { console.error("No users in branch"); process.exit(1); }

  console.log(`Plantilla: ${template.name} | Branch: ${branch.name} | Usuario: ${user.name}`);

  // 1. Instancia PENDING + asignación PENDING con dueDate en ~28 min
  const testStart = new Date();
  const dueDate = new Date(Date.now() + 28 * 60 * 1000);
  const [instance] = await db.insert(workflowInstances).values({
    workflowTemplateId: template.id,
    branchId: branch.id,
    assigneeId: user.id,
    status: "PENDING",
    dueDate,
    priority: "MEDIUM",
    createdBy: "verify-p4",
  } as any).returning();

  const [assignment] = await db.insert(workflowAssignments).values({
    instanceId: instance.id,
    assignedTo: user.id,
    assignmentType: "ROLE",
    status: "PENDING",
    dueDate,
    priority: "MEDIUM",
    remindersSent: [],
  } as any).returning();

  // Enlace vigente — igual que assignWorkflow (getOrCreateForInstance)
  const smartLink = await SmartLinkService.getOrCreateForInstance(instance.id, template.id, {
    sessionId: instance.sessionId,
    assignedTo: user.id,
    assignmentId: assignment.id,
  });
  assert(!!smartLink, "Smart link vigente creado", smartLink?.url);

  const countBefore = await db.select().from(magicLinks)
    .where(and(eq(magicLinks.instanceId, instance.id), isNull(magicLinks.sessionId)));
  assert(countBefore.length === 1, "Exactamente 1 magic_link antes del recordatorio", `(${countBefore.length})`);

  try {
    // 2. Correr el cron real de recordatorios
    const result = await sendWorkflowReminders();
    console.log(`\nReminders job: sent=${result.remindersSent} errors=${result.errors} checked=${result.assignmentsChecked}`);

    // 3. Assertions
    const reminder = captured.find((c) => c.eventType === "workflow_due_soon" && c.userId === user.id);
    assert(!!reminder, "El recordatorio salió con eventType workflow_due_soon", reminder ? "ok" : "no capturado");
    if (reminder) {
      assert(
        reminder.smartLinkUrl === smartLink?.url,
        "metadata.smartLinkUrl = MISMO token (reutiliza, no regenera)",
        reminder.smartLinkUrl || "undefined"
      );
      assert(!!reminder.smartLinkUrl, "metadata.smartLinkUrl presente en el recordatorio");
    }

    const countAfter = await db.select().from(magicLinks)
      .where(and(eq(magicLinks.instanceId, instance.id), isNull(magicLinks.sessionId)));
    assert(countAfter.length === 1, "NO se creó fila nueva en magic_links", `(${countAfter.length})`);

    const updated = await db.query.workflowAssignments.findFirst({
      where: eq(workflowAssignments.id, assignment.id),
    });
    const rs = (updated?.remindersSent as { type?: string }[] | null) || [];
    assert(
      rs.some((r) => r.type === "30min"),
      "La asignación quedó con remindersSent 30min",
      JSON.stringify(rs)
    );
  } finally {
    // 4. Limpieza (sólo filas creadas a partir de testStart)
    await db.delete(notifications).where(and(eq(notifications.userId, user.id), gte(notifications.createdAt, testStart)));
    await db.delete(magicLinks).where(eq(magicLinks.instanceId, instance.id));
    await db.delete(workflowAssignments).where(eq(workflowAssignments.instanceId, instance.id));
    await db.delete(workflowInstances).where(eq(workflowInstances.id, instance.id));

    console.log(`\n${failures === 0 ? "✅ P4 O K" : `❌ ${failures} CHECK(S) FALLARON`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });