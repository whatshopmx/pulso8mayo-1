import { seedRandom } from "./seed-scenarios";
import "dotenv/config";
import { db } from "@/lib/db";
import {
  workflowTemplates, workflowSchedules, workflowInstances,
  workflowInstanceSteps, workflowAssignments, eventTriggers,
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getAllTemplates, templateLibrary } from "@/templates/index";
import { resolveDynamicSteps } from "@/lib/workflows/dynamic-steps";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3,
} from "./seed-constants";

function randomDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(seedRandom("05-workflows") * daysAgo));
  return d;
}

function randomInt(min: number, max: number): number {
  return Math.floor(seedRandom("05-workflows") * (max - min + 1)) + min;
}

const BRANCHES = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
const BRANCH_OPERATORS = [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3];

/**
 * Assets locales del demo. Las evidencias del seed apuntaban a
 * `https://pulso.ejemplo/...`, un dominio inexistente: la galería mostraba
 * "Imagen no disponible" en todas las tarjetas. Los archivos viven en
 * `public/demo-evidence/` y se sirven desde el propio sitio.
 */
const DEMO_EVIDENCE_COUNT = 8;

function demoEvidenceUrl(seed: number): string {
  const index = (Math.abs(seed) % DEMO_EVIDENCE_COUNT) + 1;
  return `/demo-evidence/evidencia-${String(index).padStart(2, "0")}.png`;
}

// La revisión trata cualquier nota del operador como hallazgo que mirar
// (`stepNeedsAttention` en `lib/workflows/step-definitions.ts`). Con una nota en
// todos los pasos, la pestaña "Requiere atención" trae el 100% del flujo y deja
// de señalar nada: el silencio es lo normal y la nota es la excepción.
const NOTAS_DISCREPANCIA = [
  "La cámara marcaba 5.2 °C, fuera de rango. Avisé al gerente en turno.",
  "La foto salió a contraluz; volví a tomarla desde el otro costado.",
  "Faltaba acomodar una charola cuando levanté la evidencia.",
  "El sello del contenedor venía roto, lo separé para revisión.",
];

const NOTAS_OPERADOR = [
  "Merma de 3 piezas por caducidad, ya quedó registrada.",
  "El proveedor llegó 40 minutos tarde.",
  "Se repuso el gel del dispensador de la entrada.",
  "La cámara 2 tardó en enfriar; quedó estable a los 20 minutos.",
];

/**
 * La nota sigue al hallazgo: si la IA reprobó el paso hay algo que explicar, si
 * no, casi siempre no hay nada que decir.
 */
function notaDelPaso(aiAnalysis: { passed?: boolean } | null): string | null {
  if (aiAnalysis && aiAnalysis.passed === false) {
    return NOTAS_DISCREPANCIA[randomInt(0, NOTAS_DISCREPANCIA.length - 1)];
  }
  if (seedRandom("05-workflows") > 0.08) return null;
  return NOTAS_OPERADOR[randomInt(0, NOTAS_OPERADOR.length - 1)];
}

