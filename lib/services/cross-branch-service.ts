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
} from "@/lib/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { subDays, startOfDay } from "date-fns";

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

        return { metrics, bestPractices, worstPractices };
      },
      [cacheKey(companyId, "benchmarking")],
      { revalidate: CACHE_TTL, tags: [...CACHE_TAGS, "benchmarking"] },
    )(companyId);
  },
};
