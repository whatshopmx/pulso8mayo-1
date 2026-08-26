/**
 * Predictive Scoring Service (Heuristic MVP)
 *
 * Calculates risk probabilities for compliance, waste, and turnover per branch
 * using weighted rule-based heuristics. Transparent, explainable, and calibratable
 * by consultants without ML infrastructure.
 *
 * AD-2: Heuristic scoring as initial step. Each prediction exposes its factors
 * so the UI can show exactly *why* a risk is high/low.
 */

import { db } from "@/lib/db";
import {
  branches,
  incidents,
  temperatureLogs,
  shiftSessions,
  inventoryWaste,

  inventoryBatches,
  employeeDocuments,
} from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { subDays, startOfDay } from "date-fns";
import { wasteLossEligible } from "@/lib/inventory/waste-kpi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskFactor {
  name: string; // Human-readable name in Spanish
  weight: number; // 0–1 contribution to overall probability
  currentValue: string; // e.g. "3 días sin registro", "2 incidentes activos"
  status: "good" | "warning" | "critical";
}

export interface Prediction {
  branchId: string;
  branchName: string;
  riskType: "compliance" | "merma" | "rotacion";
  probability: number; // 0–100%
  factors: RiskFactor[];
  recommendedActions: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const PredictiveScoringService = {
  // -----------------------------------------------------------------------
  // predictComplianceRisk — NOM-251 compliance risk
  // -----------------------------------------------------------------------

  async predictComplianceRisk(branchId: string): Promise<Prediction | null> {
    const [branch] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, branchId));

    if (!branch) return null;

    const factors: RiskFactor[] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    // --- Factor 1: Days without temperature records (last 7 days) ---
    const sevenDaysAgo = startOfDay(subDays(new Date(), 7));
    const tempRecords = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(temperatureLogs)
      .where(
        and(
          eq(temperatureLogs.branchId, branchId),
          gte(temperatureLogs.timestamp, sevenDaysAgo),
        ),
      );

    const daysWithRecords = Math.min(Number(tempRecords[0]?.count ?? 0), 7);
    const daysWithout = 7 - daysWithRecords;

    const tempWeight = 0.35;
    const tempRisk = daysWithout > 5 ? 1 : daysWithout > 2 ? 0.6 : daysWithout > 0 ? 0.2 : 0;

    factors.push({
      name: "Días sin registro de temperaturas (7d)",
      weight: tempWeight,
      currentValue:
        daysWithout === 0
          ? "Todos los días registrados ✓"
          : `${daysWithout} días sin registro`,
      status: daysWithout > 5 ? "critical" : daysWithout > 2 ? "warning" : "good",
    });
    totalWeight += tempWeight;
    weightedScore += tempRisk * tempWeight;

    // --- Factor 2: Active equipment/food safety incidents ---
    const activeIncidents = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(incidents)
      .where(
        and(
          eq(incidents.branchId, branchId),
          sql`${incidents.status} != 'RESOLVED'`,
          sql`${incidents.severity} != 'WARNING'`,
        ),
      );

    const incidentCount = Number(activeIncidents[0]?.count ?? 0);
    const incidentWeight = 0.30;
    const incidentRisk = incidentCount > 3 ? 1 : incidentCount > 1 ? 0.6 : incidentCount > 0 ? 0.25 : 0;

    factors.push({
      name: "Incidentes activos (equipo/inocuidad)",
      weight: incidentWeight,
      currentValue:
        incidentCount === 0
          ? "Sin incidentes activos ✓"
          : `${incidentCount} incidentes activos`,
      status: incidentCount > 3 ? "critical" : incidentCount > 0 ? "warning" : "good",
    });
    totalWeight += incidentWeight;
    weightedScore += incidentRisk * incidentWeight;

