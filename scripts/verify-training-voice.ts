/**
 * Verificación P5 (handoff §6): la voz de capacitación sigue intacta.
 *
 * Sección 6, punto 8 del plan: "Plantilla de capacitación: debe seguir con su
 * propia voz y un solo enlace."
 *
 * La BD demo NO tiene plantillas TRAINING, así que el script crea una mínima
 * (categoría TRAINING, nombre con "capacitación"), corre la cadena real del cron
 * (schedule due → executeScheduledWorkflows → autoAssignWorkflow → link +
 * notificación) y verifica:
 *   a. eventType = training_assigned (no workflow_assignment).
 *   b. Título/voz de capacitación en la notificación.
 *   c. EXACTAMENTE un magic_link para la instancia (getOrCreateForInstance no duplica).
 * Limpia TODO lo creado, incluida la plantilla.
 *
 * Uso: npx tsx --env-file=.env scripts/verify-training-voice.ts
 */
import { db } from "@/lib/db";
import {
  workflowSchedules,
  workflowInstances,
  workflowAssignments,
  magicLinks,
  notifications,
  workflowTemplates,
  users,
} from "@/lib/db/schema";
import { eq, and, gte, isNull, desc } from "drizzle-orm";
import { executeScheduledWorkflows } from "@/lib/cron/execute-schedules";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

const TITLE = "[VERIFY] Capacitación Higiene de Manos";

let failures = 0;
function assert(cond: boolean, label: string, detail?: string) {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  ${ok}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// --- Spy: captura eventType + título reales de la notificación ---
const captured: { eventType: string; title: string; userId?: string; actionUrl?: string }[] = [];
const original = NotificationDispatcher.sendNotification.bind(NotificationDispatcher);
(NotificationDispatcher as any).sendNotification = async (payload: any) => {
  captured.push({
    eventType: payload.eventType,
    title: payload.title,
    userId: payload.userId,
    actionUrl: payload.actionUrl,
  });
  return original(payload as never);
};

async function main() {
  console.log(`=== P5: voz de capacitación (${new Date().toISOString()}) ===\n`);

  // 0. Contexto: branch + usuario con rol
  const branch = await db.query.branches.findFirst();
  if (!branch) { console.error("No hay sucursales"); process.exit(1); }
  const assigned = await db.query.users.findFirst({
    where: eq(users.branchId, branch.id),
  });
  if (!assigned) { console.error("No hay usuarios en la sucursal"); process.exit(1); }

  // 1. Plantilla TRAINING mínima (no existe ninguna en demo)
  const [template] = await db.insert(workflowTemplates).values({
    id: `tpl-verify-training-${Date.now()}`,
    name: TITLE,
    description: "Plantilla temporal de verificación (P5)",
    category: "TRAINING",
    steps: [],
    isCritical: false,
    active: true,
  } as any).returning();

  const testStart = new Date();
  let schedule: typeof workflowSchedules.$inferSelect | undefined;
  try {
    // 2. Schedule due YA
    const [sched] = await db.insert(workflowSchedules).values({
      templateId: template.id,
      branchId: branch.id,
      assignmentType: "ROLE",
      assignedRole: assigned.role,
      frequency: "DAILY",
      timeOfDay: "00:00",
      startDate: new Date(Date.now() - 24 * 3600 * 1000),
      nextExecutionAt: new Date(Date.now() - 60 * 1000),
      title: TITLE,
      description: "Verificación P5 voz capacitación",
      priority: "MEDIUM",
      isActive: true,
      createdBy: "verify-p5",
    } as any).returning();
    schedule = sched;

    // 3. Cadena real del cron
    const result = await executeScheduledWorkflows();
    console.log(`\nCron ejecutado: success=${result.success} executed=${result.executed} errors=${result.errors}`);

    const [instance] = await db.select().from(workflowInstances)
      .where(eq(workflowInstances.scheduleId, schedule.id));
    assert(!!instance, "Se creó la ejecución", instance?.id);
    if (!instance) return;

    const links = await db.select().from(magicLinks)
      .where(and(eq(magicLinks.instanceId, instance.id), isNull(magicLinks.sessionId)));
    assert(links.length === 1, "EXACTAMENTE un magic_link (no duplica)", `(${links.length})`);

    // 4. Voz de capacitación: eventType + título
    const assignment = await db.query.workflowAssignments.findFirst({
      where: eq(workflowAssignments.instanceId, instance.id),
    });
    const notif = captured.find(
      (c) => c.eventType === "training_assigned" && c.userId === assignment?.assignedTo
    );
    assert(!!notif, "eventType = training_assigned (no workflow_assignment)", notif ? "ok" : "no capturado");
    if (notif) {
      assert(
        notif.title.startsWith("Nueva Capacitación"),
        "Título con voz de capacitación",
        notif.title
      );
      assert(
        !notif.title.includes("Nueva Tarea"),
        "No usa la voz de tarea genérica"
      );
    }

    // 5. El enlace también quedó en actionUrl (smartLinkUrl)
    const expectedUrl = links[0]
      ? `${process.env.NEXT_PUBLIC_APP_URL}/workflow/public/${links[0].token}`
      : "__none__";
    assert(notif?.actionUrl === expectedUrl, "actionUrl = smart link de capacitación", notif?.actionUrl);

    // 6. Limpieza de literales en plantilla WhatsApp de training_assigned
    const wa = NotificationDispatcher.getTemplate("training_assigned")?.whatsappTemplate || "";
    const rendered = wa
      .replace(/\{userName\}/g, "Prueba")
      .replace(/\{workflowName\}/g, TITLE)
      .replace(/\{dueDate\}/g, "Hoy")
      .replace(/\{smartLinkUrl\}/g, expectedUrl);
    assert(!/[{}]/.test(rendered), "WhatsApp training_assigned sin literales colgando");
  } finally {
    // 7. Limpieza
    const instances = await db.select({ id: workflowInstances.id }).from(workflowInstances)
      .where(eq(workflowInstances.scheduleId, schedule?.id));
    for (const inst of instances) {
      await db.delete(magicLinks).where(eq(magicLinks.instanceId, inst.id));
      await db.delete(workflowAssignments).where(eq(workflowAssignments.instanceId, inst.id));
      await db.delete(workflowInstances).where(eq(workflowInstances.id, inst.id));
    }
    await db.delete(notifications).where(gte(notifications.createdAt, testStart));
    if (schedule) await db.delete(workflowSchedules).where(eq(workflowSchedules.id, schedule.id));
    await db.delete(workflowTemplates).where(eq(workflowTemplates.id, template.id));

    console.log(`\n${failures === 0 ? "✅ P5 O K" : `❌ ${failures} CHECK(S) FALLARON`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });