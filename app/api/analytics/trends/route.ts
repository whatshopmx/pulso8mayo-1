import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowTemplates,
  temperatureLogs,
  inventoryMovements,
  shiftSessions,
  costRecords,
  incidents,
  complianceAlerts,
  branches,
} from "@/lib/db/schema";
import { eq, sql, and, gte, lte, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { subDays, startOfDay, endOfDay, format, startOfYear } from "date-fns";
import { enforceBranchScope, getAccessibleBranchIds } from "@/lib/branch-scope";

const VALID_METRICS = [
  "workflow_completion",
  "inventory_consumption",
  "labor_hours",
  "costs",
  "alert_frequency",
] as const;
type Metric = (typeof VALID_METRICS)[number];

function getDateRange(period: string): { start: Date; end: Date } {
  const end = endOfDay(new Date());
  let start: Date;
  if (period === "7d") start = startOfDay(subDays(new Date(), 7));
  else if (period === "30d") start = startOfDay(subDays(new Date(), 30));
  else if (period === "90d") start = startOfDay(subDays(new Date(), 90));
  else if (period === "1y") start = startOfDay(subDays(new Date(), 365));
  else start = startOfDay(subDays(new Date(), 30));
  return { start, end };
}

function getComparisonRange(
  period: string,
  compareWith: string
): { start: Date; end: Date } | null {
  const days =
    period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
  const end = endOfDay(subDays(new Date(), days));
  let start: Date;
  if (compareWith === "previous_period") {
    start = startOfDay(subDays(end, days));
  } else if (compareWith === "same_period_last_year") {
    start = startOfDay(subDays(end, days));
    const prevEnd = subDays(new Date(), days);
    return {
      start: startOfDay(subDays(prevEnd, days)),
      end: endOfDay(prevEnd),
    };
  } else {
    return null;
  }
  return { start, end };
}

async function getWorkflowCompletionTrend(
  companyId: string,
  branchIds: string[],
  dateRange: { start: Date; end: Date }
) {
  const result = await db
    .select({
      date: sql<string>`DATE(${workflowInstances.createdAt})`,
      total: sql<number>`cast(count(*) as integer)`,
      completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
    })
    .from(workflowInstances)
    .innerJoin(
      workflowTemplates,
      eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
    )
    .where(
      and(
        eq(workflowTemplates.companyId, companyId),
        inArray(workflowInstances.branchId, branchIds),
        gte(workflowInstances.createdAt, dateRange.start),
        lte(workflowInstances.createdAt, dateRange.end)
      )
    )
    .groupBy(sql`DATE(${workflowInstances.createdAt})`)
    .orderBy(sql`DATE(${workflowInstances.createdAt})`);

  return result.map((r) => ({
    date: format(new Date(r.date), "MMM dd"),
    value: r.total > 0 ? Math.round((r.completed / r.total) * 100 * 10) / 10 : 0,
    raw: { total: r.total, completed: r.completed },
  }));
}

async function getInventoryConsumptionTrend(
  branchIds: string[],
  dateRange: { start: Date; end: Date }
) {
  const result = await db
    .select({
      date: sql<string>`DATE(${inventoryMovements.timestamp})`,
      total: sql<number>`cast(sum(abs(${inventoryMovements.quantityChange})) as integer)`,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(inventoryMovements)
    .where(
      and(
        inArray(inventoryMovements.branchId, branchIds),
        inArray(inventoryMovements.type, ["USAGE", "WASTE"]),
        gte(inventoryMovements.timestamp, dateRange.start),
        lte(inventoryMovements.timestamp, dateRange.end)
      )
    )
    .groupBy(sql`DATE(${inventoryMovements.timestamp})`)
    .orderBy(sql`DATE(${inventoryMovements.timestamp})`);

  return result.map((r) => ({
    date: format(new Date(r.date), "MMM dd"),
    value: r.total,
    raw: { count: r.count },
  }));
}

async function getLaborHoursTrend(
  branchIds: string[],
  dateRange: { start: Date; end: Date }
) {
  const result = await db
    .select({
      date: sql<string>`DATE(${shiftSessions.startedAt})`,
      totalMinutes: sql<number>`cast(sum(${shiftSessions.totalWorkMinutes}) as integer)`,
      sessions: sql<number>`cast(count(*) as integer)`,
    })
    .from(shiftSessions)
    .where(
      and(
        inArray(shiftSessions.branchId, branchIds),
        gte(shiftSessions.startedAt, dateRange.start),
        lte(shiftSessions.startedAt, dateRange.end),
        eq(shiftSessions.status, "COMPLETED")
      )
    )
    .groupBy(sql`DATE(${shiftSessions.startedAt})`)
    .orderBy(sql`DATE(${shiftSessions.startedAt})`);

  return result.map((r) => ({
    date: format(new Date(r.date), "MMM dd"),
    value: Math.round(r.totalMinutes / 60),
    raw: { minutes: r.totalMinutes, sessions: r.sessions },
  }));
}

async function getCostsTrend(
  companyId: string,
  branchIds: string[],
  dateRange: { start: Date; end: Date }
) {
  const result = await db
    .select({
      date: sql<string>`DATE(${costRecords.recordedAt})`,
      total: sql<number>`cast(sum(${costRecords.amount}) as integer)`,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(costRecords)
    .where(
      and(
        eq(costRecords.companyId, companyId),
        inArray(costRecords.branchId, branchIds),
        gte(costRecords.recordedAt, dateRange.start),
        lte(costRecords.recordedAt, dateRange.end)
      )
    )
    .groupBy(sql`DATE(${costRecords.recordedAt})`)
    .orderBy(sql`DATE(${costRecords.recordedAt})`);

  return result.map((r) => ({
    date: format(new Date(r.date), "MMM dd"),
    value: r.total,
    raw: { count: r.count },
  }));
}

async function getAlertFrequencyTrend(
  companyId: string,
  branchIds: string[],
  dateRange: { start: Date; end: Date }
) {
  const incidentResult = await db
    .select({
      date: sql<string>`DATE(${incidents.createdAt})`,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(incidents)
    .where(
      and(
        inArray(incidents.branchId, branchIds),
        gte(incidents.createdAt, dateRange.start),
        lte(incidents.createdAt, dateRange.end)
      )
    )
    .groupBy(sql`DATE(${incidents.createdAt})`)
    .orderBy(sql`DATE(${incidents.createdAt})`);

  const complianceResult = await db
    .select({
      date: sql<string>`DATE(${complianceAlerts.createdAt})`,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(complianceAlerts)
    .where(
      and(
        eq(complianceAlerts.companyId, companyId),
        inArray(complianceAlerts.branchId, branchIds),
        gte(complianceAlerts.createdAt, dateRange.start),
        lte(complianceAlerts.createdAt, dateRange.end)
      )
    )
    .groupBy(sql`DATE(${complianceAlerts.createdAt})`)
    .orderBy(sql`DATE(${complianceAlerts.createdAt})`);

  const merged = new Map<string, number>();
  for (const r of incidentResult) {
    const key = format(new Date(r.date), "MMM dd");
    merged.set(key, (merged.get(key) || 0) + r.count);
  }
  for (const r of complianceResult) {
    const key = format(new Date(r.date), "MMM dd");
    merged.set(key, (merged.get(key) || 0) + r.count);
  }

  return Array.from(merged.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      value,
      raw: { incidents: 0, complianceAlerts: 0 },
    }));
}

async function fetchTrend(
  metric: Metric,
  companyId: string,
  branchIds: string[],
  dateRange: { start: Date; end: Date }
) {
  switch (metric) {
    case "workflow_completion":
      return getWorkflowCompletionTrend(companyId, branchIds, dateRange);
    case "inventory_consumption":
      return getInventoryConsumptionTrend(branchIds, dateRange);
    case "labor_hours":
      return getLaborHoursTrend(branchIds, dateRange);
    case "costs":
      return getCostsTrend(companyId, branchIds, dateRange);
    case "alert_frequency":
      return getAlertFrequencyTrend(companyId, branchIds, dateRange);
    default:
      return [];
  }
}

function calcAggregate(data: { value: number }[]): {
  total: number;
  avg: number;
  min: number;
  max: number;
} {
  const values = data.map((d) => d.value);
  if (values.length === 0) return { total: 0, avg: 0, min: 0, max: 0 };
  return {
    total: values.reduce((a, b) => a + b, 0),
    avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

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
    const metric = (searchParams.get("metric") || "workflow_completion") as Metric;
    const period = searchParams.get("period") || "30d";
    const requestedBranchId = searchParams.get("branchId");
    const compareWith = searchParams.get("compareWith") || "";

    if (!VALID_METRICS.includes(metric)) {
      return NextResponse.json(
        { error: `Invalid metric. Valid: ${VALID_METRICS.join(", ")}` },
        { status: 400 }
      );
    }

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
      return NextResponse.json({
        metric,
        period,
        trend: [],
        comparison: null,
        summary: { total: 0, avg: 0, min: 0, max: 0 },
      });
    }

    const dateRange = getDateRange(period);
    const trend = await fetchTrend(metric, companyId, targetBranchIds, dateRange);

    let comparisonTrend: any[] | null = null;
    let comparisonChange: number | null = null;

    if (compareWith) {
      const compRange = getComparisonRange(period, compareWith);
      if (compRange) {
        comparisonTrend = await fetchTrend(
          metric,
          companyId,
          targetBranchIds,
          compRange
        );
        const currentTotal = trend.reduce((s, t) => s + t.value, 0);
        const previousTotal = comparisonTrend.reduce((s, t) => s + t.value, 0);
        comparisonChange =
          previousTotal > 0
            ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100 * 10) /
              10
            : 0;
      }
    }

    const summary = calcAggregate(trend);

    return NextResponse.json({
      metric,
      period,
      trend,
      comparison: comparisonTrend
        ? { trend: comparisonTrend, change: comparisonChange }
        : null,
      summary,
      periodRange: {
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
      },
    });
  } catch (error) {
    console.error("[Trends API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch trend data" },
      { status: 500 }
    );
  }
}
