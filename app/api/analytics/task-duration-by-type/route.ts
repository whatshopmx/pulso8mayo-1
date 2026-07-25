import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowAssignments, workflowInstances, workflowTemplates, branches } from "@/lib/db/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import { headers } from "next/headers";
import { enforceBranchScope, getAccessibleBranchIds } from "@/lib/branch-scope";
import { subDays, startOfDay } from "date-fns";

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

    const allBranchIds = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const targetBranchIds = allBranchIds.map((b: any) => b.id);

    const result = await db
      .select({
        complianceType: workflowTemplates.complianceType,
        avgDurationMinutes: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${workflowAssignments.completedAt} - ${workflowAssignments.createdAt})) / 60), 0)`,
        taskCount: sql<number>`cast(count(*) as integer)`,
      })
      .from(workflowAssignments)
      .innerJoin(workflowInstances, eq(workflowAssignments.instanceId, workflowInstances.id))
      .innerJoin(
        workflowTemplates,
        eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
      )
      .where(
        and(
          eq(workflowAssignments.status, "COMPLETED"),
          gte(workflowAssignments.completedAt, startDate),
          requestedBranchId && requestedBranchId !== "all"
            ? eq(workflowInstances.branchId, requestedBranchId)
            : sql`1=1`
        )
      )
      .groupBy(workflowTemplates.complianceType);

    return NextResponse.json({
      taskTypes: result.map((r) => ({
        complianceType: r.complianceType || "GENERAL",
        avgDurationMinutes: Math.round(Number(r.avgDurationMinutes) * 10) / 10,
        taskCount: Number(r.taskCount),
      })),
    });
  } catch (error) {
    console.error("[Task Duration By Type API] Error:", error);
    return NextResponse.json({ error: "Failed to fetch task duration by type" }, { status: 500 });
  }
}
