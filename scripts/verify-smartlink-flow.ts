/**
 * Verificación runtime del plan smartlinks-flujos-programados (sección 6).
 *
 * Ejecuta la cadena completa contra la BD real (dev/demo):
 *   schedule due → executeSchedule → autoAssignWorkflow → smart link + notificación
 *
 * Chequeos:
 *  1. Se crea ejecución, asignación y EXACTAMENTE un magic_link con session_id nulo.
 *  2. El enlace expira según dueDate (piso 2h / techo 30d / +12h de margen).
 *  3. La notificación in-app sale con actionUrl = smart link y sin literales {..}.
 *  4. La plantilla WhatsApp (workflow_assignment) sustituye {smartLinkUrl} sin
 *     dejar literales, cuando se le pasa el metadata real de la asignación.
 *  5. getOrCreateForInstance REUTILIZA el token vigente (fresh: false) — no duplica.
 *  6. Al cerrar (markUsedForInstance), validateSmartLink rechaza el token.
 *
 * Uso: npx tsx --env-file=.env scripts/verify-smartlink-flow.ts
 * Limpia todas las filas que crea (schedule, instance, assignments, links, notifs).
 */
import { db } from "@/lib/db";
import {
  workflowSchedules,
  workflowInstances,
  workflowAssignments,
  magicLinks,
  notifications,
  workflowTemplates,
  branches,
  users,
} from "@/lib/db/schema";
import { eq, and, gte, isNull, desc } from "drizzle-orm";
import { executeScheduledWorkflows } from "@/lib/cron/execute-schedules";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

const TITLE = "[VERIFY] smartlink-flow";

