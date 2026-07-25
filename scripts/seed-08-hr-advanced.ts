import "dotenv/config";
import { db } from "@/lib/db";
import {
  performanceReviews, performanceReviewCriteria, performanceReviewResponses,
  performanceGoals,
  vacationRequests, vacationAccruals, leaveTypes, leaveRequests, leaveBalances,
  employeeTraining, employeeCommunications, communicationReadReceipts,
  messageTemplates,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
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

const EMPLOYEES = [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_SUPERVISOR];
const BRANCHES = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];

export async function main() {
  console.log("=== Phase 8: HR Advanced ===");
  console.log("Cleaning up...");

  await db.delete(communicationReadReceipts).where(sql`1=1`);
  await db.delete(employeeCommunications).where(eq(employeeCommunications.companyId, COMPANY_ID));
  await db.delete(messageTemplates).where(eq(messageTemplates.companyId, COMPANY_ID));
  await db.delete(performanceReviewResponses).where(sql`1=1`);
  await db.delete(performanceReviewCriteria).where(eq(performanceReviewCriteria.companyId, COMPANY_ID));
  await db.delete(performanceReviews).where(eq(performanceReviews.companyId, COMPANY_ID));
  await db.delete(performanceGoals).where(eq(performanceGoals.companyId, COMPANY_ID));
  await db.delete(leaveRequests).where(eq(leaveRequests.companyId, COMPANY_ID));
  await db.delete(leaveBalances).where(sql`1=1`);
  await db.delete(leaveTypes).where(eq(leaveTypes.companyId, COMPANY_ID));
  await db.delete(vacationAccruals).where(eq(vacationAccruals.companyId, COMPANY_ID));
  await db.delete(vacationRequests).where(eq(vacationRequests.companyId, COMPANY_ID));
  await db.delete(employeeTraining).where(eq(employeeTraining.companyId, COMPANY_ID));

  console.log("Creating performance review criteria...");
  const criteriaData = [
    { name: "Calidad del Trabajo", description: "Precisión y calidad en las tareas realizadas", category: "TECHNICAL" as const, weight: 10 },
    { name: "Puntualidad", description: "Cumplimiento de horarios y fechas límite", category: "TECHNICAL" as const, weight: 8 },
    { name: "Trabajo en Equipo", description: "Colaboración con compañeros y actitud", category: "TEAMWORK" as const, weight: 9 },
    { name: "Comunicación", description: "Claridad y efectividad en la comunicación", category: "COMMUNICATION" as const, weight: 7 },
    { name: "Resolución de Problemas", description: "Capacidad para identificar y resolver problemas", category: "PROBLEM_SOLVING" as const, weight: 8 },
    { name: "Liderazgo", description: "Capacidad de guiar y motivar al equipo", category: "LEADERSHIP" as const, weight: 6 },
    { name: "Atención al Cliente", description: "Calidad en el servicio al cliente", category: "SOFT_SKILLS" as const, weight: 9 },
    { name: "Conocimiento Técnico", description: "Dominio de procedimientos y normativas", category: "TECHNICAL" as const, weight: 8 },
  ];

  const criteriaValues = criteriaData.map(c => ({
    companyId: COMPANY_ID,
    name: c.name,
    description: c.description,
    category: c.category,
    weight: c.weight,
    isActive: true,
  }));
  const criteriaRows = await db.insert(performanceReviewCriteria).values(criteriaValues).returning({ id: performanceReviewCriteria.id, name: performanceReviewCriteria.name });

  console.log("Creating performance reviews...");
  const reviewTypes = ["SELF" as const, "MANAGER" as const, "360" as const];
  const reviewValues: any[] = [];

  for (let r = 0; r < 4; r++) {
    const userId = EMPLOYEES[r % EMPLOYEES.length];
    const reviewerId = r === 0 ? USER_GERENTE : r === 1 ? USER_ADMIN : USER_SUPERVISOR;
    const type = reviewTypes[r % 3];
    const overallRating = randomInt(3, 5);
    const strengths = ["Buena actitud", "Alta productividad", "Trabajo en equipo", "Puntualidad", "Iniciativa"].slice(0, randomInt(2, 4)).join(", ");
    const areasForImprovement = ["Comunicación", "Gestión del tiempo", "Documentación", "Liderazgo"].slice(0, randomInt(1, 3)).join(", ");

    reviewValues.push({
      userId,
      reviewerId,
      companyId: COMPANY_ID,
      branchId: BRANCHES[r % 3],
      reviewType: type,
      reviewPeriod: "2026-Q1",
      status: "COMPLETED",
      overallRating,
      strengths,
      areasForImprovement,
      goals: [{ goal: "Mejorar puntualidad", target: "0 retrasos", deadline: "2026-06-30" }] as unknown as Record<string, unknown>,
      achievements: [{ achievement: "Completar todos los turnos asignados" }] as unknown as Record<string, unknown>,
      developmentPlan: "Capacitación en atención al cliente y manejo de alimentos",
      comments: "El empleado muestra compromiso y mejora continua",
      submittedAt: randomDate(20),
      completedAt: randomDate(15),
      createdBy: USER_ADMIN,
    });
  }
  const reviewRows = await db.insert(performanceReviews).values(reviewValues).returning({ id: performanceReviews.id });

  console.log("Creating performance review responses...");
  const responseValues: any[] = [];
  for (const rev of reviewRows) {
    for (const crit of criteriaRows) {
      responseValues.push({
        reviewId: rev.id,
        criteriaId: crit.id,
        rating: randomInt(3, 5),
        comments: `Evaluación en ${crit.name}: cumple con los estándares esperados`,
      });
    }
  }
  await db.insert(performanceReviewResponses).values(responseValues);

  console.log("Creating performance goals...");
  const goalData = [
    { userId: USER_EMPLEADO_1, title: "Reducir merma de cocina", description: "Reducir desperdicio de alimentos en un 15%", category: "OPERATIONS", status: "IN_PROGRESS" as const, targetDate: new Date("2026-08-30") },
    { userId: USER_EMPLEADO_1, title: "Mejorar velocidad de servicio", description: "Reducir tiempo de preparación en 5 minutos por orden", category: "OPERATIONS", status: "IN_PROGRESS" as const, targetDate: new Date("2026-07-15") },
    { userId: USER_EMPLEADO_2, title: "Capacitación en seguridad alimentaria", description: "Completar curso NOM-251 con calificación superior a 90", category: "COMPLIANCE", status: "COMPLETED" as const, targetDate: new Date("2026-05-01"), completedDate: new Date("2026-04-28") },
    { userId: USER_EMPLEADO_3, title: "Optimizar inventario de bebidas", description: "Implementar sistema de control de inventario de bar", category: "INVENTORY", status: "NOT_STARTED" as const, targetDate: new Date("2026-09-01") },
    { userId: USER_SUPERVISOR, title: "Reducir quejas de clientes", description: "Implementar protocolo de atención y reducir quejas en 30%", category: "OPERATIONS", status: "IN_PROGRESS" as const, targetDate: new Date("2026-08-01") },
  ];
  const goalValues = goalData.map(g => ({
    userId: g.userId,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    title: g.title,
    description: g.description,
    category: g.category,
    status: g.status,
    targetDate: g.targetDate,
    completedDate: (g as any).completedDate,
    createdBy: USER_ADMIN,
  }));
  await db.insert(performanceGoals).values(goalValues);

  console.log("Creating vacation requests...");
  const vacationData = [
    { userId: USER_EMPLEADO_1, startDate: new Date("2026-08-10"), endDate: new Date("2026-08-17"), totalDays: 7, status: "PENDING" as const, reason: "Vacaciones familiares" },
    { userId: USER_EMPLEADO_2, startDate: new Date("2026-05-01"), endDate: new Date("2026-05-05"), totalDays: 5, status: "APPROVED" as const, reason: "Viaje personal", approvedBy: USER_GERENTE, approvedAt: new Date("2026-04-20") },
    { userId: USER_EMPLEADO_3, startDate: new Date("2026-03-15"), endDate: new Date("2026-03-16"), totalDays: 2, status: "REJECTED" as const, reason: "Alta demanda en el periodo", rejectedBy: USER_GERENTE, rejectedAt: new Date("2026-03-01"), rejectionReason: "No hay cobertura suficiente para esas fechas" },
  ];
  const vacationValues = vacationData.map(v => ({
    userId: v.userId,
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    startDate: v.startDate,
    endDate: v.endDate,
    totalDays: v.totalDays,
    status: v.status,
    reason: v.reason,
    approvedBy: (v as any).approvedBy,
    approvedAt: (v as any).approvedAt,
    rejectedBy: (v as any).rejectedBy,
    rejectedAt: (v as any).rejectedAt,
    rejectionReason: (v as any).rejectionReason,
  }));
  await db.insert(vacationRequests).values(vacationValues);

  console.log("Creating vacation accruals...");
  const accrualValues: any[] = [];
  for (const empId of EMPLOYEES) {
    accrualValues.push(
      { userId: empId, companyId: COMPANY_ID, year: 2026, month: 1, daysAccrued: 2, daysTaken: 0, daysBalance: 2, yearsOfService: 2, applicableLawDays: 12, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") },
      { userId: empId, companyId: COMPANY_ID, year: 2026, month: 2, daysAccrued: 2, daysTaken: 0, daysBalance: 4, yearsOfService: 2, applicableLawDays: 12, periodStart: new Date("2026-02-01"), periodEnd: new Date("2026-02-28") },
    );
  }
  await db.insert(vacationAccruals).values(accrualValues);

  console.log("Creating leave types...");
  const insertedLeaveTypes = await db.insert(leaveTypes).values([
    {
      companyId: COMPANY_ID,
      name: "VACACIONES",
      description: "Vacaciones anuales según LFT",
      isPaid: true,
      requiresDocumentation: false,
      maxDaysPerYear: 12,
      accrualRate: 12,
      isActive: true,
    },
    {
      companyId: COMPANY_ID,
      name: "INCAPACIDAD_MEDICA",
      description: "Incapacidad por enfermedad o accidente",
      isPaid: true,
      requiresDocumentation: true,
      maxDaysPerYear: 30,
      isActive: true,
    },
    {
      companyId: COMPANY_ID,
      name: "PERMISO_PERSONAL",
      description: "Permiso sin goce de sueldo",
      isPaid: false,
      requiresDocumentation: false,
      maxDaysPerYear: 5,
      isActive: true,
    }
  ]).returning({ id: leaveTypes.id, name: leaveTypes.name });

  const leaveTypeVacation = insertedLeaveTypes.find(t => t.name === "VACACIONES")!;
  const leaveTypeSick = insertedLeaveTypes.find(t => t.name === "INCAPACIDAD_MEDICA")!;

  console.log("Creating leave requests...");
  await db.insert(leaveRequests).values([
    { userId: USER_EMPLEADO_1, companyId: COMPANY_ID, branchId: BRANCH_CONDESA, leaveTypeId: leaveTypeVacation.id, startDate: new Date("2026-08-10"), endDate: new Date("2026-08-17"), totalDays: 7, reason: "Vacaciones familiares", status: "PENDING" },
    { userId: USER_EMPLEADO_2, companyId: COMPANY_ID, branchId: BRANCH_POLANCO, leaveTypeId: leaveTypeSick.id, startDate: new Date("2026-04-10"), endDate: new Date("2026-04-11"), totalDays: 2, reason: "Incapacidad médica", status: "APPROVED", approvedBy: USER_GERENTE, approvedAt: new Date("2026-04-09") },
  ]);

  console.log("Creating leave balances...");
  const leaveBalanceValues = EMPLOYEES.map(empId => ({
    userId: empId,
    leaveTypeId: leaveTypeVacation.id,
    year: 2026,
    totalEntitlement: 12,
    used: empId === USER_EMPLEADO_2 ? 5 : 0,
    pending: empId === USER_EMPLEADO_1 ? 7 : 0,
    balance: empId === USER_EMPLEADO_2 ? 7 : 12,
  }));
  await db.insert(leaveBalances).values(leaveBalanceValues);

  console.log("Creating employee training records...");
  const trainingData = [
    { userId: USER_EMPLEADO_1, name: "Prácticas Higiénicas NOM-251", type: "MANDATORY" as const, instructor: "Carlos Méndez", status: "COMPLETED" as const, grade: "92", passed: true, isMandatory: true, cost: 0, companyPaid: true },
    { userId: USER_EMPLEADO_1, name: "Manejo de Alimentos", type: "COMPLIANCE" as const, instructor: "María García", status: "COMPLETED" as const, grade: "88", passed: true, isMandatory: true, cost: 0, companyPaid: true },
    { userId: USER_EMPLEADO_2, name: "Prácticas Higiénicas NOM-251", type: "MANDATORY" as const, instructor: "Carlos Méndez", status: "COMPLETED" as const, grade: "95", passed: true, isMandatory: true, cost: 0, companyPaid: true },
    { userId: USER_EMPLEADO_2, name: "Seguridad en el Trabajo", type: "SAFETY" as const, instructor: "Protección Civil", status: "COMPLETED" as const, grade: "90", passed: true, isMandatory: false, cost: 0, companyPaid: true },
    { userId: USER_EMPLEADO_3, name: "Prácticas Higiénicas NOM-251", type: "MANDATORY" as const, instructor: "Carlos Méndez", status: "IN_PROGRESS" as const, grade: null, passed: null, isMandatory: true, cost: 0, companyPaid: true },
    { userId: USER_SUPERVISOR, name: "Liderazgo y Supervisión", type: "SKILL_DEVELOPMENT" as const, instructor: "RH", status: "COMPLETED" as const, grade: "85", passed: true, isMandatory: false, cost: 250000, companyPaid: true },
    { userId: USER_SUPERVISOR, name: "NOM-035 Factores Psicosociales", type: "COMPLIANCE" as const, instructor: "María García", status: "COMPLETED" as const, grade: "91", passed: true, isMandatory: true, cost: 0, companyPaid: true },
  ];

  const trainingValues = trainingData.map(t => ({
    userId: t.userId,
    companyId: COMPANY_ID,
    trainingName: t.name,
    trainingType: t.type,
    instructor: t.instructor,
    startDate: randomDate(60),
    endDate: randomDate(30),
    completionDate: t.status === "COMPLETED" ? randomDate(15) : null,
    status: t.status,
    grade: t.grade,
    passed: t.passed,
    isMandatory: t.isMandatory,
    cost: t.cost,
    companyPaid: t.companyPaid,
    notes: null,
    createdBy: USER_ADMIN,
  }));
  await db.insert(employeeTraining).values(trainingValues);

  console.log("Creating employee communications...");
  const [comm1] = await db.insert(employeeCommunications).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    communicationType: "ANNOUNCEMENT",
    title: "Nuevo menú de temporada",
    content: "A partir del 1 de agosto, lanzaremos nuestro nuevo menú de temporada con ingredientes frescos. Favor de revisar las recetas actualizadas.",
    targetType: "BRANCH",
    targetIds: [BRANCH_CONDESA] as unknown as string[],
    targetRoles: ["EMPLEADO", "SUPERVISOR"] as unknown as string[],
    status: "SENT",
    sentAt: new Date(Date.now() - 15 * 86400000),
    deliveredVia: ["IN_APP"] as unknown as string[],
    readCount: 2,
    totalRecipients: 3,
    createdBy: USER_ADMIN,
  }).returning({ id: employeeCommunications.id });

  await db.insert(employeeCommunications).values([
    {
      companyId: COMPANY_ID,
      communicationType: "ANNOUNCEMENT",
      title: "Recordatorio: Capacitación NOM-251",
      content: "Todos los empleados deben completar la capacitación NOM-251 antes del 30 de septiembre. Favor de agendar.",
      targetType: "COMPANY",
      targetRoles: ["EMPLEADO"] as unknown as string[],
      status: "SENT",
      sentAt: new Date(Date.now() - 5 * 86400000),
      deliveredVia: ["IN_APP", "EMAIL"] as unknown as string[],
      readCount: 1,
      totalRecipients: 4,
      createdBy: USER_ADMIN,
    },
    {
      companyId: COMPANY_ID,
      communicationType: "MESSAGE",
      title: "Bienvenida nuevo integrante",
      content: "Demos la bienvenida a nuestro nuevo cocinero que se une al equipo de Condesa.",
      targetType: "BRANCH",
      targetIds: [BRANCH_CONDESA] as unknown as string[],
      targetRoles: ["EMPLEADO"] as unknown as string[],
      status: "SENT",
      sentAt: new Date(Date.now() - 20 * 86400000),
      deliveredVia: ["IN_APP"] as unknown as string[],
      readCount: 2,
      totalRecipients: 3,
      createdBy: USER_ADMIN,
    },
  ]);

  if (comm1) {
    await db.insert(communicationReadReceipts).values([
      { communicationId: comm1.id, userId: USER_EMPLEADO_1, readAt: randomDate(14) },
      { communicationId: comm1.id, userId: USER_EMPLEADO_2, readAt: randomDate(13) },
    ]);
  }

  console.log("Creating message templates...");
  await db.insert(messageTemplates).values([
    { companyId: COMPANY_ID, name: "Recordatorio de Turno", subject: "Recordatorio: Tu turno comienza pronto", content: "Hola {{nombre}}, recuerda que tu turno inicia a las {{hora}} en {{sucursal}}.", communicationType: "MESSAGE", variables: ["nombre", "hora", "sucursal"] as unknown as string[], isActive: true, createdBy: USER_ADMIN },
    { companyId: COMPANY_ID, name: "Aviso de Capacitación", subject: "Capacitación programada", content: "Se ha programado una capacitación de {{curso}} para el {{fecha}}. Favor de confirmar asistencia.", communicationType: "MESSAGE", variables: ["curso", "fecha"] as unknown as string[], isActive: true, createdBy: USER_ADMIN },
    { companyId: COMPANY_ID, name: "Felicidades Cumpleaños", subject: "¡Feliz Cumpleaños!", content: "En nombre de todo el equipo de Pulso, te deseamos un feliz cumpleaños {{nombre}}. ¡Gracias por tu dedicación!", communicationType: "ANNOUNCEMENT", variables: ["nombre"] as unknown as string[], isActive: true, createdBy: USER_ADMIN },
  ]);

  console.log("Phase 8 complete!");
}
