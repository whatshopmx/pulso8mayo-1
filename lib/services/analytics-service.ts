import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowAssignments,
  branches,
  incidents,
  inventoryBatches,
  costRecords,
} from "@/lib/db/schema";
import { eq, sql, and, gte, lte, inArray } from "drizzle-orm";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { enforceBranchScope, getAccessibleBranchIds } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";

export type Period = "7d" | "30d" | "90d";

export interface ExecutiveSummaryAlerts {
  criticalIncidents: number;
  overdueWorkflows: number;
  lowStockItems: number;
  expiringBatches: number;
}

export interface BranchPerformer {
  branchId: string;
  branchName: string;
  performanceIndex: number;
}

export interface ExecutiveSummaryBranchOverview {
  totalBranches: number;
  topPerformer: BranchPerformer | null;
  bottomPerformer: BranchPerformer | null;
  avgPerformanceIndex: number;
}

export interface ExecutiveSummaryCostTrends {
  currentPeriod: { total: number; byCategory: Record<string, number> };
  previousPeriod: { total: number; byCategory: Record<string, number> };
  changePercent: number;
}

export interface ExecutiveSummaryCompliance {
  avgScore: number;
  totalWorkflows: number;
  completedWorkflows: number;
  completionRate: number;
}

export interface ExecutiveSummaryData {
  alertSummary: ExecutiveSummaryAlerts;
  branchOverview: ExecutiveSummaryBranchOverview;
  costTrends: ExecutiveSummaryCostTrends;
  complianceOverview: ExecutiveSummaryCompliance;
}

export interface GetExecutiveSummaryArgs {
  companyId: string;
  userRole: Role;
  userBranchId?: string | null | undefined;
  /** Explicitly requested branch id from the active scope control; `null` ⇒ all accessible. */
  requestedBranchId?: string | null;
  period?: Period;
}

const EMPTY_SUMMARY: ExecutiveSummaryData = {
  alertSummary: {
    criticalIncidents: 0,
    overdueWorkflows: 0,
    lowStockItems: 0,
    expiringBatches: 0,
  },
  branchOverview: {
    totalBranches: 0,
    topPerformer: null,
    bottomPerformer: null,
    avgPerformanceIndex: 0,
  },
  costTrends: {
    currentPeriod: { total: 0, byCategory: {} },
    previousPeriod: { total: 0, byCategory: {} },
    changePercent: 0,
  },
  complianceOverview: {
    avgScore: 0,
    totalWorkflows: 0,
    completedWorkflows: 0,
    completionRate: 0,
  },
};

/**
 * Build the executive summary dataset for a company's accessible branches.
 *
 * Server-side data function shared by the `/api/analytics/executive-summary`
 * route and the dashboard's Server-Component `ExecutiveSummary` (AD-2 floor).
 * Per-subsection queries are defensive (try/catch returning 0) so a missing
 * table or schema drift doesn't blank the whole summary; the top-level error
 * propagates so the caller's error boundary can render an ErrorState.
 */
