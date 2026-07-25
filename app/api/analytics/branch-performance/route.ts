import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowAssignments,
  workflowTemplates,
  branches,
  incidents,
  shiftSessions,
  temperatureLogs,
  inventoryBatches,
  costRecords,
} from "@/lib/db/schema";
import { eq, sql, and, gte, lte, inArray, desc } from "drizzle-orm";
import { headers } from "next/headers";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { enforceBranchScope, getAccessibleBranchIds } from "@/lib/branch-scope";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = session.user.companyId;
    const userRole = (session.user as any).role as string;
    const userBranchId = (session.user as any).branchId as string | undefined;

    const searchParams = req.nextUrl.searchParams;
    const period = searchParams.get("period") || "30d";
    const requestedBranchId = searchParams.get("branchId");

    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const startDate = startOfDay(subDays(new Date(), days));
    const endDate = endOfDay(new Date());

    const companyBranches = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const allBranchIds = companyBranches.map((b) => b.id);

    const accessibleBranchIds = getAccessibleBranchIds(
      userRole as any,
      userBranchId,
      allBranchIds
    );

    const effectiveBranchId = enforceBranchScope(
      userRole as any,
      userBranchId,
      requestedBranchId
    );

    const targetBranchIds = effectiveBranchId
      ? [effectiveBranchId]
      : accessibleBranchIds;

    if (targetBranchIds.length === 0) {
      return NextResponse.json({ branches: [], ranking: [] });
    }

  const branchData = await Promise.all(
  targetBranchIds.map(async (branchId) => {
    const branchInfo = companyBranches.find((b) => b.id === branchId);

    let workflowStats: any[] = [];
    try {
      workflowStats = await db
        .select({
          total: sql<number>`cast(count(*) as integer)`,
          completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
          avgScore: sql<number>`coalesce(avg(${workflowInstances.score}) filter (where ${workflowInstances.status} = 'COMPLETED'), 0)`,
        })
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.branchId, branchId),
            gte(workflowInstances.createdAt, startDate)
          )
        );
    } catch { workflowStats = [{ total: 0, completed: 0, avgScore: 0 }]; }

    let assignmentStats: any[] = [];
    try {
      assignmentStats = await db
        .select({
          total: sql<number>`cast(count(*) as integer)`,
          completed: sql<number>`cast(count(*) filter (where ${workflowAssignments.status} = 'COMPLETED') as integer)`,
        })
        .from(workflowAssignments)
        .innerJoin(
          workflowInstances,
          eq(workflowAssignments.instanceId, workflowInstances.id)
        )
        .where(
          and(
            eq(workflowInstances.branchId, branchId),
            gte(workflowAssignments.createdAt, startDate)
          )
        );
    } catch { assignmentStats = [{ total: 0, completed: 0 }]; }

    let incidentStats: any[] = [];
    try {
      incidentStats = await db
        .select({
          open: sql<number>`cast(count(*) as integer)`,
        })
        .from(incidents)
        .where(
          and(
            eq(incidents.branchId, branchId),
            sql`${incidents.status} != 'RESOLVED'`
          )
        );
    } catch { incidentStats = [{ open: 0 }]; }

    let attendanceStats: any[] = [];
    try {
      attendanceStats = await db
        .select({
          total: sql<number>`cast(count(*) as integer)`,
          completed: sql<number>`cast(count(*) filter (where ${shiftSessions.status} = 'COMPLETED') as integer)`,
          noShows: sql<number>`cast(count(*) filter (where ${shiftSessions.status} = 'NO_SHOW') as integer)`,
          overtimeMinutes: sql<number>`coalesce(sum(${shiftSessions.overtimeMinutes}), 0)`,
        })
        .from(shiftSessions)
        .where(
          and(
            eq(shiftSessions.branchId, branchId),
            gte(shiftSessions.startedAt, startDate)
          )
        );
    } catch { attendanceStats = [{ total: 0, completed: 0, noShows: 0, overtimeMinutes: 0 }]; }

    let tempStats: any[] = [];
    try {
      tempStats = await db
        .select({
          total: sql<number>`cast(count(*) as integer)`,
          compliant: sql<number>`cast(count(*) filter (where ${temperatureLogs.isCompliant} = true) as integer)`,
        })
        .from(temperatureLogs)
        .where(
          and(
            eq(temperatureLogs.branchId, branchId),
            gte(temperatureLogs.timestamp, startDate)
          )
        );
    } catch { tempStats = [{ total: 0, compliant: 0 }]; }

    let inventoryStats: any[] = [];
    try {
      inventoryStats = await db
        .select({
          totalBatches: sql<number>`cast(count(*) as integer)`,
          lowStock: sql<number>`cast(count(*) filter (where ${inventoryBatches.currentQuantity} < 10) as integer)`,
          expiringSoon: sql<number>`cast(count(*) filter (where ${inventoryBatches.expirationDate} is not null and ${inventoryBatches.expirationDate} <= now() + interval '7 days') as integer)`,
        })
        .from(inventoryBatches)
        .where(eq(inventoryBatches.branchId, branchId));
    } catch { inventoryStats = [{ totalBatches: 0, lowStock: 0, expiringSoon: 0 }]; }

    let costStats: any[] = [];
    try {
      costStats = await db
        .select({
          category: costRecords.category,
          total: sql<number>`coalesce(sum(${costRecords.amount}), 0)`,
        })
        .from(costRecords)
        .where(
          and(
            eq(costRecords.branchId, branchId),
            gte(costRecords.recordedAt, startDate)
          )
        )
        .groupBy(costRecords.category);
    } catch { costStats = []; }

    const total = Number(workflowStats[0]?.total || 0);
    const completed = Number(workflowStats[0]?.completed || 0);
    const completionRate = total > 0 ? (completed / total) * 100 : 0;
    const complianceScore = Number(workflowStats[0]?.avgScore || 0);

    const totalAssignments = Number(assignmentStats[0]?.total || 0);
    const completedAssignments = Number(assignmentStats[0]?.completed || 0);
    const assignmentCompletionRate =
      totalAssignments > 0
        ? (completedAssignments / totalAssignments) * 100
        : 0;

    const totalSessions = Number(attendanceStats[0]?.total || 0);
    const noShows = Number(attendanceStats[0]?.noShows || 0);
    const attendanceRate =
      totalSessions > 0 ? ((totalSessions - noShows) / totalSessions) * 100 : 100;

    const totalTemp = Number(tempStats[0]?.total || 0);
    const compliantTemp = Number(tempStats[0]?.compliant || 0);
    const tempCompliance =
      totalTemp > 0 ? (compliantTemp / totalTemp) * 100 : 100;

    const performanceIndex =
      completionRate * 0.3 +
      complianceScore * 0.25 +
      assignmentCompletionRate * 0.2 +
      attendanceRate * 0.15 +
      tempCompliance * 0.1;

    return {
      branchId,
      branchName: branchInfo?.name || "Sin nombre",
      workflowMetrics: {
        completionRate: Math.round(completionRate * 10) / 10,
        totalWorkflows: total,
        completedWorkflows: completed,
        avgScore: Math.round(complianceScore * 10) / 10,
      },
      complianceScore: Math.round(complianceScore * 10) / 10,
      assignmentMetrics: {
        completionRate: Math.round(assignmentCompletionRate * 10) / 10,
        total: totalAssignments,
        completed: completedAssignments,
      },
      openIncidents: Number(incidentStats[0]?.open || 0),
      laborMetrics: {
        attendanceRate: Math.round(attendanceRate * 10) / 10,
        totalSessions,
        noShows,
        overtimeMinutes: Number(attendanceStats[0]?.overtimeMinutes || 0),
      },
      temperatureMetrics: {
        complianceRate: Math.round(tempCompliance * 10) / 10,
        totalReadings: totalTemp,
        compliantReadings: compliantTemp,
      },
      inventoryMetrics: {
        totalBatches: Number(inventoryStats[0]?.totalBatches || 0),
        lowStock: Number(inventoryStats[0]?.lowStock || 0),
        expiringSoon: Number(inventoryStats[0]?.expiringSoon || 0),
      },
      costMetrics: {
        total: costStats.reduce((sum: number, r: any) => sum + Number(r.total), 0),
        byCategory: Object.fromEntries(costStats.map((r: any) => [r.category, Number(r.total)])),
      },
      performanceIndex: Math.round(performanceIndex * 10) / 10,
    };
  })
);

    const ranking = [...branchData]
      .sort((a, b) => b.performanceIndex - a.performanceIndex)
      .map((b, i) => ({
        rank: i + 1,
        branchId: b.branchId,
        branchName: b.branchName,
        performanceIndex: b.performanceIndex,
      }));

    return NextResponse.json({
      branches: branchData,
      ranking,
      period: { days, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
  } catch (error) {
    console.error("[Branch Performance API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch branch performance" },
      { status: 500 }
    );
  }
}