let failures = 0;
function assert(cond: boolean, label: string, detail?: string) {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  ${ok}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function cleanup(scheduleId: string, assignedTo: string | undefined, since: Date) {
  const instances = await db.select({ id: workflowInstances.id }).from(workflowInstances)
    .where(eq(workflowInstances.scheduleId, scheduleId));
  for (const inst of instances) {
    await db.delete(magicLinks).where(eq(magicLinks.instanceId, inst.id));
    await db.delete(workflowAssignments).where(eq(workflowAssignments.instanceId, inst.id));
    await db.delete(workflowInstances).where(eq(workflowInstances.id, inst.id));
  }
  if (assignedTo) {
    // La notificación in-app lleva actionUrl = smart link; se borra por usuario+fecha.
    await db.delete(notifications).where(
      and(eq(notifications.userId, assignedTo), gte(notifications.createdAt, since))
    );
  }
  await db.delete(workflowSchedules).where(eq(workflowSchedules.id, scheduleId));
}

async function main() {
  console.log(`=== Verificación smartlink en flujos programados (${new Date().toISOString()}) ===\n`);

  // 0. Contexto: elegir plantilla no-capacitación + branch + rol existente
  const allTemplates = await db.select().from(workflowTemplates);
  const training = (t: typeof allTemplates[number]) =>
    t.category === "TRAINING" ||
    t.category === "CAPACITACION" ||
    t.name?.toLowerCase().includes("capacitacion") ||
    t.name?.toLowerCase().includes("capacitación");
  const template = allTemplates.find((t) => !training(t) && t.name && !t.name.startsWith("["));

  if (!template) {
    console.error("No hay plantilla no-capacitación para el test");
    process.exit(1);
  }

  const [branch] = await db.select().from(branches).limit(1);
  if (!branch) { console.error("No hay sucursales"); process.exit(1); }

  const roleUsers = await db.select({ role: users.role }).from(users)
    .where(eq(users.branchId, branch.id));
  const role = roleUsers[0]?.role as string;
  console.log(`Plantilla: ${template.name} (cat ${template.category}) | Branch: ${branch.name} | Role: ${role}`);

  // 1. Crear schedule due YA (nextExecutionAt en el pasado)
  const [schedule] = await db.insert(workflowSchedules).values({
    templateId: template.id,
    branchId: branch.id,
    assignmentType: "ROLE",
    assignedRole: role,
    frequency: "DAILY",
    timeOfDay: "00:00",
    startDate: new Date(Date.now() - 24 * 3600 * 1000),
    nextExecutionAt: new Date(Date.now() - 60 * 1000),
    title: TITLE,
    description: "Verificación automática smart link",
    priority: "MEDIUM",
    isActive: true,
    createdBy: "verify-script",
  } as any).returning();

  let ranViaCron = false;
  const testStart = new Date();
  let assignedTo: string | undefined;
  try {
    // 2. Procesar schedules due. Si hay OTROS schedules due reales, la corrida
    // también los procesa (efecto benigno en demo: es el propio cron). Para
    // aislamiento estricto se podría llamar la cadena manual; aquí preferimos
    // ejercitar el cron real (incluye dedup).
    const result = await executeScheduledWorkflows();
    ranViaCron = true;
    console.log(`\nCron ejecutado: success=${result.success} executed=${result.executed} errors=${result.errors}`);
    if (result.errors) console.log("  errores del cron:", JSON.stringify(result.details));

    // 3. Verificar cadena
    const [instance] = await db.select().from(workflowInstances)
      .where(eq(workflowInstances.scheduleId, schedule.id));
    assert(!!instance, "Se creó la ejecución (workflowInstances)", instance?.id);
    if (!instance) return;

    const assignment = await db.query.workflowAssignments.findFirst({
      where: eq(workflowAssignments.instanceId, instance.id),
    });
    assignedTo = assignment?.assignedTo;
    assert(!!assignment, "Se creó la asignación (workflowAssignments)", assignment?.assignedTo);
    assert(assignment?.assignedTo === instance.assigneeId, "instance.assigneeId == assignment.assignedTo");

    const links = await db.select().from(magicLinks)
      .where(and(eq(magicLinks.instanceId, instance.id), isNull(magicLinks.sessionId)));
    assert(links.length === 1, "EXACTAMENTE un magic_link con session_id NULO", `(${links.length})`);
    const link = links[0];
    if (link) {
      const now = Date.now();
      const expiresMs = link.expiresAt.getTime();
      const twoHours = 2 * 3600 * 1000;
      const thirtyDays = 30 * 24 * 3600 * 1000;
      assert(expiresMs > now, "expiresAt en el futuro");
      assert(expiresMs - now >= twoHours, "expiración con piso de 2h");
      assert(expiresMs - now <= thirtyDays, "expiración con techo de 30d");
      if (assignment?.dueDate) {
        const dueMs = assignment.dueDate.getTime();
        const margin = 12 * 3600 * 1000 + 60 * 1000;
        assert(
          expiresMs <= dueMs + margin,
          "vigencia atada a dueDate (+12h margen)",
          `due=${assignment.dueDate.toISOString()} exp=${link.expiresAt.toISOString()} diff=${((expiresMs - dueMs) / 3600000).toFixed(1)}h`
        );
      }
    }

    // 4. Notificación in-app: actionUrl = smart link, sin literales. La URL no se
    // guarda en magic_links; se reconstruye igual que SmartLinkService.
    const expectedUrl = link
      ? `${process.env.NEXT_PUBLIC_APP_URL}/workflow/public/${link.token}`
      : "__none__";
    const notif = await db.query.notifications.findFirst({
      where: eq(notifications.actionUrl, expectedUrl),
      orderBy: desc(notifications.createdAt),
    });
    assert(!!notif, "Notificación in-app con actionUrl = smart link", notif ? "ok" : "sin fila");
    if (notif) {
      const rendered = `${notif.title} ${notif.message}`;
      assert(!rendered.includes("{") && !rendered.includes("}"), "Sin literales {..} en in-app");
    }

    // 4b. Plantilla WhatsApp: sustitución real con el metadata de la asignación
    const waTemplate = NotificationDispatcher.getTemplate("workflow_assignment")?.whatsappTemplate || "";
    const waRendered = waTemplate
      .replace(/\{userName\}/g, "Prueba")
      .replace(/\{workflowName\}/g, template.name || "Workflow")
      .replace(/\{dueDate\}/g, "Hoy")
      .replace(/\{smartLinkUrl\}/g, expectedUrl);
    assert(!waRendered.includes("{smartLinkUrl}"), "WhatsApp: {smartLinkUrl} sustituido");
    assert(!/[{}]/.test(waRendered), "WhatsApp: sin literales colgando");
    assert(
      expectedUrl !== "__none__" && waRendered.includes(`${process.env.NEXT_PUBLIC_APP_URL}/workflow/public/`),
      "WhatsApp: contiene el smart link"
    );

    // 5. Reuso: getOrCreateForInstance no duplica
    const again = await SmartLinkService.getOrCreateForInstance(instance.id, instance.workflowTemplateId);
    assert(again?.token === link?.token && again?.fresh === false, "getOrCreateForInstance reutiliza el mismo token");

    // 6. Higiene al cerrar: markUsedForInstance invalida el enlace
    await SmartLinkService.markUsedForInstance(instance.id);
    const afterClose = link ? await SmartLinkService.validateSmartLink(link.token) : null;
    assert(!afterClose, "Tras cerrar la instancia, validateSmartLink rechaza el token");
  } finally {
    await cleanup(schedule.id, assignedTo, testStart);
    console.log(`\n${failures === 0 ? "✅ V E R I F I C A C I Ó N   O K" : `❌ ${failures} CHECK(S) FALLARON`}${ranViaCron ? "" : ""}`);
    process.exit(failures === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });