import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { kpiAlerts } from "@/lib/db/schema";
import { eq, sql, and, gte, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { subDays, startOfDay } from "date-fns";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const period = searchParams.get("period") || "30d";
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const startDate = startOfDay(subDays(new Date(), days));

    const result = await db
      .select({
        avgResolutionMinutes: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${kpiAlerts.resolvedAt} - ${kpiAlerts.acknowledgedAt})) / 60), 0)`,
        avgAcknowledgmentMinutes: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${kpiAlerts.acknowledgedAt} - ${kpiAlerts.createdAt})) / 60), 0)`,
        totalResolved: sql<number>`cast(count(*) filter (where ${kpiAlerts.resolvedAt} is not null) as integer)`,
        totalActive: sql<number>`cast(count(*) filter (where ${kpiAlerts.status} = 'ACTIVE') as integer)`,
      })
      .from(kpiAlerts)
      .where(gte(kpiAlerts.createdAt, startDate));

    return NextResponse.json({
      avgResolutionMinutes: Math.round(Number(result[0]?.avgResolutionMinutes || 0) * 10) / 10,
      avgAcknowledgmentMinutes: Math.round(Number(result[0]?.avgAcknowledgmentMinutes || 0) * 10) / 10,
      totalResolved: Number(result[0]?.totalResolved || 0),
      totalActive: Number(result[0]?.totalActive || 0),
    });
  } catch (error) {
    console.error("[Alert Resolution Time API] Error:", error);
    return NextResponse.json({ error: "Failed to fetch alert resolution time" }, { status: 500 });
  }
}
