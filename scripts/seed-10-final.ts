import "dotenv/config";
import { db } from "@/lib/db";
import {
  reportTemplates, reportExecutionHistory,
  inventoryAuditLog, employeeAuditLogs, savedSearches,
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

export async function main() {
  console.log("=== Phase 10: Final (Reports, Audit Logs, Saved Searches) ===");
  console.log("Cleaning up...");

  await db.delete(reportExecutionHistory).where(eq(reportExecutionHistory.companyId, COMPANY_ID));
  await db.delete(reportTemplates).where(eq(reportTemplates.companyId, COMPANY_ID));
  await db.delete(inventoryAuditLog).where(eq(inventoryAuditLog.companyId, COMPANY_ID));
  await db.delete(employeeAuditLogs).where(sql`1=1`);
  await db.delete(savedSearches).where(eq(savedSearches.companyId, COMPANY_ID));

  console.log("Creating report templates...");
  const [rep1] = await db.insert(reportTemplates).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    name: "Reporte de Cumplimiento Semanal",
    description: "Resumen semanal de cumplimiento operativo y NOM-251",
    reportType: "SCHEDULED",
    dataSource: "compliance",
    fields: ["branch", "score", "incidents", "compliance_rate"] as unknown as Record<string, unknown>,
    filters: { period: "weekly" } as unknown as Record<string, unknown>,
    groupBy: { field: "branch" } as unknown as Record<string, unknown>,
    sortBy: { field: "score", order: "desc" } as unknown as Record<string, unknown>,
    schedule: { frequency: "WEEKLY", dayOfWeek: 0, time: "08:00" } as unknown as Record<string, unknown>,
    deliveryMethod: "EMAIL",
    deliveryEmails: ["gerencia@pulso.mx"] as unknown as string[],
    createdBy: USER_ADMIN,
    isPublic: true,
    lastRunStatus: "SUCCESS",
    lastRunAt: randomDate(7),
    nextRunAt: new Date(Date.now() + 7 * 86400000),
  }).returning({ id: reportTemplates.id });

  await db.insert(reportTemplates).values([
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      name: "Reporte de Asistencia Mensual",
      description: "Control de asistencia, retardos y horas extra del mes",
      reportType: "SCHEDULED",
      dataSource: "attendance",
      fields: ["employee", "on_time", "late", "overtime", "absences"] as unknown as Record<string, unknown>,
      filters: { period: "monthly" } as unknown as Record<string, unknown>,
      schedule: { frequency: "MONTHLY", dayOfMonth: 1, time: "09:00" } as unknown as Record<string, unknown>,
      deliveryMethod: "DOWNLOAD",
      createdBy: USER_ADMIN,
      isPublic: false,
      sharedWith: [USER_GERENTE] as unknown as string[],
      lastRunStatus: "SUCCESS",
      lastRunAt: randomDate(30),
      nextRunAt: new Date(Date.now() + 25 * 86400000),
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      name: "Reporte de Inventario - Productos Críticos",
      description: "Estado actual de productos con alertas de stock y próximos a vencer",
      reportType: "STANDARD",
      dataSource: "inventory",
      fields: ["product", "current_stock", "min_level", "expiry_date"] as unknown as Record<string, unknown>,
      filters: { alertType: ["LOW_STOCK", "EXPIRING_SOON"] } as unknown as Record<string, unknown>,
      createdBy: USER_SUPERVISOR,
      isPublic: true,
    },
    {
      companyId: COMPANY_ID,
      name: "Dashboard Ejecutivo",
      description: "KPIs principales para dirección: cumplimiento, costos y productividad",
      reportType: "CUSTOM",
      dataSource: "kpi_dashboard",
      fields: ["kpi_name", "current_value", "target", "status", "trend"] as unknown as Record<string, unknown>,
      createdBy: USER_ADMIN,
      isPublic: true,
    },
  ]);

  console.log("Creating report execution history...");
  if (rep1) {
    await db.insert(reportExecutionHistory).values([
      { templateId: rep1.id, companyId: COMPANY_ID, reportType: "SCHEDULED", dataSource: "compliance", executedBy: USER_ADMIN, executedAt: randomDate(7), filters: { period: "weekly" } as unknown as Record<string, unknown>, fields: ["branch", "score"] as unknown as Record<string, unknown>, status: "SUCCESS", rowCount: 3, fileSize: 45000, durationMs: 1250 },
      { templateId: rep1.id, companyId: COMPANY_ID, reportType: "SCHEDULED", dataSource: "compliance", executedBy: USER_ADMIN, executedAt: randomDate(14), filters: { period: "weekly" } as unknown as Record<string, unknown>, fields: ["branch", "score"] as unknown as Record<string, unknown>, status: "SUCCESS", rowCount: 3, fileSize: 44000, durationMs: 1100 },
      { templateId: rep1.id, companyId: COMPANY_ID, reportType: "SCHEDULED", dataSource: "compliance", executedBy: USER_ADMIN, executedAt: randomDate(21), filters: { period: "weekly" } as unknown as Record<string, unknown>, fields: ["branch", "score"] as unknown as Record<string, unknown>, status: "FAILED", errorMessage: "Error al conectar con fuente de datos", durationMs: 30000 },
    ]);
  }

  console.log("Creating inventory audit logs...");
  const auditActions = ["CREATE", "UPDATE", "DELETE"] as const;
  const auditEntities = ["ITEM", "BATCH", "MOVEMENT", "TRANSFER", "WASTE", "RECEIVING", "ADJUSTMENT", "SUPPLIER"] as const;

  const auditValues: any[] = [];
  for (let a = 0; a < 55; a++) {
    const action = auditActions[a % 3];
    const entity = auditEntities[a % auditEntities.length];
    auditValues.push({
      companyId: COMPANY_ID,
      branchId: [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA][a % 3],
      action,
      entityType: entity,
      entityId: `entity-${a}`,
      oldValue: action !== "CREATE" ? { status: "previous" } : null,
      newValue: action !== "DELETE" ? { status: "current" } : null,
      performedBy: [USER_ADMIN, USER_GERENTE, USER_EMPLEADO_1][a % 3],
      performedAt: randomDate(30),
      reason: action === "CREATE" ? "Creación de registro" : action === "UPDATE" ? "Actualización de datos" : "Eliminación de registro",
      metadata: { source: "seed" } as unknown as Record<string, unknown>,
    });
  }
  await db.insert(inventoryAuditLog).values(auditValues);

  console.log("Creating employee audit logs...");
  const empAuditData = [
    { userId: USER_EMPLEADO_1, action: "UPDATE" as const, entityType: "SALARY", fieldName: "salario_diario", oldValue: { amount: 35000 }, newValue: { amount: 38000 }, performedBy: USER_ADMIN, isSensitive: true, reason: "Aumento salarial anual" },
    { userId: USER_EMPLEADO_2, action: "UPDATE" as const, entityType: "PROFILE", fieldName: "puesto", oldValue: { role: "EMPLEADO" }, newValue: { role: "SUPERVISOR" }, performedBy: USER_ADMIN, reason: "Promoción de puesto" },
    { userId: USER_EMPLEADO_3, action: "CREATE" as const, entityType: "CONTRACT", fieldName: null, oldValue: null, newValue: { type: "INDETERMINATE", salary: 32000 }, performedBy: USER_ADMIN, reason: "Contratación inicial" },
    { userId: USER_EMPLEADO_1, action: "UPDATE" as const, entityType: "DOCUMENT", fieldName: "documento_identificacion", oldValue: { status: "PENDING" }, newValue: { status: "VALIDATED" }, performedBy: USER_SUPERVISOR, reason: "Validación de documento" },
    { userId: USER_SUPERVISOR, action: "UPDATE" as const, entityType: "PROFILE", fieldName: "telefono", oldValue: { phone: "+525511110004" }, newValue: { phone: "+525511110044" }, performedBy: USER_ADMIN, reason: "Actualización de datos de contacto" },
  ];

  const empAuditValues = empAuditData.map(e => ({
    userId: e.userId,
    action: e.action,
    entityType: e.entityType,
    fieldName: e.fieldName,
    oldValue: e.oldValue as unknown as Record<string, unknown>,
    newValue: e.newValue as unknown as Record<string, unknown>,
    performedBy: e.performedBy,
    performedAt: randomDate(30),
    isSensitive: (e as any).isSensitive ?? false,
    reason: e.reason,
  }));
  await db.insert(employeeAuditLogs).values(empAuditValues);

  console.log("Creating saved searches...");
  await db.insert(savedSearches).values([
    { userId: USER_ADMIN, companyId: COMPANY_ID, name: "Empleados Activos - Condesa", description: "Lista de empleados activos en sucursal Condesa", searchCriteria: { filters: { branchId: BRANCH_CONDESA, status: "ACTIVE" }, sort: { field: "name", order: "asc" } } as unknown as Record<string, unknown>, entityType: "EMPLOYEE", isShared: true, sharedWith: [USER_GERENTE] as unknown as string[], usageCount: 15, lastUsedAt: randomDate(3) },
    { userId: USER_GERENTE, companyId: COMPANY_ID, name: "Incidentes Pendientes", description: "Incidentes abiertos que requieren atención", searchCriteria: { filters: { status: ["DETECTED", "IN_REMEDIATION"] }, sort: { field: "severity", order: "desc" } } as unknown as Record<string, unknown>, entityType: "INCIDENT", isShared: false, usageCount: 8, lastUsedAt: randomDate(1) },
    { userId: USER_SUPERVISOR, companyId: COMPANY_ID, name: "Productos Próximos a Vencer", description: "Lotes de inventario que vencen en los próximos 7 días", searchCriteria: { filters: { expiryDateRange: { from: "now", to: "+7days" }, status: "AVAILABLE" } } as unknown as Record<string, unknown>, entityType: "BATCH", isShared: true, sharedWith: [USER_ADMIN] as unknown as string[], usageCount: 22, lastUsedAt: randomDate(0) },
  ]);

  console.log("Phase 10 complete!");
}
