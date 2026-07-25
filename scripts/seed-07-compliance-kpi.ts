import "dotenv/config";
import { db } from "@/lib/db";
import {
  incidents, remediationActions, complianceAlerts,
  kpiDefinitions, kpiHistory, kpiAlerts, kpiSnapshotLogs,
  psychosocialSurveys,
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

const BRANCHES = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
const USERS = [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_SUPERVISOR, USER_GERENTE];

export async function main() {
  console.log("=== Phase 7: Compliance & KPI ===");
  console.log("Cleaning up...");

  await db.delete(psychosocialSurveys).where(eq(psychosocialSurveys.companyId, COMPANY_ID));
  await db.delete(kpiSnapshotLogs).where(eq(kpiSnapshotLogs.companyId, COMPANY_ID));
  await db.delete(kpiAlerts).where(sql`1=1`);
  await db.delete(kpiHistory).where(sql`1=1`);
  await db.delete(kpiDefinitions).where(eq(kpiDefinitions.companyId, COMPANY_ID));
  await db.delete(complianceAlerts).where(eq(complianceAlerts.companyId, COMPANY_ID));
  await db.delete(remediationActions).where(sql`1=1`);
  await db.delete(incidents).where(sql`1=1`);

  console.log("Inserting incidents...");
  const incidentData = [
    { branchIdx: 0, severity: "CRITICAL" as const, status: "RESOLVED" as const, title: "Fuga de gas en cocina Condesa", description: "Se detectó olor a gas en la cocina principal. Se evacuó el área y se cerró la válvula general.", detectedByIdx: 3 },
    { branchIdx: 0, severity: "WARNING" as const, status: "RESOLVED" as const, title: "Temperatura de refrigerador elevada", description: "Refrigerador principal marcó 12°C durante 30 minutos. Se revisó y corrigió.", detectedByIdx: 0 },
    { branchIdx: 1, severity: "WARNING" as const, status: "CONFIRMED" as const, title: "Incumplimiento en limpieza de campana", description: "La campana extractora de Polanco no se limpió en la fecha programada.", detectedByIdx: 3 },
    { branchIdx: 2, severity: "CRITICAL" as const, status: "IN_REMEDIATION" as const, title: "Plaga de cucarachas en almacén Roma", description: "Se detectaron cucarachas en el almacén seco. Se requiere fumigación urgente.", detectedByIdx: 1 },
    { branchIdx: 0, severity: "FATAL" as const, status: "ESCALATED" as const, title: "Incendio menor en parrilla", description: "Una llamarada en la parrilla activó los rociadores. Daños menores.", detectedByIdx: 2 },
    { branchIdx: 1, severity: "WARNING" as const, status: "DETECTED" as const, title: "Producto vencido en refrigerador", description: "Se encontraron 3 kg de queso caducado en el refrigerador de Polanco.", detectedByIdx: 1 },
  ];

  const incidentValues = incidentData.map(inc => ({
    instanceId: "00000000-0000-0000-0000-000000000001",
    stepId: "incident-auto",
    branchId: BRANCHES[inc.branchIdx],
    severity: inc.severity,
    status: inc.status,
    title: inc.title,
    description: inc.description,
    detectedBy: USERS[inc.detectedByIdx],
    resolution: inc.status === "RESOLVED" ? "Se aplicó protocolo de corrección y se documentó" : undefined,
    resolvedBy: inc.status === "RESOLVED" ? USER_GERENTE : undefined,
    resolvedAt: inc.status === "RESOLVED" ? randomDate(5) : undefined,
  }));
  const incidentRows = await db.insert(incidents).values(incidentValues).returning({ id: incidents.id });

  console.log("Inserting remediation actions...");
  if (incidentRows.length >= 2) {
    await db.insert(remediationActions).values([
      {
        incidentId: incidentRows[0].id,
        branchId: BRANCH_CONDESA,
        companyId: COMPANY_ID,
        actionType: "SCHEDULE_COMPLIANCE_SERVICE",
        serviceType: "GAS_INSPECTION",
        status: "COMPLETED",
        confirmedBy: USER_ADMIN,
        confirmedAt: randomDate(10),
        scheduledDate: randomDate(8),
        completedAt: randomDate(7),
        result: "Se reparó fuga en conexión de la estufa. Instalación segura.",
      },
      {
        incidentId: incidentRows[3].id,
        branchId: BRANCH_ROMA,
        companyId: COMPANY_ID,
        actionType: "SCHEDULE_COMPLIANCE_SERVICE",
        serviceType: "FUMIGATION",
        status: "PENDING",
        confirmedBy: USER_ADMIN,
        confirmedAt: randomDate(3),
        scheduledDate: new Date(Date.now() + 3 * 86400000),
        result: null,
      },
      {
        incidentId: incidentRows[4].id,
        branchId: BRANCH_CONDESA,
        companyId: COMPANY_ID,
        actionType: "SCHEDULE_COMPLIANCE_SERVICE",
        serviceType: "FIRE_SYSTEM_CHECK",
        status: "CONFIRMED",
        confirmedBy: USER_ADMIN,
        confirmedAt: randomDate(2),
        scheduledDate: new Date(Date.now() + 7 * 86400000),
        result: null,
      },
    ]);
  }

  console.log("Inserting compliance alerts...");
  await db.insert(complianceAlerts).values([
    { companyId: COMPANY_ID, branchId: BRANCH_POLANCO, alertType: "MISSED_DEADLINE", severity: "WARNING", status: "ACTIVE", title: "Limpieza de campana atrasada", description: "El mantenimiento de la campana extractora en Polanco no se completó en el plazo establecido", complianceType: "NOM-251", currentScore: 60, threshold: 80 },
    { companyId: COMPANY_ID, branchId: BRANCH_ROMA, alertType: "LOW_SCORE", severity: "CRITICAL", status: "ACTIVE", title: "Score de cumplimiento bajo en Roma", description: "El score de cumplimiento NOM-251 en Roma está por debajo del mínimo aceptable", complianceType: "NOM-251", currentScore: 45, threshold: 70 },
    { companyId: COMPANY_ID, branchId: BRANCH_CONDESA, alertType: "LOW_SCORE", severity: "WARNING", status: "ACKNOWLEDGED", title: "Incidente de temperatura recurrente", description: "Múltiples alertas de temperatura en el refrigerador principal de Condesa", complianceType: "NOM-251", currentScore: 65, threshold: 80, acknowledgedBy: USER_GERENTE, acknowledgedAt: randomDate(3) },
    { companyId: COMPANY_ID, branchId: BRANCH_POLANCO, alertType: "NON_COMPLIANCE", severity: "WARNING", status: "DISMISSED", title: "Falta de capacitación NOM-035", description: "3 empleados no han completado la capacitación NOM-035", complianceType: "NOM-035", currentScore: 70, threshold: 100, resolvedBy: USER_ADMIN, resolvedAt: randomDate(15), resolutionNotes: "Se programaron sesiones de capacitación" },
  ]);

  console.log("Creating KPI definitions...");
  const kpiDefs = [
    { name: "Cumplimiento Operativo", description: "Porcentaje de workflows completados a tiempo", formula: "completed_on_time / total_scheduled * 100", metricType: "PERCENTAGE" as const, target: 9000, warningThreshold: 8000, criticalThreshold: 7000, thresholdType: "TARGET" as const, frequency: "DAILY" as const, unit: "%", category: "OPERATIONS", isSystem: true },
    { name: "Cumplimiento Laboral", description: "Porcentaje de turnos con check-in a tiempo", formula: "on_time_shifts / total_shifts * 100", metricType: "PERCENTAGE" as const, target: 9500, warningThreshold: 8500, criticalThreshold: 7500, thresholdType: "TARGET" as const, frequency: "DAILY" as const, unit: "%", category: "LABOR", isSystem: true },
    { name: "Precisión de Inventario", description: "Exactitud del conteo de inventario vs sistema", formula: "accurate_items / total_items * 100", metricType: "PERCENTAGE" as const, target: 9500, warningThreshold: 9000, criticalThreshold: 8500, thresholdType: "TARGET" as const, frequency: "WEEKLY" as const, unit: "%", category: "INVENTORY", isSystem: true },
    { name: "Costo Laboral", description: "Costo de nómina como porcentaje de ingresos", formula: "labor_cost / revenue * 100", metricType: "PERCENTAGE" as const, target: 3000, warningThreshold: 3500, criticalThreshold: 4000, thresholdType: "MAX" as const, frequency: "WEEKLY" as const, unit: "%", category: "LABOR", isSystem: true },
    { name: "Temperaturas Conformes", description: "Porcentaje de lecturas de temperatura en rango", formula: "compliant_readings / total_readings * 100", metricType: "PERCENTAGE" as const, target: 9500, warningThreshold: 9000, criticalThreshold: 8000, thresholdType: "TARGET" as const, frequency: "DAILY" as const, unit: "%", category: "COMPLIANCE", isSystem: true },
    { name: "Alertas Resueltas", description: "Porcentaje de alertas resueltas dentro del tiempo", formula: "resolved_alerts / total_alerts * 100", metricType: "PERCENTAGE" as const, target: 9000, warningThreshold: 8000, criticalThreshold: 7000, thresholdType: "TARGET" as const, frequency: "DAILY" as const, unit: "%", category: "COMPLIANCE", isSystem: true },
    { name: "Incidentes por Día", description: "Número de incidentes reportados por día", formula: "total_incidents", metricType: "COUNT" as const, target: 200, warningThreshold: 500, criticalThreshold: 1000, thresholdType: "MAX" as const, frequency: "DAILY" as const, unit: "incidentes", category: "OPERATIONS", isSystem: true },
    { name: "Satisfacción Cliente", description: "Score de satisfacción del cliente (NPS)", formula: "avg_satisfaction_score", metricType: "PERCENTAGE" as const, target: 8500, warningThreshold: 7500, criticalThreshold: 6000, thresholdType: "TARGET" as const, frequency: "MONTHLY" as const, unit: "%", category: "OPERATIONS", isSystem: false },
    { name: "Rotación de Personal", description: "Porcentaje mensual de rotación de personal", formula: "employees_left / total_employees * 100", metricType: "PERCENTAGE" as const, target: 500, warningThreshold: 1000, criticalThreshold: 1500, thresholdType: "MAX" as const, frequency: "MONTHLY" as const, unit: "%", category: "LABOR", isSystem: true },
    { name: "Cumplimiento NOM-251", description: "Score general de cumplimiento NOM-251", formula: "nom251_score", metricType: "PERCENTAGE" as const, target: 9000, warningThreshold: 8000, criticalThreshold: 7000, thresholdType: "TARGET" as const, frequency: "DAILY" as const, unit: "%", category: "COMPLIANCE", isSystem: true },
  ];

  const kpiValues = kpiDefs.map(kpi => ({
    companyId: COMPANY_ID,
    name: kpi.name,
    description: kpi.description,
    formula: kpi.formula,
    metricType: kpi.metricType,
    target: kpi.target,
    warningThreshold: kpi.warningThreshold,
    criticalThreshold: kpi.criticalThreshold,
    thresholdType: kpi.thresholdType,
    frequency: kpi.frequency,
    unit: kpi.unit,
    category: kpi.category,
    active: true,
    isSystem: kpi.isSystem,
    createdBy: USER_ADMIN,
  }));
  const kpiRows = await db.insert(kpiDefinitions).values(kpiValues).returning({ id: kpiDefinitions.id });

  console.log("Inserting 30 days of KPI history...");
  const kpiHistoryValues: any[] = [];
  for (let d = 0; d < 30; d++) {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 30 + d);
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 1);

    for (let k = 0; k < kpiRows.length; k++) {
      const baseValue = 8000 + randomInt(-2000, 1500);
      const value = Math.max(0, Math.min(10000, baseValue));
      const status = value >= (kpiDefs[k].warningThreshold ?? 7000) ? "NORMAL" as const :
                     value >= (kpiDefs[k].criticalThreshold ?? 6000) ? "WARNING" as const : "CRITICAL" as const;

      kpiHistoryValues.push({
        kpiId: kpiRows[k].id,
        branchId: BRANCHES[d % 3],
        value,
        periodStart,
        periodEnd,
        status,
        target: kpiDefs[k].target,
        targetAchieved: value >= (kpiDefs[k].target ?? 8000),
        calculatedAt: new Date(),
      });
    }
  }
  await db.insert(kpiHistory).values(kpiHistoryValues);

  console.log("Inserting KPI alerts...");
  await db.insert(kpiAlerts).values([
    { kpiId: kpiRows[0].id, branchId: BRANCH_CONDESA, alertType: "WARNING", status: "ACTIVE", triggeredValue: 7200, threshold: 8000, title: "Cumplimiento operativo bajo", message: "El cumplimiento operativo en Condesa ha caído al 72%", acknowledgedBy: USER_GERENTE, acknowledgedAt: randomDate(2) },
    { kpiId: kpiRows[4].id, branchId: BRANCH_ROMA, alertType: "CRITICAL", status: "ACTIVE", triggeredValue: 6500, threshold: 8000, title: "Temperaturas fuera de rango en Roma", message: "Solo el 65% de las lecturas de temperatura están en rango en Roma" },
    { kpiId: kpiRows[9].id, branchId: BRANCH_POLANCO, alertType: "WARNING", status: "RESOLVED", triggeredValue: 7400, threshold: 8000, title: "Cumplimiento NOM-251 bajo en Polanco", message: "Score NOM-251 en Polanco al 74%", acknowledgedBy: USER_ADMIN, acknowledgedAt: randomDate(10), resolvedBy: USER_ADMIN, resolvedAt: randomDate(8), resolutionNotes: "Se implementaron acciones correctivas" },
  ]);

  console.log("Inserting KPI snapshot logs...");
  const snapshotValues: any[] = [];
  for (let s = 0; s < 4; s++) {
    const snapshotDate = new Date();
    snapshotDate.setDate(snapshotDate.getDate() - s * 7);
    const metrics: Record<string, number> = {};
    for (let k = 0; k < kpiRows.length; k++) {
      metrics[kpiRows[k].id] = randomInt(6000, 10000);
    }
    snapshotValues.push({
      companyId: COMPANY_ID,
      branchId: BRANCHES[s % 3],
      snapshotType: s === 0 ? "DAILY" : "WEEKLY",
      snapshotDate,
      metrics: metrics as unknown as Record<string, unknown>,
      periodStart: new Date(snapshotDate.getTime() - 7 * 86400000),
      periodEnd: snapshotDate,
    });
  }
  await db.insert(kpiSnapshotLogs).values(snapshotValues);

  console.log("Inserting psychosocial surveys (NOM-035)...");
  const surveyUsers = [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_SUPERVISOR];
  const surveyValues: any[] = [];
  for (let u = 0; u < surveyUsers.length; u++) {
    const entorno = randomInt(10, 40);
    const cargas = randomInt(15, 50);
    const liderazgo = randomInt(10, 35);
    const comunicacion = randomInt(10, 30);
    const desarrollo = randomInt(5, 25);
    const clima = randomInt(10, 45);
    const overall = Math.round((entorno + cargas + liderazgo + comunicacion + desarrollo + clima) / 6);
    const riskLevel = overall <= 15 ? "MINIMO" as const : overall <= 30 ? "BAJO" as const : overall <= 50 ? "MEDIO" as const : overall <= 70 ? "ALTO" as const : "MUY_ALTO" as const;

    surveyValues.push({
      userId: surveyUsers[u],
      companyId: COMPANY_ID,
      branchId: BRANCHES[u % 3],
      entornoOrganizacional: entorno,
      cargasTrabajo: cargas,
      liderazgo,
      comunicacion: comunicacion,
      desarrolloProfesional: desarrollo,
      climaLaboral: clima,
      overallScore: overall,
      riskLevel,
      responses: [],
      surveyVersion: "v1",
      completedAt: randomDate(30),
      isComplete: true,
    });
  }
  await db.insert(psychosocialSurveys).values(surveyValues);

  console.log("Phase 7 complete!");
}