    // --- Factor 3: Key staff turnover (last 30 days) ---
    const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));
    const recentSessions = await db
      .select({
        activeEmployees: sql<number>`cast(count(distinct ${shiftSessions.userId}) as integer)`,
      })
      .from(shiftSessions)
      .where(
        and(
          eq(shiftSessions.branchId, branchId),
          gte(shiftSessions.startedAt, thirtyDaysAgo),
        ),
      );

    // Heuristic: low activity = possible turnover
    const activeStaff = Number(recentSessions[0]?.activeEmployees ?? 0);
    const turnoverWeight = 0.20;
    const turnoverRisk = activeStaff === 0 ? 1 : activeStaff < 3 ? 0.5 : 0;

    factors.push({
      name: "Rotación reciente de personal",
      weight: turnoverWeight,
      currentValue:
        activeStaff > 5
          ? `${activeStaff} empleados activos ✓`
          : activeStaff === 0
            ? "Sin actividad registrada"
            : `Solo ${activeStaff} empleados activos`,
      status: activeStaff < 3 ? "critical" : activeStaff < 5 ? "warning" : "good",
    });
    totalWeight += turnoverWeight;
    weightedScore += turnoverRisk * turnoverWeight;

    // --- Factor 4: Upcoming expirations (documents, fumigation) ---
    const now = new Date();
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 86400000);

    const expiringDocs = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.branchId, branchId),
          eq(employeeDocuments.isValid, true),
          sql`${employeeDocuments.expirationDate} IS NOT NULL`,
          sql`${employeeDocuments.expirationDate} > ${now.toISOString()}`,
          sql`${employeeDocuments.expirationDate} <= ${fourteenDaysFromNow.toISOString()}`,
        ),
      );

    const expiredDocs = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.branchId, branchId),
          eq(employeeDocuments.isValid, true),
          sql`${employeeDocuments.expirationDate} IS NOT NULL`,
          sql`${employeeDocuments.expirationDate} <= ${now.toISOString()}`,
        ),
      );

    const expiringCount = Number(expiringDocs[0]?.count ?? 0);
    const expiredCount = Number(expiredDocs[0]?.count ?? 0);
    const docWeight = 0.15;
    const docRisk =
      expiredCount > 0 ? 1 : expiringCount > 3 ? 0.7 : expiringCount > 0 ? 0.3 : 0;

    factors.push({
      name: "Documentos por vencer/vencidos",
      weight: docWeight,
      currentValue:
        expiredCount > 0
          ? `${expiredCount} vencidos, ${expiringCount} por vencer`
          : expiringCount > 0
            ? `${expiringCount} por vencer`
            : "Sin vencimientos próximos ✓",
      status: expiredCount > 0 ? "critical" : expiringCount > 0 ? "warning" : "good",
    });
    totalWeight += docWeight;
    weightedScore += docRisk * docWeight;

    // Normalize to 0–100%
    const probability = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

    return {
      branchId: branch.id,
      branchName: branch.name,
      riskType: "compliance",
      probability,
      factors,
      recommendedActions: buildComplianceActions(factors, probability),
    };
  },

  // -----------------------------------------------------------------------
  // predictMermaRisk
  // -----------------------------------------------------------------------

  async predictMermaRisk(branchId: string): Promise<Prediction | null> {
    const [branch] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, branchId));

    if (!branch) return null;

    const factors: RiskFactor[] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    // --- Factor 1: Waste deviation last 3 weeks ---
    const twentyOneDaysAgo = startOfDay(subDays(new Date(), 21));
    const sevenDaysAgo = startOfDay(subDays(new Date(), 7));

    // Weeks 1-2 (baseline) vs Week 3 (current)
    const baselineWaste = await db
      .select({
        total: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
      })
      .from(inventoryWaste)
      .where(
        and(
          eq(inventoryWaste.branchId, branchId),
          gte(inventoryWaste.recordedAt, twentyOneDaysAgo),
          sql`${inventoryWaste.recordedAt} < ${sevenDaysAgo.toISOString()}`,
          // STAFF y COURTESY son consumo, no merma (OQ-1); pendientes/rechazadas
          // tampoco suman (Task 3 §8.1).
          sql`${inventoryWaste.reason} NOT IN ('STAFF', 'COURTESY')`,
          wasteLossEligible,
        ),
      );

    const currentWaste = await db
      .select({
        total: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(inventoryWaste)
      .where(
        and(
          eq(inventoryWaste.branchId, branchId),
          gte(inventoryWaste.recordedAt, sevenDaysAgo),
          sql`${inventoryWaste.reason} NOT IN ('STAFF', 'COURTESY')`,
          wasteLossEligible,
        ),
      );

    const baseline = Number(baselineWaste[0]?.total ?? 0);
    const current = Number(currentWaste[0]?.total ?? 0);
    const currentCount = Number(currentWaste[0]?.count ?? 0);

    // If baseline is 0 but current > 0, that's a red flag
    // If both 0, no risk
    // If current > baseline by 50%+, high risk
    const wasteWeight = 0.40;
    let wasteRisk: number;
    let wasteStatus: RiskFactor["status"];
    let wasteValue: string;

    if (baseline === 0 && current === 0) {
      wasteRisk = 0;
      wasteStatus = "good";
      wasteValue = "Sin merma registrada ✓";
    } else if (baseline === 0 && current > 0) {
      wasteRisk = 0.8;
      wasteStatus = "critical";
      wasteValue = `Nueva merma: $${(current / 100).toFixed(0)} (${currentCount} registros)`;
    } else {
      const ratio = current / baseline;
      if (ratio > 2) {
        wasteRisk = 1;
        wasteStatus = "critical";
      } else if (ratio > 1.3) {
        wasteRisk = 0.6;
        wasteStatus = "warning";
      } else if (ratio < 0.5) {
        wasteRisk = 0;
        wasteStatus = "good";
      } else {
        wasteRisk = ratio > 1 ? 0.2 : 0;
        wasteStatus = ratio > 1 ? "warning" : "good";
      }
      wasteValue = `${ratio > 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}% vs período anterior`;
    }

    factors.push({
      name: "Desviación de merma (3 semanas)",
      weight: wasteWeight,
      currentValue: wasteValue,
      status: wasteStatus,
    });
    totalWeight += wasteWeight;
    weightedScore += wasteRisk * wasteWeight;

    // --- Factor 2: Products about to expire ---
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000);

    const expiringBatches = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.branchId, branchId),
          eq(inventoryBatches.status, "AVAILABLE"),
          sql`${inventoryBatches.expirationDate} IS NOT NULL`,
          sql`${inventoryBatches.expirationDate} <= ${sevenDaysFromNow.toISOString()}`,
          sql`${inventoryBatches.currentQuantity} > 0`,
        ),
      );

    const expiringCount = Number(expiringBatches[0]?.count ?? 0);
    const batchWeight = 0.35;
    const batchRisk = expiringCount > 5 ? 0.8 : expiringCount > 2 ? 0.5 : expiringCount > 0 ? 0.2 : 0;

    factors.push({
      name: "Productos por caducar (7 días)",
      weight: batchWeight,
      currentValue:
        expiringCount === 0
          ? "Sin productos por caducar ✓"
          : `${expiringCount} lotes por caducar`,
      status: expiringCount > 5 ? "critical" : expiringCount > 0 ? "warning" : "good",
    });
    totalWeight += batchWeight;
    weightedScore += batchRisk * batchWeight;

    // --- Factor 3: Receiving rejections (inferred from waste reason) ---
    // Heuristic: if there are waste entries with reason 'QUALITY' or 'DAMAGED', that hints at receiving issues
    const rejectedWaste = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(inventoryWaste)
      .where(
        and(
          eq(inventoryWaste.branchId, branchId),
          gte(inventoryWaste.recordedAt, twentyOneDaysAgo),
          sql`${inventoryWaste.reason} IN ('QUALITY', 'DAMAGED')`,
        ),
      );

    const rejectedCount = Number(rejectedWaste[0]?.count ?? 0);
    const rejectWeight = 0.25;
    const rejectRisk = rejectedCount > 3 ? 0.7 : rejectedCount > 1 ? 0.4 : 0;

    factors.push({
      name: "Rechazos por calidad/daño (21d)",
      weight: rejectWeight,
      currentValue:
        rejectedCount === 0
          ? "Sin rechazos ✓"
          : `${rejectedCount} rechazos registrados`,
      status: rejectedCount > 3 ? "critical" : rejectedCount > 0 ? "warning" : "good",
    });
    totalWeight += rejectWeight;
    weightedScore += rejectRisk * rejectWeight;

    const probability = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

    return {
      branchId: branch.id,
      branchName: branch.name,
      riskType: "merma",
      probability,
      factors,
      recommendedActions: buildMermaActions(factors, probability),
    };
  },

  // -----------------------------------------------------------------------
  // predictRotacionRisk
  // -----------------------------------------------------------------------

  async predictRotacionRisk(branchId: string): Promise<Prediction | null> {
    const [branch] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, branchId));

    if (!branch) return null;

    const factors: RiskFactor[] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));

    // --- Factor 1: Accumulated tardiness ---
    const tardinessData = await db
      .select({
        avgLate: sql<number>`coalesce(avg(${shiftSessions.lateMinutes}), 0)`,
        totalLateSessions: sql<number>`cast(count(*) filter (where ${shiftSessions.lateMinutes} > 0) as integer)`,
        totalSessions: sql<number>`cast(count(*) as integer)`,
      })
      .from(shiftSessions)
      .where(
        and(
          eq(shiftSessions.branchId, branchId),
          gte(shiftSessions.startedAt, thirtyDaysAgo),
        ),
      );

    const avgLate = Number(tardinessData[0]?.avgLate ?? 0);
    const lateRatio =
      Number(tardinessData[0]?.totalSessions ?? 0) > 0
        ? Number(tardinessData[0]?.totalLateSessions ?? 0) /
          Number(tardinessData[0]?.totalSessions ?? 1)
        : 0;

    const lateWeight = 0.30;
    const lateRisk = lateRatio > 0.5 ? 0.9 : lateRatio > 0.25 ? 0.5 : lateRatio > 0.1 ? 0.2 : 0;

    factors.push({
      name: "Retardos acumulados (30d)",
      weight: lateWeight,
      currentValue:
        lateRatio === 0
          ? "Sin retardos ✓"
          : `${Math.round(lateRatio * 100)}% sesiones con retraso (${Math.round(avgLate)}min prom.)`,
      status: lateRatio > 0.5 ? "critical" : lateRatio > 0.25 ? "warning" : "good",
    });
    totalWeight += lateWeight;
    weightedScore += lateRisk * lateWeight;

    // --- Factor 2: Overtime near legal limit ---
    const overtimeData = await db
      .select({
        totalOvertime: sql<number>`coalesce(sum(${shiftSessions.overtimeMinutes}), 0)`,
        employeeCount: sql<number>`cast(count(distinct ${shiftSessions.userId}) as integer)`,
      })
      .from(shiftSessions)
      .where(
        and(
          eq(shiftSessions.branchId, branchId),
          gte(shiftSessions.startedAt, thirtyDaysAgo),
        ),
      );

    const totalOvertime = Number(overtimeData[0]?.totalOvertime ?? 0);
    const employeeCount = Number(overtimeData[0]?.employeeCount ?? 0);
    // LFT limit: 9h/week overtime max. Per employee per week: ~540 min
    const avgOvertimePerEmployee = employeeCount > 0 ? totalOvertime / employeeCount : 0;
    // 540 min * 4 weeks = 2160 min legal max per employee in 30 days
    const overtimeRatio = avgOvertimePerEmployee / 2160;

    const overtimeWeight = 0.25;
    const overtimeRisk = overtimeRatio > 0.8 ? 0.9 : overtimeRatio > 0.5 ? 0.5 : overtimeRatio > 0.2 ? 0.15 : 0;

    factors.push({
      name: "Horas extra cerca del límite LFT",
      weight: overtimeWeight,
      currentValue:
        avgOvertimePerEmployee === 0
          ? "Sin horas extra ✓"
          : `${Math.round(avgOvertimePerEmployee / 60)}h extra prom./empleado`,
      status: overtimeRatio > 0.8 ? "critical" : overtimeRatio > 0.5 ? "warning" : "good",
    });
    totalWeight += overtimeWeight;
    weightedScore += overtimeRisk * overtimeWeight;

    // --- Factor 3: Unexcused absences ---
    const absenceData = await db
      .select({
        absenceCount: sql<number>`cast(count(*) filter (where ${shiftSessions.status} IN ('NO_SHOW', 'CANCELLED')) as integer)`,
        totalSessions: sql<number>`cast(count(*) as integer)`,
      })
      .from(shiftSessions)
      .where(
        and(
          eq(shiftSessions.branchId, branchId),
          gte(shiftSessions.startedAt, thirtyDaysAgo),
        ),
      );

    const absenceCount = Number(absenceData[0]?.absenceCount ?? 0);
    const totalSessions = Number(absenceData[0]?.totalSessions ?? 0);
    const absenceRatio = totalSessions > 0 ? absenceCount / totalSessions : 0;

    const absenceWeight = 0.25;
    const absenceRisk = absenceRatio > 0.15 ? 0.9 : absenceRatio > 0.05 ? 0.5 : absenceRatio > 0 ? 0.15 : 0;

    factors.push({
      name: "Ausencias sin aviso (30d)",
      weight: absenceWeight,
      currentValue:
        absenceCount === 0
          ? "Sin ausencias ✓"
          : `${absenceCount} ausencias (${Math.round(absenceRatio * 100)}%)`,
      status: absenceRatio > 0.15 ? "critical" : absenceRatio > 0.05 ? "warning" : "good",
    });
    totalWeight += absenceWeight;
    weightedScore += absenceRisk * absenceWeight;

    // --- Factor 4: Average tenure ---
    // Heuristic: query users with shift sessions to infer if there are many new employees
    // This is a simplification — a real tenure calc would use the hireDate from user profile
    const distinctEmployees = await db
      .select({
        count: sql<number>`cast(count(distinct ${shiftSessions.userId}) as integer)`,
      })
      .from(shiftSessions)
      .where(
        and(
          eq(shiftSessions.branchId, branchId),
          gte(shiftSessions.startedAt, thirtyDaysAgo),
        ),
      );

    const distinctCount = Number(distinctEmployees[0]?.count ?? 0);
    const tenureWeight = 0.20;
    // Heuristic: low distinct count vs expected signals instability
    // This is a weak signal; we use it as a secondary factor
    const tenureRisk = distinctCount < 3 && distinctCount > 0 ? 0.3 : 0;

    factors.push({
      name: "Estabilidad de plantilla",
      weight: tenureWeight,
      currentValue:
        distinctCount >= 5
          ? `${distinctCount} empleados activos ✓`
          : distinctCount > 0
            ? `Solo ${distinctCount} empleados activos`
            : "Sin actividad registrada",
      status: distinctCount < 3 ? "warning" : "good",
    });
    totalWeight += tenureWeight;
    weightedScore += tenureRisk * tenureWeight;

    const probability = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

    return {
      branchId: branch.id,
      branchName: branch.name,
      riskType: "rotacion",
      probability,
      factors,
      recommendedActions: buildRotacionActions(factors, probability),
    };
  },

  // -----------------------------------------------------------------------
  // predictAll — all risks for all branches
  // -----------------------------------------------------------------------

  async predictAll(
    companyId: string,
  ): Promise<Prediction[]> {
    const branchList = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const results: Prediction[] = [];

    for (const b of branchList) {
      const [compliance, merma, rotacion] = await Promise.all([
        this.predictComplianceRisk(b.id),
        this.predictMermaRisk(b.id),
        this.predictRotacionRisk(b.id),
      ]);

      if (compliance) results.push(compliance);
      if (merma) results.push(merma);
      if (rotacion) results.push(rotacion);
    }

    // Sort: highest probability first
    results.sort((a, b) => b.probability - a.probability);

    return results;
  },
};

