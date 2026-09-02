import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { incidents, branches } from "@/lib/db/schema";
import { eq, and, sql, gte, lte, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { resolveBranchScope } from "@/lib/branch-scope";
import { NextResponse } from "next/server";

function getDateRange(period: string) {
  const now = new Date();
  const ranges: Record<string, Date> = {
    "7d": new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    "30d": new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    "90d": new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
  };
  return ranges[period] || ranges["30d"];
}

function getPreviousDateRange(period: string) {
  const now = new Date();
  const ranges: Record<string, { start: Date; end: Date }> = {
    "7d": {
      start: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      end: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    },
    "30d": {
      start: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      end: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    },
    "90d": {
      start: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
      end: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
    },
  };
  return ranges[period] || ranges["30d"];
}

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = session.user.companyId;
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "30d";
    const branchId = searchParams.get("branchId");

    const companyBranches = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const companyBranchIds = companyBranches.map((b) => b.id);

    /**
     * El `branchId` del query no decide solo.
     *
     * Comprobar únicamente que la sucursal sea de la empresa deja que un
     * GERENTE pida `?branchId=<otra sucursal>` —o `all`— y vea métricas fuera
     * de su alcance. La lista de incidentes ya pasa por `resolveBranchScope`
     * (`app/dashboard/incidents/page.tsx`); este endpoint se le había quedado
     * atrás y contradecía a la propia pantalla que lo consume.
     *
     * `NONE` (rol acotado sin sucursal asignada) cae en la rama de arreglo
     * vacío de abajo y responde en ceros, que es el fail-closed correcto.
     */
    const alcance = resolveBranchScope(
      (session.user as any).role,
      (session.user as any).branchId ?? null,
      branchId && branchId !== "all" ? branchId : null
    );

    const targetBranchIds =
      alcance.kind === "NONE"
        ? []
        : alcance.kind === "BRANCH"
          ? companyBranchIds.filter((id) => id === alcance.branchId)
          : companyBranchIds;

    if (targetBranchIds.length === 0) {
      return NextResponse.json({
        summary: { total: 0, active: 0, resolved: 0, avgResolutionHours: 0 },
        bySeverity: [],
        byBranch: [],
        trends: [],
        timeToResolution: { avg: 0, min: 0, max: 0 },
      });
    }

    const startDate = getDateRange(period);
    const prev = getPreviousDateRange(period);

    const dateConditions = [gte(incidents.createdAt, startDate)];

    const prevDateConditions = [
      gte(incidents.createdAt, prev.start),
      lte(incidents.createdAt, prev.end),
    ];

    // Current period counts
    const [totalResult, activeResult, resolvedResult] = await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(incidents)
        .where(and(inArray(incidents.branchId, targetBranchIds), ...dateConditions)),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(incidents)
        .where(
          and(
            inArray(incidents.branchId, targetBranchIds),
            sql`${incidents.status} != 'RESOLVED'`,
            ...dateConditions,
          ),
        ),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(incidents)
        .where(
          and(inArray(incidents.branchId, targetBranchIds), eq(incidents.status, "RESOLVED"), ...dateConditions),
        ),
    ]);

    // Previous period for deltas
    const [prevTotalResult, prevActiveResult] = await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(incidents)
        .where(and(inArray(incidents.branchId, targetBranchIds), ...prevDateConditions)),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(incidents)
        .where(
          and(
            inArray(incidents.branchId, targetBranchIds),
            sql`${incidents.status} != 'RESOLVED'`,
            ...prevDateConditions,
          ),
        ),
    ]);

    // Severity distribution
    const bySeverity = await db
      .select({
        severity: incidents.severity,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(incidents)
      .where(and(inArray(incidents.branchId, targetBranchIds), ...dateConditions))
      .groupBy(incidents.severity);

    // By branch
    const byBranch = await db
      .select({
        branchId: incidents.branchId,
        branchName: branches.name,
        count: sql<number>`cast(count(*) as integer)`,
        active: sql<number>`cast(sum(case when ${incidents.status} != 'RESOLVED' then 1 else 0 end) as integer)`,
      })
      .from(incidents)
      .innerJoin(branches, eq(incidents.branchId, branches.id))
      .where(and(inArray(incidents.branchId, targetBranchIds), ...dateConditions))
      .groupBy(incidents.branchId, branches.name);

    // Daily trends
    const trends = await db
      .select({
        date: sql<string>`DATE(${incidents.createdAt})`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(incidents)
      .where(and(inArray(incidents.branchId, targetBranchIds), ...dateConditions))
      .groupBy(sql`DATE(${incidents.createdAt})`)
      .orderBy(sql`DATE(${incidents.createdAt})`);

    // Time to resolution
    const resolutionTimes = await db
      .select({
        hours: sql<number>`extract(epoch from (${incidents.resolvedAt} - ${incidents.createdAt})) / 3600`,
      })
      .from(incidents)
      .where(
        and(
          inArray(incidents.branchId, targetBranchIds),
          eq(incidents.status, "RESOLVED"),
          sql`${incidents.resolvedAt} IS NOT NULL`,
          ...dateConditions,
        ),
      );

    const hours = resolutionTimes.map((r) => Number(r.hours)).filter((h) => !isNaN(h) && h > 0);
    const avgResolution = hours.length > 0 ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length * 10) / 10 : 0;
    const minResolution = hours.length > 0 ? Math.round(Math.min(...hours) * 10) / 10 : 0;
    const maxResolution = hours.length > 0 ? Math.round(Math.max(...hours) * 10) / 10 : 0;

    const currentTotal = Number(totalResult[0]?.count || 0);
    const prevTotal = Number(prevTotalResult[0]?.count || 0);
    const currentActive = Number(activeResult[0]?.count || 0);
    const prevActive = Number(prevActiveResult[0]?.count || 0);

    return NextResponse.json({
      summary: {
        total: currentTotal,
        active: currentActive,
        resolved: Number(resolvedResult[0]?.count || 0),
        avgResolutionHours: avgResolution,
        totalDelta: prevTotal > 0 ? Math.round(((currentTotal - prevTotal) / prevTotal) * 100) : 0,
        activeDelta: prevActive > 0 ? Math.round(((currentActive - prevActive) / prevActive) * 100) : 0,
      },
      bySeverity: bySeverity.map((s) => ({
        severity: s.severity,
        count: Number(s.count),
      })),
      byBranch: byBranch.map((b) => ({
        branchId: b.branchId,
        name: b.branchName,
        count: Number(b.count),
        active: Number(b.active),
      })),
      trends: trends.map((t) => ({
        date: t.date,
        count: Number(t.count),
      })),
      timeToResolution: {
        avg: avgResolution,
        min: minResolution,
        max: maxResolution,
      },
    });
  } catch (error) {
    console.error("Error fetching incident analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch incident analytics" },
      { status: 500 },
    );
  }
}
