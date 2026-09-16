/**
 * Cross-Branch Aggregation Service
 *
 * Queries that aggregate data across all branches of a tenant for the
 * executive dashboard ("single pane of glass").
 *
 * Each public method is wrapped with unstable_cache (5 min TTL) so the
 * executive dashboard doesn't hammer the DB on every refresh.
 */

import { db } from "@/lib/db";
import {
  branches,
  workflowInstances,
  workflowAssignments,
  incidents,
  inventoryWaste,
  shiftSessions,
  employeeDocuments,
  dailySalesCuts,
  costRecords,
  temperatureLogs,
} from "@/lib/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { subDays, startOfDay, endOfDay } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchComplianceSnapshot {
  branchId: string;
  branchName: string;
  avgScore: number;
  totalWorkflows: number;
  completedWorkflows: number;
  overdueWorkflows: number;
  completionRate: number; // 0-100
}

export interface BranchMermaSnapshot {
  branchId: string;
  branchName: string;
  totalLossCents: number;
  wasteCount: number;
  wasteByReason: Record<string, number>; // reason → totalLossCents
}

export interface BranchIncidentesSnapshot {
  branchId: string;
  branchName: string;
  activeIncidents: number;
  criticalCount: number;
  warningCount: number;
  fatalCount: number;
}

export interface BranchLaborSnapshot {
  branchId: string;
  branchName: string;
  totalSessions: number;
  avgLateMinutes: number;
  totalOvertimeMinutes: number;
  absenceCount: number; // NO_SHOW + CANCELLED
  avgWorkMinutes: number;
  activeEmployees: number; // distinct userIds
}

// --- Benchmarking types ---

export interface MetricRankingEntry {
  branchId: string;
  branchName: string;
  value: number;
}

export interface MetricRanking {
  label: string;
  unit: string;
  higherIsBetter: boolean;
  rankings: MetricRankingEntry[];
}

export interface PracticeInsight {
  branchId: string;
  branchName: string;
  type: "best" | "worst";
  summary: string;
  factors: string[];
}

export interface BenchmarkingData {
  metrics: MetricRanking[];
  bestPractices: PracticeInsight | null;
  worstPractices: PracticeInsight | null;
  qsrSummary?: {
    networkAveragePrimeCost: number;
    networkAverageFoodCost: number;
    networkAverageLaborCost: number;
    branches: {
      branchId: string;
      branchName: string;
      primeCostPercent: number;
      foodCostPercent: number;
      laborCostPercent: number;
    }[];
  };
}

// --- Tipos QSR: Prime Cost, Scorecards y Detección de Inconsistencias ---

export interface BranchQSRScore {
  branchId: string;
  branchName: string;
  salesTotalCents: number;
  foodCostCents: number;
  laborCostCents: number;
  foodCostPercent: number; // ej. 31.5%
  laborCostPercent: number; // ej. 24.2%
  primeCostPercent: number; // ej. 55.7% (Food + Labor)
  primeCostStatus: "HEALTHY" | "WATCH" | "CRITICAL"; // <60% HEALTHY, 60-65% WATCH, >65% CRITICAL
  nom251ComplianceRate: number; // 0-100%
  cashReconciliationRate: number; // 0-100%
  compositeScore: number; // 0-100 ponderado
  rank: number;
  dataQuality: "VERIFIED" | "ESTIMATED";
}

export interface NetworkAnomalyFinding {
  id: string;
  type: "FOOD_COST_DISCREPANCY" | "LABOR_OVERRUN" | "PRIME_COST_LEAK" | "CASH_VARIANCE_OUTLIER";
  severity: "critical" | "warning" | "info";
  title: string;
  narrative: string;
  affectedBranchId: string;
  affectedBranchName: string;
  benchmarkBranchName?: string;
  variancePoints: number; // puntos porcentuales de desvío
  estimatedImpactMxn: number;
  suggestedAction: string;
}

export interface BranchQSRRankingResult {
  periodDays: number;
  branches: BranchQSRScore[];
  podiumTop3: BranchQSRScore[];
  networkAveragePrimeCost: number;
  networkAverageFoodCost: number;
  networkAverageLaborCost: number;
  anomalies: NetworkAnomalyFinding[];
}

// ---------------------------------------------------------------------------
// Practice inference helper (heuristic)
// ---------------------------------------------------------------------------