// ---------------------------------------------------------------------------
// Action builders
// ---------------------------------------------------------------------------

function buildComplianceActions(
  factors: RiskFactor[],
  probability: number,
): string[] {
  const actions: string[] = [];

  if (probability < 20) {
    actions.push("✅ Mantener rutina actual de registros y verificaciones.");
    return actions;
  }

  const hasTempIssue = factors.find(
    (f) => f.name.includes("temperaturas") && f.status !== "good",
  );
  const hasIncidents = factors.find(
    (f) => f.name.includes("Incidentes") && f.status !== "good",
  );
  const hasDocs = factors.find(
    (f) => f.name.includes("Documentos") && f.status !== "good",
  );
  const hasTurnover = factors.find(
    (f) => f.name.includes("Rotación") && f.status !== "good",
  );

  if (hasTempIssue) {
    actions.push(
      "📋 Programar recordatorio diario de registro de temperaturas (8am y 2pm).",
    );
    actions.push(
      "🔔 Activar alerta automática si no hay registros en 24 horas.",
    );
  }

  if (hasIncidents) {
    actions.push(
      "🔧 Revisar y dar mantenimiento a equipos con incidentes activos.",
    );
    actions.push(
      "📝 Documentar plan de remediación para cada incidente abierto.",
    );
  }

  if (hasDocs) {
    actions.push(
      "📄 Renovar documentos vencidos o próximos a vencer (certificados, fumigación).",
    );
    actions.push(
      "📅 Agendar recordatorio 14 días antes de cada vencimiento.",
    );
  }

  if (hasTurnover) {
    actions.push(
      "👥 Programar sesión de onboarding acelerado para nuevo personal.",
    );
    actions.push(
      "📋 Asignar checklist NOM-251 básico a empleados con <30 días.",
    );
  }

  if (actions.length === 0) {
    actions.push("📊 Monitorear indicadores y revisar en 7 días.");
  }

  return actions;
}

