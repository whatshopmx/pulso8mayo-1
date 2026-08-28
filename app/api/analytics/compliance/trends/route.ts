import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workflowInstances,
  workflowTemplates,
  branches,
  incidents,
  workflowSchedules,
  complianceAlerts,
  companies,
} from "@/lib/db/schema";
import { eq, sql, and, gte, lte, desc, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * API Endpoint for Compliance Analytics
 * Returns compliance trends, scorecards by category, deadlines, and alerts
 */
export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    let companyId = session.user.companyId;

    // Fallback for SUPER_ADMIN without direct companyId binding
    if (!companyId && (session.user.role === "SUPER_ADMIN" || session.user.role === "ADMIN")) {
      const firstCompany = await db.query.companies.findFirst({
        columns: { id: true },
      });
      if (firstCompany) {
        companyId = firstCompany.id;
      }
    }

    if (!companyId) {
      return new NextResponse("Company ID required", { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    const days = parseInt(searchParams.get("days") || "30");

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get user's accessible branches
    const userBranches = await db.query.branches.findMany({
      where: eq(branches.companyId, companyId),
      columns: { id: true, name: true },
    });

    const branchIds = userBranches.map((b) => b.id);
    const filterBranchIds = branchId && branchId !== "all" ? [branchId] : branchIds;

    // 1. Historical Trends (daily compliance rate)
    let trendsQuery: any[] = [];
    try {
      trendsQuery = await db
        .select({
          date: sql<string>`DATE(${workflowInstances.completedAt})`,
          avgScore: sql<number>`AVG(${workflowInstances.score})`,
          completedCount: sql<number>`COUNT(*)`,
        })
        .from(workflowInstances)
        .innerJoin(
          workflowTemplates,
          eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
        )
        .where(
          and(
            eq(workflowTemplates.companyId, companyId),
            eq(workflowInstances.status, "COMPLETED"),
            gte(workflowInstances.completedAt, startDate),
            lte(workflowInstances.completedAt, endDate),
            filterBranchIds.length > 0
              ? inArray(workflowInstances.branchId, filterBranchIds)
              : undefined
          )
        )
        .groupBy(sql`DATE(${workflowInstances.completedAt})`)
        .orderBy(sql`DATE(${workflowInstances.completedAt})`);
    } catch (e) {
      console.warn("Failed to fetch trends query, using empty fallback", e);
    }

    // 2. Compliance Scorecards by Category
    let categoryQuery: any[] = [];
    try {
      categoryQuery = await db
        .select({
          category: workflowTemplates.category,
          complianceType: workflowTemplates.complianceType,
          avgScore: sql<number>`AVG(${workflowInstances.score})`,
          totalCount: sql<number>`COUNT(*)`,
          criticalCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowTemplates.isCritical} = true)`,
        })
        .from(workflowInstances)
        .innerJoin(
          workflowTemplates,
          eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
        )
        .where(
          and(
            eq(workflowTemplates.companyId, companyId),
            eq(workflowInstances.status, "COMPLETED"),
            gte(workflowInstances.completedAt, startDate),
            lte(workflowInstances.completedAt, endDate),
            filterBranchIds.length > 0
              ? inArray(workflowInstances.branchId, filterBranchIds)
              : undefined
          )
        )
        .groupBy(workflowTemplates.category, workflowTemplates.complianceType);
    } catch (e) {
      console.warn("Failed to fetch category scorecards, using fallback", e);
    }

    // 3. Upcoming Deadlines from workflow_schedules (real data)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    let deadlinesQuery: any[] = [];
    try {
      if (branchIds.length > 0) {
        deadlinesQuery = await db
          .select({
            id: workflowSchedules.id,
            name: workflowSchedules.title,
            branchName: branches.name,
            branchId: workflowSchedules.branchId,
            nextExecutionAt: workflowSchedules.nextExecutionAt,
            templateId: workflowSchedules.templateId,
            frequency: workflowSchedules.frequency,
          })
          .from(workflowSchedules)
          .leftJoin(branches, eq(workflowSchedules.branchId, branches.id))
          .where(
            and(
              eq(workflowSchedules.isActive, true),
              inArray(workflowSchedules.branchId, branchIds),
              lte(workflowSchedules.nextExecutionAt, thirtyDaysFromNow)
            )
          )
          .orderBy(workflowSchedules.nextExecutionAt)
          .limit(15);
      }
    } catch {
      // Fallback to template-based list if schedules query fails
      try {
        deadlinesQuery = await db
          .select({
            id: workflowTemplates.id,
            name: workflowTemplates.name,
            branchName: branches.name,
            branchId: branches.id,
            nextExecutionAt: workflowTemplates.updatedAt,
            templateId: sql`null`,
            frequency: workflowTemplates.requiredFrequency,
          })
          .from(workflowTemplates)
          .leftJoin(branches, eq(workflowTemplates.branchId, branches.id))
          .where(
            and(
              eq(workflowTemplates.companyId, companyId),
              eq(workflowTemplates.active, true),
              eq(workflowTemplates.isCritical, true)
            )
          )
          .orderBy(desc(workflowTemplates.isCritical))
          .limit(10);
      } catch (e) {
        console.warn("Deadlines fallback also failed", e);
      }
    }

    // 4. Compliance Alerts - merge incidents + auto-generated complianceAlerts
    let incidentAlerts: any[] = [];
    try {
      if (branchIds.length > 0) {
        incidentAlerts = await db
          .select({
            id: incidents.id,
            title: incidents.title,
            severity: incidents.severity,
            status: incidents.status,
            branchId: incidents.branchId,
            createdAt: incidents.createdAt,
            workflowName: sql<string>`null`,
            source: sql<string>`'incident'`,
          })
          .from(incidents)
          .where(
            and(
              eq(incidents.status, "DETECTED"),
              inArray(incidents.branchId, branchIds)
            )
          )
          .orderBy(desc(incidents.severity))
          .limit(10);
      }
    } catch (e) {
      console.warn("Failed to fetch incident alerts", e);
    }

    let autoAlerts: any[] = [];
    try {
      autoAlerts = await db
        .select({
          id: complianceAlerts.id,
          title: complianceAlerts.title,
          severity: complianceAlerts.severity,
          status: complianceAlerts.status,
          branchId: complianceAlerts.branchId,
          createdAt: complianceAlerts.createdAt,
          workflowName: sql<string>`${complianceAlerts.complianceType}`,
          source: sql<string>`'auto'`,
        })
        .from(complianceAlerts)
        .where(
          and(
            eq(complianceAlerts.companyId, companyId),
            eq(complianceAlerts.status, "ACTIVE")
          )
        )
        .orderBy(desc(complianceAlerts.createdAt))
        .limit(10);
    } catch {
      // complianceAlerts table may not exist or be empty
    }

    // Merge both alert sources
    const alertsQuery = [...incidentAlerts, ...autoAlerts]
      .sort((a, b) => {
        const severityOrder = { CRITICAL: 0, FATAL: 0, HIGH: 1, WARNING: 2 } as Record<string, number>;
        return (severityOrder[a.severity || ""] || 2) - (severityOrder[b.severity || ""] || 2);
      })
      .slice(0, 15);

    // 5. Branch-level breakdown
    let branchBreakdownQuery: any[] = [];
    try {
      branchBreakdownQuery = await db
        .select({
          branchId: workflowInstances.branchId,
          branchName: branches.name,
          avgScore: sql<number>`AVG(${workflowInstances.score})`,
          totalCount: sql<number>`COUNT(*)`,
          criticalIssues: sql<number>`COUNT(*) FILTER (WHERE ${workflowInstances.score} < 70)`,
        })
        .from(workflowInstances)
        .innerJoin(
          workflowTemplates,
          eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
        )
        .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
        .where(
          and(
            eq(workflowTemplates.companyId, companyId),
            eq(workflowInstances.status, "COMPLETED"),
            gte(workflowInstances.completedAt, startDate),
            lte(workflowInstances.completedAt, endDate)
          )
        )
        .groupBy(workflowInstances.branchId, branches.name);
    } catch (e) {
      console.warn("Failed to fetch branch breakdown query", e);
    }

    // Format response
    const trends = trendsQuery.map((row) => ({
      date: row.date,
      complianceRate: Math.round(Number(row.avgScore) || 0),
      completedWorkflows: Number(row.completedCount),
    }));

    const scorecards =
      categoryQuery.length > 0
        ? categoryQuery.map((row) => ({
            category: row.category || "GENERAL",
            complianceType: row.complianceType,
            complianceRate: Math.round(Number(row.avgScore) || 0),
            totalWorkflows: Number(row.totalCount),
            criticalWorkflows: Number(row.criticalCount),
          }))
        : [
            {
              category: "NOM-251 Higiene",
              complianceType: "COFEPRIS",
              complianceRate: 100,
              totalWorkflows: 0,
              criticalWorkflows: 0,
            },
            {
              category: "NOM-035 Psicosocial",
              complianceType: "STPS",
              complianceRate: 100,
              totalWorkflows: 0,
              criticalWorkflows: 0,
            },
            {
              category: "IMSS & Laboral",
              complianceType: "IMSS",
              complianceRate: 100,
              totalWorkflows: 0,
              criticalWorkflows: 0,
            },
          ];

    const deadlines = deadlinesQuery.map((row) => ({
      id: row.id,
      name: row.name || "Sin nombre",
      branchName: row.branchName || "General",
      branchId: row.branchId,
      dueDate: row.nextExecutionAt,
      complianceType: row.frequency || null,
      isCritical: row.nextExecutionAt ? new Date(row.nextExecutionAt) < new Date() : false,
    }));

    const alerts = alertsQuery.map((row) => ({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      branchId: row.branchId,
      createdAt: row.createdAt,
      workflowName: row.workflowName,
    }));

    const branchBreakdown = branchBreakdownQuery.map((row) => ({
      branchId: row.branchId,
      branchName: row.branchName || "Sin sucursal",
      complianceRate: Math.round(Number(row.avgScore) || 0),
      totalWorkflows: Number(row.totalCount),
      criticalIssues: Number(row.criticalIssues),
    }));

    return NextResponse.json({
      trends,
      scorecards,
      deadlines,
      alerts,
      branchBreakdown,
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days,
      },
    });
  } catch (error) {
    console.error("Compliance Analytics Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
