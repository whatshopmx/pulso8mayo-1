import { DashboardTabbedMetrics } from "@/components/dashboard/dashboard-tabbed-metrics"
import { CollapsibleAnnouncements } from "@/components/dashboard/collapsible-announcements"
import { DashboardCharts } from "@/components/dashboard/dashboard-charts"
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, users, employeeCommunications } from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { RecentWorkflowsTable } from "@/components/dashboard/recent-workflows-table";
import { ComplianceReportGenerator } from "@/components/compliance/report-generator";
import { AlertDistributionChart } from "@/components/dashboard/alert-distribution-chart";
import { getTranslations } from "next-intl/server";
import { ExecutiveSummary } from "@/components/dashboard/executive-summary"
import { PendingRemediationActionsCard } from "@/components/dashboard/pending-actions"
import { Suspense } from "react"
import { MetricCardSkeleton } from "@/components/ui/metric-card"
import {
  ChartSkeleton,
  DataTableSkeleton,
} from "@/components/shared"
import { PageContainer, PageHeader, SectionErrorBoundary } from "@/components/shared"
import { cookies } from "next/headers";
import { BRANCH_COOKIE_NAME } from "@/lib/tenant-context";

export default async function Page({ searchParams }: { searchParams: Promise<{ branch?: string; startDate?: string; endDate?: string }> }) {
  const params = await searchParams;
  // Branch scope flows from the header BranchScopeControl (cookie-backed, AD-1):
  // "pulso_selected_branch" is the single source of truth across home sections.
  // Legacy ?branch= URL links still honoured on a best-effort basis until they cycle out.
  const cookieBranch = (await cookies()).get(BRANCH_COOKIE_NAME)?.value;
  const selectedBranch = cookieBranch || params.branch;
  // Date range stays URL-encoded so shared links keep their window.
  const startDate = params.startDate;
  const endDate = params.endDate;

  const t = await getTranslations("dashboard.executive");
  const session = await auth.api.getSession({
    headers: await headers()
  });

  const workflowConditions = [eq(workflowTemplates.companyId, session?.user?.companyId ?? '')];
  if (selectedBranch && selectedBranch !== 'all') {
    workflowConditions.push(eq(workflowInstances.branchId, selectedBranch));
  }

  const recentWorkflows = session?.user?.companyId ? await db.select({
    id: workflowInstances.id,
    templateName: workflowTemplates.name,
    status: workflowInstances.status,
    score: workflowInstances.score,
    assigneeName: users.name,
    updatedAt: workflowInstances.updatedAt
  })
    .from(workflowInstances)
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
    .where(and(...workflowConditions))
    .orderBy(desc(workflowInstances.updatedAt))
    .limit(10) : [];

  const formattedWorkflows = recentWorkflows.map(workflow => ({
    ...workflow,
    templateName: workflow.templateName || t("noName"),
    assigneeName: workflow.assigneeName || t("unassigned")
  }));

  const pinnedAnnouncements = session?.user?.companyId ? await db.select({
    id: employeeCommunications.id,
    title: employeeCommunications.title,
    content: employeeCommunications.content,
    communicationType: employeeCommunications.communicationType,
    createdAt: employeeCommunications.createdAt,
  })
    .from(employeeCommunications)
    .where(and(
      eq(employeeCommunications.companyId, session.user.companyId),
      eq(employeeCommunications.isPinned, true)
    ))
    .orderBy(desc(employeeCommunications.createdAt))
    .limit(3) : [];

  return (
    <PageContainer>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={<ComplianceReportGenerator />}
      />

      {/* #1 — Attention queue: act first, then measure (AD-3). */}
      <PendingRemediationActionsCard />

      {/* #2 — Unified Tabbed KPI Control */}
      <Suspense fallback={<MetricCardSkeleton count={4} />}>
        <DashboardTabbedMetrics branchId={selectedBranch} startDate={startDate} endDate={endDate} />
      </Suspense>

      {/* #3 — Operational alerts & executive overview */}
      <Suspense fallback={<MetricCardSkeleton count={2} />}>
        <SectionErrorBoundary>
          <ExecutiveSummary branch={selectedBranch} startDate={startDate} endDate={endDate} />
        </SectionErrorBoundary>
      </Suspense>

      {/* #5 — Charts */}
      <Suspense fallback={<ChartSkeleton />}>
        <DashboardCharts branch={selectedBranch} startDate={startDate} endDate={endDate} />
      </Suspense>

      {/* #6 — Alert distribution */}
      <Suspense fallback={<ChartSkeleton />}>
        <AlertDistributionChart branch={selectedBranch} startDate={startDate} endDate={endDate} />
      </Suspense>

      {/* #7 — Recent activity */}
      <Suspense fallback={<DataTableSkeleton columns={5} rows={5} />}>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b bg-muted/30">
            <h3 className="text-lg font-bold">{t("recentActivity")}</h3>
          </div>
          <div className="p-0">
            <RecentWorkflowsTable workflows={formattedWorkflows} />
          </div>
        </div>
      </Suspense>

      {/* #8 — Pinned announcements: low-priority section (Q2). */}
      <CollapsibleAnnouncements
        announcements={pinnedAnnouncements}
        titleLabel={t("announcement")}
        announcementLabel={t("announcement")}
        notificationLabel={t("notification")}
        messageLabel={t("message")}
      />
    </PageContainer>
  )
}