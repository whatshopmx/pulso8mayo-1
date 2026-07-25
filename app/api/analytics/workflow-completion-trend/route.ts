import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowInstances } from "@/lib/db/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import { headers } from "next/headers";
import { subDays, startOfDay, format } from "date-fns";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const period = searchParams.get("period") || "30d";
    const branchId = searchParams.get("branchId");

    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const startDate = startOfDay(subDays(new Date(), days));

    const conditions = [gte(workflowInstances.createdAt, startDate)];
    if (branchId && branchId !== "all") {
      conditions.push(eq(workflowInstances.branchId, branchId));
    }

    const result = await db
      .select({
        date: sql<string>`DATE(${workflowInstances.createdAt})`,
        total: sql<number>`cast(count(*) as integer)`,
        completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
      })
      .from(workflowInstances)
      .where(and(...conditions))
      .groupBy(sql`DATE(${workflowInstances.createdAt})`)
      .orderBy(sql`DATE(${workflowInstances.createdAt})`);

    const trend = result.map((r) => ({
      date: format(new Date(r.date), "MMM dd"),
      rate: r.total > 0 ? Math.round((r.completed / r.total) * 100 * 10) / 10 : 0,
    }));

    return NextResponse.json({ trend });
  } catch (error) {
    console.error("[Workflow Completion Trend API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch completion trend" },
      { status: 500 }
    );
  }
}
