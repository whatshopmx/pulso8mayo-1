import "dotenv/config";
import { db } from "@/lib/db";
import {
  workflowTemplates, workflowSchedules, workflowInstances,
  workflowInstanceSteps, workflowAssignments, eventTriggers,
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getAllTemplates } from "@/templates/index";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3,
} from "./seed-constants";

function randomDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  return d;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const BRANCHES = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
const USERS = [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_SUPERVISOR, USER_GERENTE];

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
  if (Math.random() > 0.08) return null;
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

  console.log("Loading 19 templates from template library...");
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
  ];

  const scheduleRows: { id: string }[] = [];
  for (const sc of scheduleConfigs) {
    const tmpl = templateRows[sc.templateIdx];
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

      const tmpl = templateRows[sc.templateIdx];
      if (!tmpl) continue;

      const hours = parseInt(sc.time.split(":")[0]);
      const mins = parseInt(sc.time.split(":")[1]);
      const dueDate = new Date(date);
      dueDate.setHours(hours, mins, 0, 0);

      const completed = Math.random() > 0.15;
      const score = completed ? (Math.random() > 0.2 ? randomInt(70, 100) : randomInt(40, 69)) : undefined;

      const assigneeId = USERS[instanceCount % USERS.length];

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
  for (let instIdx = 0; instIdx < instanceRows.length; instIdx++) {
    const inst = instanceRows[instIdx];
    const tmpl = templates.find(t => (t as any).id === inst.templateId);
    if (!tmpl?.steps) continue;
    const steps = tmpl.steps.slice(0, Math.min(tmpl.steps.length, 8));
    const isCompleted = Math.random() > 0.15;

    // El relevo de turno es real en HORECA —quien abre no siempre cierra— pero
    // es la excepción, no la regla. Una de cada doce ejecuciones se parte en dos
    // firmas para que la bitácora multi-persona siga siendo probable en la
    // pantalla de revisión; el resto las firma su asignado de principio a fin.
    const isHandoff = instIdx % 12 === 0 && steps.length >= 3;
    const handoffAt = isHandoff ? Math.ceil(steps.length * 0.6) : steps.length;
    const relief = inst.assigneeId === USER_SUPERVISOR ? USER_GERENTE : USER_SUPERVISOR;

    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];
      const stepCompleted = isCompleted && Math.random() > 0.1;
      let value: any = null;
      let evidenceUrl: string | null = null;
      let aiAnalysis: any = null;

      if (stepCompleted) {
        switch (step.type) {
          case "PHOTO":
            value = `https://pulso.ejemplo/evidencia/${inst.id}-${step.id}.jpg`;
            evidenceUrl = value;
            break;
          case "NUMBER":
            value = randomInt(15, 40).toString();
            break;
          case "SELECT":
          case "YESNO":
            value = Math.random() > 0.3 ? "Sí" : "No";
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
            score: aiScore,
            passed: aiScore >= 85,
            confidence: aiScore,
            notes: aiScore >= 85 ? "Verificación automática exitosa" : "Requiere revisión manual",
          };
        }
      }

      stepValues.push({
        instanceId: inst.id,
        stepId: step.id,
        status: stepCompleted ? "COMPLETED" : "PENDING",
        value: value as unknown as Record<string, unknown>,
        aiAnalysis: aiAnalysis as unknown as Record<string, unknown>,
        evidenceUrl,
        comment: stepCompleted ? notaDelPaso(aiAnalysis) : null,
        completedAt: stepCompleted ? randomDate(1) : null,
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
  for (const inst of instanceRows.slice(0, 50)) {
    const isCompleted = Math.random() > 0.15;
    assignValues.push({
      instanceId: inst.id,
      scheduleId: inst.scheduleId,
      assignedTo: USERS[assignCount % USERS.length],
      assignedBy: USER_ADMIN,
      assignmentType: "AUTO",
      status: isCompleted ? "COMPLETED" : "PENDING",
      notifiedAt: isCompleted ? randomDate(1) : null,
      startedAt: isCompleted ? randomDate(1) : null,
      completedAt: isCompleted ? randomDate(1) : null,
      dueDate: randomDate(1),
      priority: "MEDIUM",
    });
    assignCount++;
  }
  if (assignValues.length > 0) {
    await db.insert(workflowAssignments).values(assignValues);
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
    const tmpl = templateRows[et.templateIdx];
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