function buildMermaActions(
  factors: RiskFactor[],
  probability: number,
): string[] {
  const actions: string[] = [];

  if (probability < 20) {
    actions.push("✅ Merma bajo control. Mantener prácticas actuales.");
    return actions;
  }

  const hasWasteIncrease = factors.find(
    (f) => f.name.includes("Desviación") && f.status !== "good",
  );
  const hasExpiring = factors.find(
    (f) => f.name.includes("caducar") && f.status !== "good",
  );
  const hasRejects = factors.find(
    (f) => f.name.includes("Rechazos") && f.status !== "good",
  );

  if (hasWasteIncrease) {
    actions.push(
      "📊 Auditar proceso de recepción y almacenamiento (FIFO).",
    );
    actions.push(
      "📋 Implementar conteo cíclico semanal en categorías de alta merma.",
    );
  }

  if (hasExpiring) {
    actions.push(
      "⚠️ Priorizar uso de productos próximos a caducar. Ajustar producción.",
    );
    actions.push(
      "🏷️ Etiquetar lotes con fecha visible y sistema PEPS.",
    );
  }

  if (hasRejects) {
    actions.push(
      "📋 Revisar proveedores con rechazos recurrentes y evaluar alternativas.",
    );
    actions.push(
      "✅ Implementar doble verificación en recepción (temperatura + calidad visual).",
    );
  }

  if (actions.length === 0) {
    actions.push("📊 Continuar monitoreo semanal de indicadores de merma.");
  }

  return actions;
}