export async function main() {
  console.log("=== Phase 5: Workflows ===");
  console.log("Cleaning up...");

  await db.delete(eventTriggers).where(sql`1=1`);
  await db.delete(workflowAssignments).where(sql`1=1`);
  await db.delete(workflowInstanceSteps).where(sql`1=1`);
  await db.delete(workflowInstances).where(sql`1=1`);
  await db.delete(workflowSchedules).where(sql`1=1`);
  await db.delete(workflowTemplates).where(eq(workflowTemplates.companyId, COMPANY_ID));

  console.log("Loading current template library...");
  const templates = getAllTemplates();
  console.log(`  Found ${templates.length} templates`);

  const templateRows: { id: string }[] = [];
  for (const tmpl of templates) {
    const [row] = await db.insert(workflowTemplates).values({
      id: (tmpl as any).id,
      companyId: COMPANY_ID,
      name: tmpl.title,
      description: tmpl.description,
      category: tmpl.category,
      steps: tmpl.steps as unknown as Record<string, unknown>,
      active: true,
      title: tmpl.title,
      duracionEstimada: tmpl.duracionEstimada,
      tags: tmpl.tags as unknown as string[],
      aiConfig: tmpl.aiConfig as unknown as Record<string, unknown>,
      complianceConfig: tmpl.complianceConfig as unknown as Record<string, unknown>,
      completionActions: tmpl.completionActions as unknown as Record<string, unknown>,
      version: 1,
    }).returning({ id: workflowTemplates.id });
    templateRows.push(row);
  }

  console.log("Creating schedules...");
  // Claves estables: agregar plantillas a la librería no debe cambiar qué
  // ejecuta una programación existente.
  const templateKeys = [
    "reporte-incidentes-v2", "daily-attendance-v1", "fumigacion-v1",
    "inspeccion-sistema-incendios-v1", "nom-035-survey-v1", "control-higiene-personal-v2",
    "control-temperaturas-v1", "inspeccion-alimentos-v1", "recepcion-mercancia-v2",
    "checklist-mantenimiento-v1", "mantenimiento-equipos-refrigeradores-v1",
    "apertura-restaurante-v2", "cierre-restaurante-v2", "limpieza-sanitizacion-v2",
    "conteo-inventario-v1", "control-accesos-v1", "seguridad-local-v1",
    "produccion-diaria-v1", "registro-merma-v1",
  ];
  const scheduledTemplate = (index: number) => {
    const definition = templateLibrary[templateKeys[index]] as typeof templates[number] & { id: string };
    const row = templateRows.find((row) => row.id === definition?.id);
    if (!row) throw new Error(`Plantilla requerida ausente: ${templateKeys[index]}`);
    return row;
  };
  type FreqType = "DAILY" | "WEEKLY" | "MONTHLY" | "ONCE";
  const scheduleConfigs: { templateIdx: number; branchIdx: number; title: string; freq: FreqType; dayOfWeek?: number; dayOfMonth?: number; time: string; role: string }[] = [
    { templateIdx: 0, branchIdx: 0, title: "Reporte de Incidentes - Condesa", freq: "DAILY", time: "14:00", role: "GERENTE" },
    { templateIdx: 0, branchIdx: 1, title: "Reporte de Incidentes - Polanco", freq: "DAILY", time: "14:00", role: "GERENTE" },
    { templateIdx: 0, branchIdx: 2, title: "Reporte de Incidentes - Roma", freq: "DAILY", time: "14:00", role: "GERENTE" },
    { templateIdx: 1, branchIdx: 0, title: "Asistencia Diaria - Condesa", freq: "DAILY", time: "08:00", role: "SUPERVISOR" },
    { templateIdx: 1, branchIdx: 1, title: "Asistencia Diaria - Polanco", freq: "DAILY", time: "08:00", role: "SUPERVISOR" },
    { templateIdx: 2, branchIdx: 0, title: "Fumigación - Condesa", freq: "WEEKLY", dayOfWeek: 0, time: "06:00", role: "SUPERVISOR" },
    { templateIdx: 2, branchIdx: 1, title: "Fumigación - Polanco", freq: "WEEKLY", dayOfWeek: 0, time: "06:00", role: "SUPERVISOR" },
    { templateIdx: 3, branchIdx: 0, title: "Inspección Incendios - Condesa", freq: "MONTHLY", dayOfMonth: 1, time: "09:00", role: "GERENTE" },
    { templateIdx: 4, branchIdx: 0, title: "NOM-035 Survey", freq: "MONTHLY", dayOfMonth: 15, time: "10:00", role: "ADMIN" },
    { templateIdx: 5, branchIdx: 0, title: "Higiene Personal - Condesa", freq: "DAILY", time: "07:00", role: "SUPERVISOR" },
    { templateIdx: 5, branchIdx: 1, title: "Higiene Personal - Polanco", freq: "DAILY", time: "07:00", role: "SUPERVISOR" },
    { templateIdx: 6, branchIdx: 0, title: "Control Temperaturas - Condesa", freq: "DAILY", time: "09:00", role: "EMPLEADO" },
    { templateIdx: 6, branchIdx: 1, title: "Control Temperaturas - Polanco", freq: "DAILY", time: "09:00", role: "EMPLEADO" },
    { templateIdx: 7, branchIdx: 0, title: "Inspección Alimentos - Condesa", freq: "DAILY", time: "07:30", role: "SUPERVISOR" },
    { templateIdx: 8, branchIdx: 0, title: "Recepción Mercancía - Condesa", freq: "DAILY", time: "06:00", role: "EMPLEADO" },
    { templateIdx: 9, branchIdx: 0, title: "Checklist Mantenimiento - Condesa", freq: "WEEKLY", dayOfWeek: 5, time: "08:00", role: "GERENTE" },
    { templateIdx: 10, branchIdx: 0, title: "Mantenimiento Refrigeradores - Condesa", freq: "WEEKLY", dayOfWeek: 1, time: "07:00", role: "SUPERVISOR" },
    { templateIdx: 11, branchIdx: 0, title: "Apertura Restaurante - Condesa", freq: "DAILY", time: "06:00", role: "EMPLEADO" },
    { templateIdx: 11, branchIdx: 1, title: "Apertura Restaurante - Polanco", freq: "DAILY", time: "06:00", role: "EMPLEADO" },
    { templateIdx: 12, branchIdx: 0, title: "Cierre Restaurante - Condesa", freq: "DAILY", time: "22:00", role: "EMPLEADO" },
    { templateIdx: 12, branchIdx: 1, title: "Cierre Restaurante - Polanco", freq: "DAILY", time: "22:00", role: "EMPLEADO" },
    { templateIdx: 13, branchIdx: 0, title: "Limpieza y Sanitización - Condesa", freq: "DAILY", time: "23:00", role: "EMPLEADO" },
    { templateIdx: 14, branchIdx: 0, title: "Conteo Inventario - Condesa", freq: "WEEKLY", dayOfWeek: 6, time: "23:00", role: "SUPERVISOR" },
    { templateIdx: 15, branchIdx: 0, title: "Control Accesos - Condesa", freq: "DAILY", time: "08:00", role: "SUPERVISOR" },
    { templateIdx: 16, branchIdx: 0, title: "Seguridad Local - Condesa", freq: "DAILY", time: "22:00", role: "SUPERVISOR" },
    { templateIdx: 17, branchIdx: 0, title: "Producción Diaria - Condesa", freq: "DAILY", time: "11:00", role: "EMPLEADO" },
    { templateIdx: 18, branchIdx: 0, title: "Registro Merma - Condesa", freq: "DAILY", time: "21:00", role: "EMPLEADO" },
  ];

  const scheduleRows: { id: string }[] = [];
  for (const sc of scheduleConfigs) {
    const tmpl = scheduledTemplate(sc.templateIdx);
    if (!tmpl) continue;
    const [row] = await db.insert(workflowSchedules).values({
      templateId: tmpl.id,
      branchId: BRANCHES[sc.branchIdx],
      assignmentType: "ROLE",
      assignedRole: sc.role as any,
      frequency: sc.freq,
      dayOfWeek: sc.dayOfWeek,
      dayOfMonth: sc.dayOfMonth,
      timeOfDay: sc.time,
      startDate: new Date("2026-01-01"),
      isActive: true,
      title: sc.title,
      priority: "MEDIUM",
      createdBy: USER_ADMIN,
    }).returning({ id: workflowSchedules.id });
    scheduleRows.push(row);
  }
  console.log(`  Created ${scheduleRows.length} schedules`);

  console.log("Creating ~300 workflow instances over 30 days...");
  const now = new Date();
  const instanceRows: { id: string; templateId: string; scheduleId?: string; assigneeId: string }[] = [];
  let instanceCount = 0;

  const instanceValues: any[] = [];
  // `assigneeId` viaja hasta el bucle de pasos: quien tiene asignada la
  // ejecución es quien la registra, y sin arrastrarlo aquí los pasos acaban
  // firmados por gente que nunca tocó ese workflow.
  const instanceMeta: { templateId: string; scheduleId?: string; completed: boolean; assigneeId: string }[] = [];

  for (let day = 0; day < 30; day++) {
    const date = new Date(now);
    date.setDate(date.getDate() - day);
    const dayOfWeek = date.getDay();

    for (let s = 0; s < scheduleConfigs.length; s++) {
      const sc = scheduleConfigs[s];
      if (sc.freq === "WEEKLY" && sc.dayOfWeek !== undefined && sc.dayOfWeek !== dayOfWeek) continue;
      if (sc.freq === "MONTHLY" && sc.dayOfMonth !== undefined && date.getDate() !== sc.dayOfMonth) continue;
      if (sc.freq === "ONCE" && day > 0) continue;

      const tmpl = scheduledTemplate(sc.templateIdx);
      if (!tmpl) continue;

      const hours = parseInt(sc.time.split(":")[0]);
      const mins = parseInt(sc.time.split(":")[1]);
      const dueDate = new Date(date);
      dueDate.setHours(hours, mins, 0, 0);

      const completed = dueDate.getTime() + 120 * 60000 < now.getTime() && seedRandom("05-workflows") > 0.15;
      const score = completed ? (seedRandom("05-workflows") > 0.2 ? randomInt(70, 100) : randomInt(40, 69)) : undefined;

      const assigneeId = BRANCH_OPERATORS[sc.branchIdx];

      instanceValues.push({
        workflowTemplateId: tmpl.id,
        branchId: BRANCHES[sc.branchIdx],
        assigneeId,
        scheduleId: scheduleRows[s]?.id,
        status: completed ? "COMPLETED" : "PENDING",
        startedAt: completed ? new Date(dueDate.getTime() + randomInt(0, 30) * 60000) : null,
        completedAt: completed ? new Date(dueDate.getTime() + randomInt(30, 120) * 60000) : null,
        dueDate,
        priority: "MEDIUM",
        score,
        reviewStatus: completed ? (instanceCount % 3 === 0 ? "APPROVED" : "PENDING_REVIEW") : null,
        reviewedBy: completed && instanceCount % 3 === 0 ? USER_ADMIN : null,
        reviewedAt: completed && instanceCount % 3 === 0 ? new Date(dueDate.getTime() + 120 * 60000) : null,
        createdAt: dueDate,
        data: {},
      });
      instanceMeta.push({ templateId: tmpl.id, scheduleId: scheduleRows[s]?.id, completed, assigneeId });
      instanceCount++;
    }
  }

  const insertedInstances = await db.insert(workflowInstances).values(instanceValues).returning({ id: workflowInstances.id, templateId: workflowInstances.workflowTemplateId, scheduleId: workflowInstances.scheduleId });
  for (let i = 0; i < insertedInstances.length; i++) {
    instanceRows.push({
      id: insertedInstances[i].id,
      templateId: instanceMeta[i].templateId,
      scheduleId: insertedInstances[i].scheduleId || undefined,
      assigneeId: instanceMeta[i].assigneeId,
    });
  }
  console.log(`  Created ${instanceRows.length} instances`);

  console.log("Creating workflow instance steps...");
  let stepCount = 0;
  const stepValues: any[] = [];
  const resolvedByTemplate = new Map<string, Awaited<ReturnType<typeof resolveDynamicSteps>>>();
  for (let instIdx = 0; instIdx < instanceRows.length; instIdx++) {
    const inst = instanceRows[instIdx];
    const tmpl = templates.find(t => (t as any).id === inst.templateId);
    if (!tmpl?.steps) continue;
    if (!resolvedByTemplate.has(inst.templateId)) {
      resolvedByTemplate.set(inst.templateId, await resolveDynamicSteps(tmpl.steps, { companyId: COMPANY_ID }));
    }
    const steps = resolvedByTemplate.get(inst.templateId)!;
    const source = instanceValues[instIdx];
    const isCompleted = instanceMeta[instIdx].completed;

    // El relevo de turno es real en HORECA —quien abre no siempre cierra— pero
    // es la excepción, no la regla. Una de cada doce ejecuciones se parte en dos
    // firmas para que la bitácora multi-persona siga siendo probable en la
    // pantalla de revisión; el resto las firma su asignado de principio a fin.
    const isHandoff = instIdx % 12 === 0 && steps.length >= 3;
    const handoffAt = isHandoff ? Math.ceil(steps.length * 0.6) : steps.length;
    const relief = USER_ADMIN;

    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];
      const stepCompleted = isCompleted;
      let value: any = null;
      let evidenceUrl: string | null = null;
      let aiAnalysis: any = null;

      if (stepCompleted) {
        switch (step.type) {
          case "PHOTO":
            // Distribución determinista sobre los ocho assets locales.
            value = demoEvidenceUrl(instIdx * 7 + stepIdx);
            evidenceUrl = value;
            break;
          case "NUMBER":
            value = String(step.validation?.min ?? 1);
            break;
          case "SELECT":
            value = step.options?.[0] ?? "Sin novedades";
            break;
          case "YESNO":
            value = "yes";
            break;
          case "CHECKBOX":
            value = step.options ? step.options.slice(0, randomInt(1, step.options.length)) : [];
            break;
          case "TEXT":
            value = "Todo en orden, sin novedades.";
            break;
          case "SIGNATURE":
            value = `https://pulso.ejemplo/firmas/${inst.id}-${step.id}.png`;
            break;
          default:
            value = "OK";
        }

        if (step.aiVerification?.enabled) {
          const aiScore = randomInt(60, 100);
          aiAnalysis = {
            // Contrato EVI-01: la confianza se persiste como fracción 0–1.
            // El porcentaje (60–100) es formato de presentación, no de storage.
            score: aiScore,
            passed: aiScore >= 85,
            confidence: aiScore / 100,
            notes: aiScore >= 85 ? "Verificación automática exitosa" : "Requiere revisión manual",
          };
        }
      }

      stepValues.push({
        instanceId: inst.id,
        stepId: step.id,
        stepOrder: stepIdx,
        title: (step as any).title || (step as any).label || `Paso ${stepIdx + 1}`,
        type: step.type,
        definition: step as unknown as Record<string, unknown>,
        status: stepCompleted ? "COMPLETED" : "PENDING",
        value: value as unknown as Record<string, unknown>,
        aiAnalysis: aiAnalysis as unknown as Record<string, unknown>,
        evidenceUrl,
        comment: stepCompleted ? notaDelPaso(aiAnalysis) : null,
        completedAt: stepCompleted ? source.completedAt : null,
        completedBy: stepCompleted
          ? (stepIdx < handoffAt ? inst.assigneeId : relief)
          : null,
      });
      stepCount++;
    }
  }
  if (stepValues.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < stepValues.length; i += chunkSize) {
      const chunk = stepValues.slice(i, i + chunkSize);
      await db.insert(workflowInstanceSteps).values(chunk);
    }
  }
  console.log(`  Created ${stepCount} steps`);

  console.log("Creating assignments...");
  let assignCount = 0;
  const assignValues: any[] = [];
  for (const inst of instanceRows) {
    const source = instanceValues[assignCount];
    const isCompleted = instanceMeta[assignCount].completed;
    assignValues.push({
      instanceId: inst.id,
      scheduleId: inst.scheduleId,
      assignedTo: inst.assigneeId,
      assignedBy: USER_ADMIN,
      assignmentType: "AUTO",
      status: isCompleted ? "COMPLETED" : source.dueDate < now ? "OVERDUE" : "PENDING",
      notifiedAt: isCompleted ? source.startedAt : null,
      startedAt: source.startedAt,
      completedAt: source.completedAt,
      dueDate: source.dueDate,
      priority: "MEDIUM",
    });
    assignCount++;
  }
  if (assignValues.length > 0) {
    await db.insert(workflowAssignments).values(assignValues);
    await db.execute(sql`UPDATE workflow_instances i SET assignment_id = a.id
      FROM workflow_assignments a WHERE a.instance_id = i.id AND i.branch_id IN
      (${BRANCH_CONDESA}, ${BRANCH_POLANCO}, ${BRANCH_ROMA})`);
  }
  console.log(`  Created ${assignCount} assignments`);

  console.log("Creating event triggers...");
  const eventTriggerData = [
    { templateIdx: 6, branchIdx: 0, eventName: "TEMPERATURE_HIGH", conditions: { threshold: 8, unit: "C" } },
    { templateIdx: 14, branchIdx: 0, eventName: "INVENTORY_LOW", conditions: { threshold: "minLevel" } },
    { templateIdx: 7, branchIdx: 0, eventName: "RECEIVING_INSPECT", conditions: { type: "fresh" } },
  ];
  const eventTriggerValues: any[] = [];
  for (const et of eventTriggerData) {
    const tmpl = scheduledTemplate(et.templateIdx);
    if (!tmpl) continue;
    eventTriggerValues.push({
      templateId: tmpl.id,
      branchId: BRANCHES[et.branchIdx],
      eventName: et.eventName,
      conditions: et.conditions as unknown as Record<string, unknown>,
      isActive: true,
      createdBy: USER_ADMIN,
    });
  }
  if (eventTriggerValues.length > 0) {
    await db.insert(eventTriggers).values(eventTriggerValues);
  }
  console.log(`  Created ${eventTriggerData.length} event triggers`);

  console.log("Phase 5 complete!");
}

// `seed-full` importa esta etapa y la encadena, por eso el módulo solo exportaba
// `main`. El efecto era que `pnpm seed:5` importaba el archivo, no llamaba a
// nada y salía con código 0: una siembra que "funcionaba" sin tocar la base.
// Bajo `require.main === module` solo corre cuando se invoca directamente.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