async function inferPractices(
  branchId: string,
  branchName: string,
  type: "best" | "worst",
  completionMap: Map<string, number>,
  rejectMap: Map<string, number>,
  lateMap: Map<string, number>,
  absenceMap: Map<string, number>,
): Promise<PracticeInsight> {
  const factors: string[] = [];
  const completion = completionMap.get(branchId) ?? 0;
  const rejects = rejectMap.get(branchId) ?? 0;
  const late = lateMap.get(branchId) ?? 0;
  const absences = absenceMap.get(branchId) ?? 0;

  if (type === "best") {
    if (completion >= 90) {
      factors.push(`${Math.round(completion)}% de workflows completados a tiempo`);
    }
    if (rejects === 0) {
      factors.push("Cero rechazos de recepción por calidad/daño");
    }
    if (late < 5) {
      factors.push(`Solo ${Math.round(late)} min de retraso promedio`);
    }
    if (absences === 0) {
      factors.push("Cero ausencias sin aviso en 30 días");
    }

    return {
      branchId,
      branchName,
      type: "best",
      summary: `🏆 ${branchName} tiene el mejor desempeño del grupo.`,
      factors:
        factors.length > 0
          ? factors
          : ["Consistencia operativa superior al promedio del grupo."],
    };
  }

  // Worst practices
  if (completion < 60) {
    factors.push(`Solo ${Math.round(completion)}% de workflows completados a tiempo`);
  }
  if (rejects > 2) {
    factors.push(`${rejects} rechazos de recepción por calidad/daño`);
  }
  if (late > 15) {
    factors.push(`${Math.round(late)} min de retraso promedio`);
  }
  if (absences > 2) {
    factors.push(`${absences} ausencias sin aviso en 30 días`);
  }

  return {
    branchId,
    branchName,
    type: "worst",
    summary:
      factors.length >= 2
        ? `⚠️ ${branchName} tiene ${factors.length} factores de riesgo que requieren atención inmediata.`
        : `⚠️ ${branchName} está por debajo del promedio del grupo.`,
    factors:
      factors.length > 0
        ? factors
        : ["Múltiples indicadores por debajo del promedio del grupo."],
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

const CACHE_TTL = 300; // 5 minutes
const CACHE_TAGS = ["cross-branch"];

function cacheKey(companyId: string, method: string): string {
  return `cross-branch:${companyId}:${method}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const CrossBranchService = {
  // -----------------------------------------------------------------------
  // getAllBranchesCompliance
  // -----------------------------------------------------------------------

  async getAllBranchesCompliance(
    companyId: string,
  ): Promise<BranchComplianceSnapshot[]> {
    return unstable_cache(
      async (cid: string) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length === 0) return [];

        const branchIds = branchList.map((b) => b.id);

        // Workflow stats per branch (last 30 days)
        const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));

        const stats = await db
          .select({
            branchId: workflowInstances.branchId,
            total: sql<number>`cast(count(*) as integer)`,
            completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
            avgScore: sql<number>`coalesce(avg(${workflowInstances.score}) filter (where ${workflowInstances.status} = 'COMPLETED'), 0)`,
          })
          .from(workflowInstances)
          .where(
            and(
              inArray(workflowInstances.branchId, branchIds),
              gte(workflowInstances.createdAt, thirtyDaysAgo),
            ),
          )
          .groupBy(workflowInstances.branchId);

        // Overdue workflow counts per branch
        const overdueRows = await db
          .select({
            branchId: workflowInstances.branchId,
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(workflowAssignments)
          .innerJoin(
            workflowInstances,
            eq(workflowAssignments.instanceId, workflowInstances.id),
          )
          .where(
            and(
              eq(workflowAssignments.isOverdue, true),
              inArray(workflowInstances.branchId, branchIds),
            ),
          )
          .groupBy(workflowInstances.branchId);

        const overdueMap = new Map<string, number>();
        for (const r of overdueRows) {
          overdueMap.set(r.branchId, Number(r.count));
        }

        return branchList.map((b) => {
          const s = stats.find((x) => x.branchId === b.id);
          const total = Number(s?.total ?? 0);
          const completed = Number(s?.completed ?? 0);
          const avgScore = Math.round(Number(s?.avgScore ?? 0) * 10) / 10;
          const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

          return {
            branchId: b.id,
            branchName: b.name,
            avgScore,
            totalWorkflows: total,
            completedWorkflows: completed,
            overdueWorkflows: overdueMap.get(b.id) ?? 0,
            completionRate,
          };
        });
      },
      [cacheKey(companyId, "compliance")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "compliance"] },
    )(companyId);
  },

  // -----------------------------------------------------------------------
  // getAllBranchesMerma
  // -----------------------------------------------------------------------

  async getAllBranchesMerma(companyId: string): Promise<BranchMermaSnapshot[]> {
    return unstable_cache(
      async (cid: string) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length === 0) return [];

        const branchIds = branchList.map((b) => b.id);

        // Waste in last 30 days
        const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));

        const wasteRows = await db
          .select({
            branchId: inventoryWaste.branchId,
            reason: inventoryWaste.reason,
            totalLoss: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(inventoryWaste)
          .where(
            and(
              eq(inventoryWaste.companyId, cid),
              inArray(inventoryWaste.branchId, branchIds),
              gte(inventoryWaste.recordedAt, thirtyDaysAgo),
            ),
          )
          .groupBy(inventoryWaste.branchId, inventoryWaste.reason);

        // Group by branch
        const branchMap = new Map<
          string,
          { total: number; count: number; byReason: Record<string, number> }
        >();

        for (const b of branchList) {
          branchMap.set(b.id, { total: 0, count: 0, byReason: {} });
        }

        for (const r of wasteRows) {
          const entry = branchMap.get(r.branchId);
          if (!entry) continue;
          const loss = Number(r.totalLoss);
          entry.total += loss;
          entry.count += Number(r.count);
          entry.byReason[r.reason] = (entry.byReason[r.reason] ?? 0) + loss;
        }

        return branchList.map((b) => {
          const e = branchMap.get(b.id)!;
          return {
            branchId: b.id,
            branchName: b.name,
            totalLossCents: e.total,
            wasteCount: e.count,
            wasteByReason: e.byReason,
          };
        });
      },
      [cacheKey(companyId, "merma")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "inventory"] },
    )(companyId);
  },

  // -----------------------------------------------------------------------
  // getAllBranchesIncidentesActivos
  // -----------------------------------------------------------------------

  async getAllBranchesIncidentesActivos(
    companyId: string,
  ): Promise<BranchIncidentesSnapshot[]> {
    return unstable_cache(
      async (cid: string) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length === 0) return [];

        const branchIds = branchList.map((b) => b.id);

        const incidentRows = await db
          .select({
            branchId: incidents.branchId,
            severity: incidents.severity,
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(incidents)
          .where(
            and(
              inArray(incidents.branchId, branchIds),
              sql`${incidents.status} != 'RESOLVED'`,
            ),
          )
          .groupBy(incidents.branchId, incidents.severity);

        // Group by branch
        const branchMap = new Map<
          string,
          { total: number; critical: number; warning: number; fatal: number }
        >();

        for (const b of branchList) {
          branchMap.set(b.id, { total: 0, critical: 0, warning: 0, fatal: 0 });
        }

        for (const r of incidentRows) {
          const entry = branchMap.get(r.branchId);
          if (!entry) continue;
          const c = Number(r.count);
          entry.total += c;
          if (r.severity === "CRITICAL") entry.critical += c;
          else if (r.severity === "WARNING") entry.warning += c;
          else if (r.severity === "FATAL") entry.fatal += c;
        }

        return branchList.map((b) => {
          const e = branchMap.get(b.id)!;
          return {
            branchId: b.id,
            branchName: b.name,
            activeIncidents: e.total,
            criticalCount: e.critical,
            warningCount: e.warning,
            fatalCount: e.fatal,
          };
        });
      },
      [cacheKey(companyId, "incidentes")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "incidents"] },
    )(companyId);
  },

  // -----------------------------------------------------------------------
  // getAllBranchesLaborMetrics
  // -----------------------------------------------------------------------

  async getAllBranchesLaborMetrics(
    companyId: string,
  ): Promise<BranchLaborSnapshot[]> {
    return unstable_cache(
      async (cid: string) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length === 0) return [];

        const branchIds = branchList.map((b) => b.id);

        // Last 30 days for sessions
        const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));

        // Session stats per branch
        const sessionStats = await db
          .select({
            branchId: shiftSessions.branchId,
            totalSessions: sql<number>`cast(count(*) as integer)`,
            avgLateMinutes: sql<number>`coalesce(avg(${shiftSessions.lateMinutes}), 0)`,
            totalOvertimeMinutes: sql<number>`coalesce(sum(${shiftSessions.overtimeMinutes}), 0)`,
            absenceCount: sql<number>`cast(count(*) filter (where ${shiftSessions.status} IN ('NO_SHOW', 'CANCELLED')) as integer)`,
            avgWorkMinutes: sql<number>`coalesce(avg(${shiftSessions.totalWorkMinutes}) filter (where ${shiftSessions.totalWorkMinutes} > 0), 0)`,
            activeEmployees: sql<number>`cast(count(distinct ${shiftSessions.userId}) as integer)`,
          })
          .from(shiftSessions)
          .where(
            and(
              inArray(shiftSessions.branchId, branchIds),
              gte(shiftSessions.startedAt, thirtyDaysAgo),
            ),
          )
          .groupBy(shiftSessions.branchId);

        const statsMap = new Map(
          sessionStats.map((s) => [s.branchId, s]),
        );

        return branchList.map((b) => {
          const s = statsMap.get(b.id);
          return {
            branchId: b.id,
            branchName: b.name,
            totalSessions: Number(s?.totalSessions ?? 0),
            avgLateMinutes: Math.round(Number(s?.avgLateMinutes ?? 0) * 10) / 10,
            totalOvertimeMinutes: Number(s?.totalOvertimeMinutes ?? 0),
            absenceCount: Number(s?.absenceCount ?? 0),
            avgWorkMinutes: Math.round(Number(s?.avgWorkMinutes ?? 0)),
            activeEmployees: Number(s?.activeEmployees ?? 0),
          };
        });
      },
      [cacheKey(companyId, "labor")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "labor"] },
    )(companyId);
  },

  // -----------------------------------------------------------------------
  // getDocumentExpirations — for alerts panel
  // -----------------------------------------------------------------------

  async getDocumentExpirations(companyId: string): Promise<
    {
      branchId: string;
      branchName: string;
      expiringCount: number;
      expiredCount: number;
    }[]
  > {
    return unstable_cache(
      async (cid: string) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length === 0) return [];

        const branchIds = branchList.map((b) => b.id);
        const now = new Date();
        const sevenDaysFromNow = new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000,
        );

        const docRows = await db
          .select({
            branchId: employeeDocuments.branchId,
            expired: sql<number>`cast(count(*) filter (where ${employeeDocuments.expirationDate} <= ${now.toISOString()} AND ${employeeDocuments.isValid} = true) as integer)`,
            expiring: sql<number>`cast(count(*) filter (where ${employeeDocuments.expirationDate} > ${now.toISOString()} AND ${employeeDocuments.expirationDate} <= ${sevenDaysFromNow.toISOString()} AND ${employeeDocuments.isValid} = true) as integer)`,
          })
          .from(employeeDocuments)
          .where(
            and(
              eq(employeeDocuments.companyId, cid),
              inArray(employeeDocuments.branchId, branchIds),
              sql`${employeeDocuments.expirationDate} IS NOT NULL`,
            ),
          )
          .groupBy(employeeDocuments.branchId);

        const docMap = new Map<string, { expired: number; expiring: number }>();
        for (const r of docRows) {
          docMap.set(r.branchId ?? "", {
            expired: Number(r.expired),
            expiring: Number(r.expiring),
          });
        }

        return branchList.map((b) => {
          const d = docMap.get(b.id) ?? { expired: 0, expiring: 0 };
          return {
            branchId: b.id,
            branchName: b.name,
            expiredCount: d.expired,
            expiringCount: d.expiring,
          };
        });
      },
      [cacheKey(companyId, "doc-expirations")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "documents"] },
    )(companyId);
  },

  // -----------------------------------------------------------------------
  // getComplianceTrend — weekly scores per branch (last 4 weeks)
  // -----------------------------------------------------------------------

  async getComplianceTrend(companyId: string): Promise<{
    weeks: string[];
    byBranch: Record<string, (number | null)[]>;
  }> {
    return unstable_cache(
      async (cid: string) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length === 0) return { weeks: [], byBranch: {} };

        // Build 4 weekly buckets
        const now = new Date();
        const weeks: { label: string; start: Date; end: Date }[] = [];
        for (let i = 3; i >= 0; i--) {
          const end = new Date(now);
          end.setDate(end.getDate() - i * 7);
          const start = new Date(end);
          start.setDate(start.getDate() - 6);
          weeks.push({
            label: `Sem ${4 - i}`,
            start,
            end,
          });
        }

        const byBranch: Record<string, (number | null)[]> = {};

        for (const b of branchList) {
          const scores: (number | null)[] = [];

          for (const w of weeks) {
            const rows = await db
              .select({
                avgScore: sql<number>`coalesce(avg(${workflowInstances.score}) filter (where ${workflowInstances.status} = 'COMPLETED'), 0)`,
                count: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
              })
              .from(workflowInstances)
              .where(
                and(
                  eq(workflowInstances.branchId, b.id),
                  gte(workflowInstances.createdAt, w.start),
                  lte(workflowInstances.createdAt, w.end),
                ),
              );

            const r = rows[0];
            scores.push(
              r && Number(r.count) > 0
                ? Math.round(Number(r.avgScore) * 10) / 10
                : null,
            );
          }

          byBranch[b.name] = scores;
        }

        return {
          weeks: weeks.map((w) => w.label),
          byBranch,
        };
      },
      [cacheKey(companyId, "compliance-trend")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "compliance", "trend"] },
    )(companyId);
  },

  // -----------------------------------------------------------------------
  // getBenchmarking — cross-branch rankings + best/worst practices
  // -----------------------------------------------------------------------

  async getBenchmarking(companyId: string): Promise<BenchmarkingData | null> {
    return unstable_cache(
      async (cid: string) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length < 2) return null;

        const branchIds = branchList.map((b) => b.id);
        const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));

        // --- Compliance ---
        const compliance = await this.getAllBranchesCompliance(cid);

        // --- Merma ---
        const mermaData = await db
          .select({
            branchId: inventoryWaste.branchId,
            totalLoss: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
          })
          .from(inventoryWaste)
          .where(
            and(
              eq(inventoryWaste.companyId, cid),
              inArray(inventoryWaste.branchId, branchIds),
              gte(inventoryWaste.recordedAt, thirtyDaysAgo),
            ),
          )
          .groupBy(inventoryWaste.branchId);

        // --- Labor ---
        const labor = await this.getAllBranchesLaborMetrics(cid);

        // --- Workflow completion rate ---
        const workflowCompletion = await db
          .select({
            branchId: workflowInstances.branchId,
            total: sql<number>`cast(count(*) as integer)`,
            completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
          })
          .from(workflowInstances)
          .where(
            and(
              inArray(workflowInstances.branchId, branchIds),
              gte(workflowInstances.createdAt, thirtyDaysAgo),
            ),
          )
          .groupBy(workflowInstances.branchId);

        // --- Rejection rate ---
        const rejectionData = await db
          .select({
            branchId: inventoryWaste.branchId,
            rejectCount: sql<number>`cast(count(*) as integer)`,
          })
          .from(inventoryWaste)
          .where(
            and(
              eq(inventoryWaste.companyId, cid),
              inArray(inventoryWaste.branchId, branchIds),
              gte(inventoryWaste.recordedAt, thirtyDaysAgo),
              sql`${inventoryWaste.reason} IN ('QUALITY', 'DAMAGED')`,
            ),
          )
          .groupBy(inventoryWaste.branchId);

        // Build rankings
        const mermaMap = new Map<string, number>(mermaData.map((m) => [m.branchId, Number(m.totalLoss)]));
        const completionMap = new Map<string, number>(
          workflowCompletion.map((w) => [
            w.branchId,
            Number(w.total) > 0
              ? Math.round((Number(w.completed) / Number(w.total)) * 1000) / 10
              : 0,
          ]),
        );
        const rejectMap = new Map<string, number>(rejectionData.map((r) => [r.branchId, Number(r.rejectCount)]));
        const lateMap = new Map<string, number>(labor.map((l) => [l.branchId, l.avgLateMinutes]));
        const absenceMap = new Map<string, number>(labor.map((l) => [l.branchId, l.absenceCount]));

        const rank =
          (accessor: (b: (typeof branchList)[number]) => number, higherIsBetter: boolean) =>
            [...branchList]
              .map((b) => ({
                branchId: b.id,
                branchName: b.name,
                value: accessor(b),
              }))
              .sort((a, b) =>
                higherIsBetter ? b.value - a.value : a.value - b.value,
              );

        const metrics: MetricRanking[] = [
          {
            label: "Compliance Score",
            unit: "%",
            higherIsBetter: true,
            rankings: rank(
              (b) => compliance.find((c) => c.branchId === b.id)?.avgScore ?? 0,
              true,
            ),
          },
          {
            label: "Tasa de Cumplimiento de Workflows",
            unit: "%",
            higherIsBetter: true,
            rankings: rank((b) => completionMap.get(b.id) ?? 0, true),
          },
          {
            label: "Merma Total (30d)",
            unit: "MXN",
            higherIsBetter: false,
            rankings: rank((b) => mermaMap.get(b.id) ?? 0, false),
          },
          {
            label: "Rechazos de Recepción (30d)",
            unit: "rechazos",
            higherIsBetter: false,
            rankings: rank((b) => rejectMap.get(b.id) ?? 0, false),
          },
          {
            label: "Retraso Promedio",
            unit: "min",
            higherIsBetter: false,
            rankings: rank((b) => lateMap.get(b.id) ?? 0, false),
          },
          {
            label: "Ausencias (30d)",
            unit: "ausencias",
            higherIsBetter: false,
            rankings: rank((b) => absenceMap.get(b.id) ?? 0, false),
          },
        ];

        // --- Best & worst practices ---
        const bestCompliance = [...compliance].sort((a, b) => b.avgScore - a.avgScore);
        const bestBranch = bestCompliance[0];
        const worstBranch = bestCompliance[bestCompliance.length - 1];

        const bestPractices = bestBranch
          ? await inferPractices(
              bestBranch.branchId,
              bestBranch.branchName,
              "best",
              completionMap,
              rejectMap,
              lateMap,
              absenceMap,
            )
          : null;

        const worstPractices = worstBranch
          ? await inferPractices(
              worstBranch.branchId,
              worstBranch.branchName,
              "worst",
              completionMap,
              rejectMap,
              lateMap,
              absenceMap,
            )
          : null;

        // --- QSR Prime Cost & Benchmarks ---
        const qsrData = await CrossBranchService.getBranchQSRRanking(cid, 30);
        const qsrMap = new Map(qsrData.branches.map((b) => [b.branchId, b]));

        metrics.push(
          {
            label: "Prime Cost",
            unit: "%",
            higherIsBetter: false,
            rankings: rank((b) => qsrMap.get(b.id)?.primeCostPercent ?? 0, false),
          },
          {
            label: "Food Cost",
            unit: "%",
            higherIsBetter: false,
            rankings: rank((b) => qsrMap.get(b.id)?.foodCostPercent ?? 0, false),
          },
          {
            label: "Labor Cost",
            unit: "%",
            higherIsBetter: false,
            rankings: rank((b) => qsrMap.get(b.id)?.laborCostPercent ?? 0, false),
          }
        );

        return {
          metrics,
          bestPractices,
          worstPractices,
          qsrSummary: {
            networkAveragePrimeCost: qsrData.networkAveragePrimeCost,
            networkAverageFoodCost: qsrData.networkAverageFoodCost,
            networkAverageLaborCost: qsrData.networkAverageLaborCost,
            branches: qsrData.branches.map((b) => ({
              branchId: b.branchId,
              branchName: b.branchName,
              primeCostPercent: b.primeCostPercent,
              foodCostPercent: b.foodCostPercent,
              laborCostPercent: b.laborCostPercent,
            })),
          },
        };
      },
      [cacheKey(companyId, "benchmarking")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "benchmarking"] },
    )(companyId);
  },

  // -----------------------------------------------------------------------
  // getBranchRanking — Alias canónico para getBranchQSRRanking
  // -----------------------------------------------------------------------

  async getBranchRanking(
    companyId: string,
    periodDays = 30
  ): Promise<BranchQSRRankingResult> {
    return this.getBranchQSRRanking(companyId, periodDays);
  },

  // -----------------------------------------------------------------------
  // getBranchQSRRanking — Prime Cost, Scorecard QSR y Detección de Anomalías
  // -----------------------------------------------------------------------

  async getBranchQSRRanking(
    companyId: string,
    periodDays = 30
  ): Promise<BranchQSRRankingResult> {
    return unstable_cache(
      async (cid: string, pDays: number) => {
        const branchList = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.companyId, cid));

        if (branchList.length === 0) {
          return {
            periodDays: pDays,
            branches: [],
            podiumTop3: [],
            networkAveragePrimeCost: 0,
            networkAverageFoodCost: 0,
            networkAverageLaborCost: 0,
            anomalies: [],
          };
        }

        const branchIds = branchList.map((b) => b.id);
        const startDate = startOfDay(subDays(new Date(), pDays));
        const endDate = endOfDay(new Date());

        // 1. Ventas por sucursal desde dailySalesCuts
        const salesRows = await db
          .select({
            branchId: dailySalesCuts.branchId,
            totalSales: sql<number>`coalesce(sum(${dailySalesCuts.totalSales}), 0)`,
            totalCuts: sql<number>`cast(count(*) as integer)`,
            balancedCuts: sql<number>`cast(count(*) filter (where abs(coalesce(${dailySalesCuts.cashSales}, 0) - coalesce(${dailySalesCuts.cashCountedCents}, ${dailySalesCuts.cashSales}, 0)) <= 5000) as integer)`,
          })
          .from(dailySalesCuts)
          .where(
            and(
              eq(dailySalesCuts.companyId, cid),
              inArray(dailySalesCuts.branchId, branchIds),
              gte(dailySalesCuts.businessDate, startDate.toISOString().slice(0, 10)),
              lte(dailySalesCuts.businessDate, endDate.toISOString().slice(0, 10))
            )
          )
          .groupBy(dailySalesCuts.branchId);

        const salesMap = new Map<string, { totalSales: number; totalCuts: number; balancedCuts: number }>();
        for (const row of salesRows) {
          salesMap.set(row.branchId, {
            totalSales: Number(row.totalSales),
            totalCuts: Number(row.totalCuts),
            balancedCuts: Number(row.balancedCuts),
          });
        }

        // 2. Costos de comida desde costRecords e inventoryWaste
        const foodCostRows = await db
          .select({
            branchId: costRecords.branchId,
            total: sql<number>`coalesce(sum(${costRecords.amount}), 0)`,
          })
          .from(costRecords)
          .where(
            and(
              eq(costRecords.companyId, cid),
              inArray(costRecords.branchId, branchIds),
              gte(costRecords.recordedAt, startDate),
              lte(costRecords.recordedAt, endDate),
              sql`upper(${costRecords.category}) in ('FOOD', 'ALIMENTOS', 'INGREDIENTS', 'INSUMOS', 'BEBIDAS', 'MATERIA_PRIMA')`
            )
          )
          .groupBy(costRecords.branchId);

        const wasteRows = await db
          .select({
            branchId: inventoryWaste.branchId,
            totalLoss: sql<number>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
          })
          .from(inventoryWaste)
          .where(
            and(
              eq(inventoryWaste.companyId, cid),
              inArray(inventoryWaste.branchId, branchIds),
              gte(inventoryWaste.recordedAt, startDate),
              lte(inventoryWaste.recordedAt, endDate)
            )
          )
          .groupBy(inventoryWaste.branchId);

        const foodCostMap = new Map<string, { amount: number; hasRecordedData: boolean }>();
        for (const r of foodCostRows) {
          if (r.branchId) {
            foodCostMap.set(r.branchId, { amount: Number(r.total), hasRecordedData: true });
          }
        }
        for (const w of wasteRows) {
          if (w.branchId) {
            const current = foodCostMap.get(w.branchId) ?? { amount: 0, hasRecordedData: false };
            foodCostMap.set(w.branchId, {
              amount: current.amount + Number(w.totalLoss),
              hasRecordedData: current.hasRecordedData || Number(w.totalLoss) > 0,
            });
          }
        }

        // 3. Costos de mano de obra desde costRecords
        const laborCostRows = await db
          .select({
            branchId: costRecords.branchId,
            total: sql<number>`coalesce(sum(${costRecords.amount}), 0)`,
          })
          .from(costRecords)
          .where(
            and(
              eq(costRecords.companyId, cid),
              inArray(costRecords.branchId, branchIds),
              gte(costRecords.recordedAt, startDate),
              lte(costRecords.recordedAt, endDate),
              sql`upper(${costRecords.category}) in ('LABOR', 'NOMINA', 'MANO_DE_OBRA', 'SUELDOS')`
            )
          )
          .groupBy(costRecords.branchId);

        const laborCostMap = new Map<string, { amount: number; hasRecordedData: boolean }>();
        for (const r of laborCostRows) {
          if (r.branchId) {
            laborCostMap.set(r.branchId, { amount: Number(r.total), hasRecordedData: true });
          }
        }

        // 4. Cumplimiento NOM-251 de temperaturas
        const tempRows = await db
          .select({
            branchId: temperatureLogs.branchId,
            total: sql<number>`cast(count(*) as integer)`,
            compliant: sql<number>`cast(count(*) filter (where ${temperatureLogs.isCompliant} = true) as integer)`,
          })
          .from(temperatureLogs)
          .where(
            and(
              inArray(temperatureLogs.branchId, branchIds),
              gte(temperatureLogs.timestamp, startDate),
              lte(temperatureLogs.timestamp, endDate)
            )
          )
          .groupBy(temperatureLogs.branchId);

        const tempMap = new Map<string, number>();
        for (const r of tempRows) {
          const tot = Number(r.total);
          const comp = Number(r.compliant);
          tempMap.set(r.branchId, tot > 0 ? (comp / tot) * 100 : 100);
        }

        // 5. Consolidación de cada sucursal
        const rawBranches: Omit<BranchQSRScore, "rank">[] = branchList.map((b) => {
          const salesData = salesMap.get(b.id) ?? { totalSales: 0, totalCuts: 0, balancedCuts: 0 };
          const salesTotal = salesData.totalSales;

          let foodCostCents = foodCostMap.get(b.id)?.amount ?? 0;
          let laborCostCents = laborCostMap.get(b.id)?.amount ?? 0;
          let isEstimated = false;

          // Si no hay datos contables registrados pero hay ventas, usamos estimaciones estándar QSR
          if (salesTotal > 0 && foodCostCents === 0) {
            foodCostCents = Math.round(salesTotal * 0.315); // 31.5%
            isEstimated = true;
          }
          if (salesTotal > 0 && laborCostCents === 0) {
            laborCostCents = Math.round(salesTotal * 0.245); // 24.5%
            isEstimated = true;
          }

          const foodCostPercent =
            salesTotal > 0 ? Math.round((foodCostCents / salesTotal) * 1000) / 10 : 31.5;
          const laborCostPercent =
            salesTotal > 0 ? Math.round((laborCostCents / salesTotal) * 1000) / 10 : 24.5;
          const primeCostPercent = Math.round((foodCostPercent + laborCostPercent) * 10) / 10;

          const primeCostStatus: BranchQSRScore["primeCostStatus"] =
            primeCostPercent < 60 ? "HEALTHY" : primeCostPercent <= 65 ? "WATCH" : "CRITICAL";

          const nom251Rate = Math.round((tempMap.get(b.id) ?? 100) * 10) / 10;

          const cashReconciliationRate =
            salesData.totalCuts > 0
              ? Math.round((salesData.balancedCuts / salesData.totalCuts) * 1000) / 10
              : 100;

          // Composite Score (0-100)
          const primeEfficiencyScore = Math.max(0, Math.min(100, 100 - (primeCostPercent - 50) * 3));
          const salesScore = salesTotal > 0 ? 90 : 50;
          const composite = Math.round(
            (salesScore * 0.3 +
              primeEfficiencyScore * 0.3 +
              nom251Rate * 0.2 +
              cashReconciliationRate * 0.2) *
              10
          ) / 10;

          return {
            branchId: b.id,
            branchName: b.name,
            salesTotalCents: salesTotal,
            foodCostCents,
            laborCostCents,
            foodCostPercent,
            laborCostPercent,
            primeCostPercent,
            primeCostStatus,
            nom251ComplianceRate: nom251Rate,
            cashReconciliationRate,
            compositeScore: composite,
            dataQuality: isEstimated ? "ESTIMATED" : "VERIFIED",
          };
        });

        // 6. Ordenar por compositeScore desc y asignar rank
        const sortedBranches = [...rawBranches]
          .sort((a, b) => b.compositeScore - a.compositeScore)
          .map((b, idx) => ({ ...b, rank: idx + 1 }));

        // 7. Podio Top 3
        const podiumTop3 = sortedBranches.slice(0, 3);

        // 8. Promedios de la red
        const activeUnits = sortedBranches.filter((b) => b.salesTotalCents > 0);
        const count = activeUnits.length || sortedBranches.length || 1;
        const avgPrime =
          Math.round(
            (sortedBranches.reduce((acc, b) => acc + b.primeCostPercent, 0) / count) * 10
          ) / 10;
        const avgFood =
          Math.round(
            (sortedBranches.reduce((acc, b) => acc + b.foodCostPercent, 0) / count) * 10
          ) / 10;
        const avgLabor =
          Math.round(
            (sortedBranches.reduce((acc, b) => acc + b.laborCostPercent, 0) / count) * 10
          ) / 10;

        // 9. Detección de inconsistencias de red
        const anomalies = detectNetworkAnomalies(sortedBranches);

        return {
          periodDays: pDays,
          branches: sortedBranches,
          podiumTop3,
          networkAveragePrimeCost: avgPrime,
          networkAverageFoodCost: avgFood,
          networkAverageLaborCost: avgLabor,
          anomalies,
        };
      },
      [cacheKey(companyId, `qsr-ranking-${periodDays}`)],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "qsr-ranking"] }
    )(companyId, periodDays);
  },
};

/**
 * Algoritmo de detección de inconsistencias de red entre sucursales hermanas QSR.
 * Identifica varianzas de Food Cost > 3 puntos porcentuales, fugas de Prime Cost (>65%)
 * y sobrecostos laborales desproporcionados.
 */
export function detectNetworkAnomalies(branchScores: BranchQSRScore[]): NetworkAnomalyFinding[] {
  if (branchScores.length < 2) return [];

  const findings: NetworkAnomalyFinding[] = [];

  const activeBranches = branchScores.filter((b) => b.salesTotalCents > 0);
  if (activeBranches.length < 2) return [];

  const avgLaborCost =
    activeBranches.reduce((acc, b) => acc + b.laborCostPercent, 0) / activeBranches.length;

  // Encontrar la sucursal más eficiente en Food Cost
  const sortedByFood = [...activeBranches].sort((a, b) => a.foodCostPercent - b.foodCostPercent);
  const bestFoodBranch = sortedByFood[0];

  for (const branch of activeBranches) {
    // 1. Desviación en Food Cost > 3 puntos porcentuales contra la más eficiente
    const diffAgainstBest = branch.foodCostPercent - bestFoodBranch.foodCostPercent;
    if (diffAgainstBest > 3.0 && branch.branchId !== bestFoodBranch.branchId) {
      const impactMxn = Math.round((diffAgainstBest / 100) * (branch.salesTotalCents / 100));
      findings.push({
        id: `food-cost-variance-${branch.branchId}`,
        type: "FOOD_COST_DISCREPANCY",
        severity: diffAgainstBest > 5.0 ? "critical" : "warning",
        title: `Desviación de Food Cost en ${branch.branchName}`,
        narrative: `${branch.branchName} reporta un costo de alimentos de ${branch.foodCostPercent.toFixed(1)}%, que supera por ${diffAgainstBest.toFixed(1)} puntos a ${bestFoodBranch.branchName} (${bestFoodBranch.foodCostPercent.toFixed(1)}%) operando el mismo menú.`,
        affectedBranchId: branch.branchId,
        affectedBranchName: branch.branchName,
        benchmarkBranchName: bestFoodBranch.branchName,
        variancePoints: Math.round(diffAgainstBest * 10) / 10,
        estimatedImpactMxn: impactMxn,
        suggestedAction: "Auditar rendimiento de porciones en recetas y verificar mermas de carne o proteínas no declaradas.",
      });
    }

    // 2. Fuga de Prime Cost > 65% (Alerta roja de viabilidad unit economics)
    if (branch.primeCostPercent > 65.0) {
      const overrunPoints = branch.primeCostPercent - 60.0;
      const impactMxn = Math.round((overrunPoints / 100) * (branch.salesTotalCents / 100));
      findings.push({
        id: `prime-cost-leak-${branch.branchId}`,
        type: "PRIME_COST_LEAK",
        severity: "critical",
        title: `Prime Cost Crítico en ${branch.branchName} (${branch.primeCostPercent.toFixed(1)}%)`,
        narrative: `El costo combinado de alimentos y mano de obra en ${branch.branchName} absorbe el ${branch.primeCostPercent.toFixed(1)}% de la venta, excediendo el límite de viabilidad de 60%.`,
        affectedBranchId: branch.branchId,
        affectedBranchName: branch.branchName,
        variancePoints: Math.round(overrunPoints * 10) / 10,
        estimatedImpactMxn: impactMxn,
        suggestedAction: "Ajustar cuadrante de horas en horas valle y revisar precios de compra con comisariato.",
      });
    }

    // 3. Sobrecosto laboral > 3.5 puntos sobre el promedio de la red
    const laborDiff = branch.laborCostPercent - avgLaborCost;
    if (laborDiff > 3.5) {
      const impactMxn = Math.round((laborDiff / 100) * (branch.salesTotalCents / 100));
      findings.push({
        id: `labor-overrun-${branch.branchId}`,
        type: "LABOR_OVERRUN",
        severity: "warning",
        title: `Sobrecosto Laboral en ${branch.branchName} (+${laborDiff.toFixed(1)} pts)`,
        narrative: `La nómina en ${branch.branchName} representa el ${branch.laborCostPercent.toFixed(1)}% de las ventas, comparado con el promedio de la red de ${avgLaborCost.toFixed(1)}%.`,
        affectedBranchId: branch.branchId,
        affectedBranchName: branch.branchName,
        variancePoints: Math.round(laborDiff * 10) / 10,
        estimatedImpactMxn: impactMxn,
        suggestedAction: "Auditar horas extras aprobadas y redistribuir personal hacia tiendas con mayor afluencia.",
      });
    }
  }

  return findings;
}

