import { seedRandom } from "./seed-scenarios";
import "dotenv/config";
import { db } from "@/lib/db";
import {
  performanceReviews, performanceReviewCriteria, performanceReviewResponses,
  performanceGoals,
  vacationRequests, vacationAccruals, leaveTypes, leaveRequests, leaveBalances,
  employeeTraining, employeeCommunications, communicationReadReceipts,
  messageTemplates,
  employeeProfiles,
} from "@/lib/db/schema";
import { seedDate } from "./seed-scenarios";
import { calculateLFT2026Benefits } from "@/lib/services/payroll-service";
import { differenceInYears } from "date-fns";
import { eq, sql } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3,
  branchForUser,
} from "./seed-constants";

function randomDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(seedRandom("08-hr-advanced") * daysAgo));
  return d;
}

function randomInt(min: number, max: number): number {
  return Math.floor(seedRandom("08-hr-advanced") * (max - min + 1)) + min;
}

const EMPLOYEES = [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_SUPERVISOR];

export async function main() {
  const today = seedDate();
  const year = today.getUTCFullYear();
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
    const type = reviewTypes[r % 3];
    const reviewerId = type === "SELF" ? userId : USER_ADMIN;
    const overallRating = Number((randomInt(30, 50) / 10).toFixed(2));
    const strengths = ["Buena actitud", "Alta productividad", "Trabajo en equipo", "Puntualidad", "Iniciativa"].slice(0, randomInt(2, 4)).join(", ");
    const areasForImprovement = ["Comunicación", "Gestión del tiempo", "Documentación", "Liderazgo"].slice(0, randomInt(1, 3)).join(", ");

    reviewValues.push({
      userId,
      reviewerId,
      companyId: COMPANY_ID,
      branchId: branchForUser(userId),
      reviewType: type,
      reviewPeriod: `${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}`,
      status: "COMPLETED",
      overallRating,
      strengths,
      areasForImprovement,
      goals: [{ goal: "Mejorar puntualidad", target: "0 retrasos", deadline: seedDate(30).toISOString().slice(0, 10) }] as unknown as Record<string, unknown>,
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
  for (const review of reviewRows) {
    const responses = responseValues.filter((row) => row.reviewId === review.id);
    const average = responses.reduce((sum, row) => sum + row.rating, 0) / responses.length;
    await db.update(performanceReviews).set({ overallRating: Number(average.toFixed(2)) }).where(eq(performanceReviews.id, review.id));
  }

  console.log("Creating performance goals...");
  const goalData = [
    { userId: USER_EMPLEADO_1, title: "Reducir merma de cocina", description: "Reducir desperdicio de alimentos en un 15%", category: "OPERATIONS", status: "IN_PROGRESS" as const, targetDate: seedDate(30) },
    { userId: USER_EMPLEADO_1, title: "Mejorar velocidad de servicio", description: "Reducir tiempo de preparación en 5 minutos por orden", category: "OPERATIONS", status: "IN_PROGRESS" as const, targetDate: seedDate(45) },
    { userId: USER_EMPLEADO_2, title: "Capacitación en seguridad alimentaria", description: "Completar curso NOM-251 con calificación superior a 90", category: "COMPLIANCE", status: "COMPLETED" as const, targetDate: seedDate(-7), completedDate: seedDate(-10) },
    { userId: USER_EMPLEADO_3, title: "Optimizar inventario de bebidas", description: "Implementar sistema de control de inventario de bar", category: "INVENTORY", status: "NOT_STARTED" as const, targetDate: seedDate(60) },
    { userId: USER_SUPERVISOR, title: "Reducir quejas de clientes", description: "Implementar protocolo de atención y reducir quejas en 30%", category: "OPERATIONS", status: "IN_PROGRESS" as const, targetDate: seedDate(21) },
  ];
  const goalValues = goalData.map(g => ({
    userId: g.userId,
    companyId: COMPANY_ID,
    branchId: branchForUser(g.userId),
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
    { userId: USER_EMPLEADO_1, startDate: seedDate(30), endDate: seedDate(36), totalDays: 7, status: "PENDING" as const, reason: "Vacaciones familiares" },
    { userId: USER_EMPLEADO_2, startDate: seedDate(14), endDate: seedDate(18), totalDays: 5, status: "APPROVED" as const, reason: "Viaje personal", approvedBy: USER_GERENTE, approvedAt: seedDate(-2) },
    { userId: USER_EMPLEADO_3, startDate: seedDate(7), endDate: seedDate(8), totalDays: 2, status: "REJECTED" as const, reason: "Alta demanda en el periodo", rejectedBy: USER_GERENTE, rejectedAt: seedDate(-1), rejectionReason: "No hay cobertura suficiente para esas fechas" },
  ];
  const vacationValues = vacationData.map(v => ({
    userId: v.userId,
    companyId: COMPANY_ID,
    branchId: branchForUser(v.userId),
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
  const profiles = await db.select().from(employeeProfiles);
  const entitlements = new Map<string, number>();
  for (const empId of EMPLOYEES) {
    const profile = profiles.find((p) => p.userId === empId);
    if (!profile?.hireDate) throw new Error(`Falta antigüedad para ${empId}`);
    const yearsOfService = Math.max(1, differenceInYears(today, profile.seniorityDate ?? profile.hireDate));
    const entitlement = calculateLFT2026Benefits(0, yearsOfService).vacationDays;
    entitlements.set(empId, entitlement);
    // Estimación mensual del demo, no un saldo autorizado ni un acumulado legal.
    for (let month = 0; month <= today.getUTCMonth(); month++) {
      const daysBalance = Math.floor(entitlement * (month + 1) / 12);
      const daysAccrued = daysBalance - Math.floor(entitlement * month / 12);
      accrualValues.push({ userId: empId, companyId: COMPANY_ID, year, month: month + 1,
        daysAccrued, daysTaken: 0, daysBalance, yearsOfService,
        applicableLawDays: entitlement, periodStart: new Date(Date.UTC(year, month, 1, 12)),
        periodEnd: month === today.getUTCMonth() ? today : new Date(Date.UTC(year, month + 1, 0, 12)),
        notes: "DEMO: estimación mensual informativa, no saldo autorizado. Días según el calculador actual del sistema.",
      });
    }
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
      name: "ENFERMEDAD_GENERAL",
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
  const leaveTypeSick = insertedLeaveTypes.find(t => t.name === "ENFERMEDAD_GENERAL")!;
  const leaveTypeUnpaid = insertedLeaveTypes.find(t => t.name === "PERMISO_PERSONAL")!;

  console.log("Creating leave requests...");
  await db.insert(leaveRequests).values([
    { userId: USER_EMPLEADO_1, companyId: COMPANY_ID, branchId: BRANCH_CONDESA, leaveTypeId: leaveTypeVacation.id, startDate: seedDate(30), endDate: seedDate(36), totalDays: 7, reason: "Vacaciones familiares", status: "PENDING" },
    { userId: USER_EMPLEADO_2, companyId: COMPANY_ID, branchId: BRANCH_POLANCO, leaveTypeId: leaveTypeSick.id, startDate: seedDate(-45), endDate: seedDate(-44), totalDays: 2, reason: "Enfermedad general: fuente auditable de aguinaldo", status: "APPROVED", approvedBy: USER_GERENTE, approvedAt: seedDate(-46) },
    { userId: USER_EMPLEADO_3, companyId: COMPANY_ID, branchId: BRANCH_ROMA, leaveTypeId: leaveTypeUnpaid.id, startDate: seedDate(-42), endDate: seedDate(-41), totalDays: 2, reason: "Permiso sin goce: fuente auditable de aguinaldo", status: "APPROVED", approvedBy: USER_GERENTE, approvedAt: seedDate(-43) },
  ]);

  console.log("Creating leave balances...");
  const leaveBalanceValues = EMPLOYEES.map(empId => ({
    userId: empId,
    leaveTypeId: leaveTypeVacation.id,
    year,
    totalEntitlement: entitlements.get(empId)!,
    used: 0,
    pending: empId === USER_EMPLEADO_1 ? 7 : empId === USER_EMPLEADO_2 ? 5 : 0,
    balance: entitlements.get(empId)! - (empId === USER_EMPLEADO_1 ? 7 : empId === USER_EMPLEADO_2 ? 5 : 0),
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