export async function getExecutiveSummary(
  args: GetExecutiveSummaryArgs,
): Promise<ExecutiveSummaryData> {
  const { companyId, userRole, userBranchId, requestedBranchId } = args;
  const period = args.period ?? "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;

  const startDate = startOfDay(subDays(new Date(), days));
  const endDate = endOfDay(new Date());
  const prevStartDate = startOfDay(subDays(startDate, days));
  const prevEndDate = startOfDay(new Date());

  const companyBranches = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  const allBranchIds = companyBranches.map((b) => b.id);
  const accessibleBranchIds = getAccessibleBranchIds(userRole, userBranchId, allBranchIds);
  const effectiveBranchId = enforceBranchScope(
    userRole,
    userBranchId,
    requestedBranchId ?? undefined,
  );
  const targetBranchIds = effectiveBranchId
    ? [effectiveBranchId]
    : accessibleBranchIds;

  if (targetBranchIds.length === 0) return EMPTY_SUMMARY;

  // --- Alerts strip --------------------------------------------------------
  let criticalIncidentsCount = 0;
  try {
    const r = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(incidents)
      .where(
        and(
          inArray(incidents.branchId, targetBranchIds),
          sql`${incidents.status} != 'RESOLVED'`,
          sql`${incidents.severity} IN ('CRITICAL', 'FATAL')`,
        ),
      );
    criticalIncidentsCount = Number(r[0]?.count || 0);
  } catch {}

  let overdueWorkflowsCount = 0;
  try {
    const r = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(workflowAssignments)
      .innerJoin(
        workflowInstances,
        eq(workflowAssignments.instanceId, workflowInstances.id),
      )
      .where(
        and(
          eq(workflowAssignments.isOverdue, true),
          inArray(workflowInstances.branchId, targetBranchIds),
        ),
      );
    overdueWorkflowsCount = Number(r[0]?.count || 0);
  } catch {}

  let lowStockCount = 0;
  try {
    const r = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(inventoryBatches)
      .where(
        and(
          inArray(inventoryBatches.branchId, targetBranchIds),
          sql`${inventoryBatches.currentQuantity} < 10`,
        ),
      );
    lowStockCount = Number(r[0]?.count || 0);
  } catch {}

  let expiringBatchesCount = 0;
  try {
    const r = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(inventoryBatches)
      .where(
        and(
          inArray(inventoryBatches.branchId, targetBranchIds),
          sql`${inventoryBatches.expirationDate} is not null`,
          sql`${inventoryBatches.expirationDate} <= now() + interval '7 days'`,
        ),
      );
    expiringBatchesCount = Number(r[0]?.count || 0);
  } catch {}

  // --- Branch performance --------------------------------------------------
  const branchPerformances = await Promise.all(
    targetBranchIds.map(async (branchId) => {
      const branchInfo = companyBranches.find((b) => b.id === branchId);
      let total = 0, completed = 0, completionRate = 0, avgScore = 0;
      try {
        const stats = await db
          .select({
            total: sql<number>`cast(count(*) as integer)`,
            completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
            avgScore: sql<number>`coalesce(avg(${workflowInstances.score}) filter (where ${workflowInstances.status} = 'COMPLETED'), 0)`,
          })
          .from(workflowInstances)
          .where(
            and(
              eq(workflowInstances.branchId, branchId),
              gte(workflowInstances.createdAt, startDate),
            ),
          );
        total = Number(stats[0]?.total || 0);
        completed = Number(stats[0]?.completed || 0);
        completionRate = total > 0 ? (completed / total) * 100 : 0;
        avgScore = Number(stats[0]?.avgScore || 0);
      } catch {}
      const performanceIndex = completionRate * 0.5 + avgScore * 0.5;
      return {
        branchId,
        branchName: branchInfo?.name || "Sin nombre",
        performanceIndex: Math.round(performanceIndex * 10) / 10,
      };
    }),
  );

  const sortedBranches = [...branchPerformances].sort(
    (a, b) => b.performanceIndex - a.performanceIndex,
  );
  const topPerformer = sortedBranches.length > 0 ? sortedBranches[0] : null;
  const bottomPerformer =
    sortedBranches.length > 1 ? sortedBranches[sortedBranches.length - 1] : null;
  const avgPerformanceIndex =
    branchPerformances.length > 0
      ? Math.round(
          (branchPerformances.reduce((sum, b) => sum + b.performanceIndex, 0) /
            branchPerformances.length) *
            10,
        ) / 10
      : 0;

  // --- Cost trends ---------------------------------------------------------
  let currentCostResult: { category: string; total: number }[] = [];
  try {
    currentCostResult = await db
      .select({
        category: costRecords.category,
        total: sql<number>`coalesce(sum(${costRecords.amount}), 0)`,
      })
      .from(costRecords)
      .where(
        and(
          eq(costRecords.companyId, companyId),
          inArray(costRecords.branchId, targetBranchIds),
          gte(costRecords.recordedAt, startDate),
          lte(costRecords.recordedAt, endDate),
        ),
      )
      .groupBy(costRecords.category);
  } catch {}

  let previousCostResult: { category: string; total: number }[] = [];
  try {
    previousCostResult = await db
      .select({
        category: costRecords.category,
        total: sql<number>`coalesce(sum(${costRecords.amount}), 0)`,
      })
      .from(costRecords)
      .where(
        and(
          eq(costRecords.companyId, companyId),
          inArray(costRecords.branchId, targetBranchIds),
          gte(costRecords.recordedAt, prevStartDate),
          lte(costRecords.recordedAt, prevEndDate),
        ),
      )
      .groupBy(costRecords.category);
  } catch {}

  const currentByCategory: Record<string, number> = {};
  let currentTotal = 0;
  for (const row of currentCostResult) {
    const amount = Number(row.total);
    currentByCategory[row.category] = amount;
    currentTotal += amount;
  }
  const previousByCategory: Record<string, number> = {};
  let previousTotal = 0;
  for (const row of previousCostResult) {
    const amount = Number(row.total);
    previousByCategory[row.category] = amount;
    previousTotal += amount;
  }
  const changePercent =
    previousTotal > 0
      ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100 * 10) / 10
      : 0;

  // --- Compliance overview -------------------------------------------------
  let complianceStats: { total: number; completed: number; avgScore: number }[] = [];
  try {
    complianceStats = await db
      .select({
        total: sql<number>`cast(count(*) as integer)`,
        completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
        avgScore: sql<number>`coalesce(avg(${workflowInstances.score}) filter (where ${workflowInstances.status} = 'COMPLETED'), 0)`,
      })
      .from(workflowInstances)
      .where(
        and(
          inArray(workflowInstances.branchId, targetBranchIds),
          gte(workflowInstances.createdAt, startDate),
        ),
      );
  } catch {}

  const totalWorkflows = Number(complianceStats[0]?.total || 0);
  const completedWorkflows = Number(complianceStats[0]?.completed || 0);
  const completionRate =
    totalWorkflows > 0
      ? Math.round((completedWorkflows / totalWorkflows) * 100 * 10) / 10
      : 0;
  const avgComplianceScore =
    Math.round(Number(complianceStats[0]?.avgScore || 0) * 10) / 10;

  return {
    alertSummary: {
      criticalIncidents: criticalIncidentsCount,
      overdueWorkflows: overdueWorkflowsCount,
      lowStockItems: lowStockCount,
      expiringBatches: expiringBatchesCount,
    },
    branchOverview: {
      totalBranches: targetBranchIds.length,
      topPerformer: topPerformer
        ? {
            branchId: topPerformer.branchId,
            branchName: topPerformer.branchName,
            performanceIndex: topPerformer.performanceIndex,
          }
        : null,
      bottomPerformer: bottomPerformer
        ? {
            branchId: bottomPerformer.branchId,
            branchName: bottomPerformer.branchName,
            performanceIndex: bottomPerformer.performanceIndex,
          }
        : null,
      avgPerformanceIndex,
    },
    costTrends: {
      currentPeriod: { total: currentTotal, byCategory: currentByCategory },
      previousPeriod: { total: previousTotal, byCategory: previousByCategory },
      changePercent,
    },
    complianceOverview: {
      avgScore: avgComplianceScore,
      totalWorkflows,
      completedWorkflows,
      completionRate,
    },
  };
}