function buildRotacionActions(
  factors: RiskFactor[],
  probability: number,
): string[] {
  const actions: string[] = [];

  if (probability < 20) {
    actions.push("✅ Clima laboral estable. Mantener políticas actuales.");
    return actions;
  }

  const hasTardiness = factors.find(
    (f) => f.name.includes("Retardos") && f.status !== "good",
  );
  const hasOvertime = factors.find(
    (f) => f.name.includes("Horas extra") && f.status !== "good",
  );
  const hasAbsences = factors.find(
    (f) => f.name.includes("Ausencias") && f.status !== "good",
  );
  const hasInstability = factors.find(
    (f) => f.name.includes("Estabilidad") && f.status !== "good",
  );

  if (hasTardiness) {
    actions.push(
      "⏰ Implementar política de puntualidad con incentivos positivos.",
    );
    actions.push(
      "📱 Activar notificación WhatsApp 30min antes del turno.",
    );
  }

  if (hasOvertime) {
    actions.push(
      "⚠️ Auditar distribución de carga horaria. Redistribuir turnos.",
    );
    actions.push(
      "📋 Verificar cumplimiento LFT: máx 9h extra/semana por empleado.",
    );
  }

  if (hasAbsences) {
    actions.push(
      "📞 Implementar protocolo de contacto post-ausencia (24h).",
    );
    actions.push(
      "📋 Documentar causas de ausencia para identificar patrones.",
    );
  }

  if (hasInstability) {
    actions.push(
      "👥 Programar entrevistas de clima laboral con empleados activos.",
    );
    actions.push(
      "📋 Revisar proceso de onboarding y mentoría para nuevos ingresos.",
    );
  }

  return actions;
}
