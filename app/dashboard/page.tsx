import { DashboardTabbedMetrics } from "@/components/dashboard/dashboard-tabbed-metrics"
import { PinnedAnnouncements } from "@/components/dashboard/pinned-announcements"
import { DashboardCharts } from "@/components/dashboard/dashboard-charts"
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { RecentActivity } from "@/components/dashboard/recent-activity"
import { ComplianceReportGenerator } from "@/components/compliance/report-generator";
import { getTranslations } from "next-intl/server";
import { ExecutiveSummary } from "@/components/dashboard/executive-summary"
import { GroupAreaOverview } from "@/components/dashboard/group-area-overview"
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
  const companyId = session?.user?.companyId ?? '';

  return (
    <PageContainer>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={<ComplianceReportGenerator />}
      />

      {/* #1 — El Consejo del Grupo: una tarjeta por área, con su cola de
          excepciones abiertas cross-sucursal. Act first, then measure (AD-3).
          Reemplaza el antiguo PendingRemediationActionsCard: esos mismos
          incidentes (AWAITING_EXTERNAL, etc.) ya aparecen aquí vía Operación
          /Equipos/Cumplimiento, con drill-down a su pantalla de resolución. */}
      <Suspense fallback={<MetricCardSkeleton count={6} />}>
        <SectionErrorBoundary>
          <GroupAreaOverview branch={selectedBranch} />
        </SectionErrorBoundary>
      </Suspense>

      {/* #2 — Unified Tabbed KPI Control */}
      <Suspense fallback={<MetricCardSkeleton count={4} />}>
        <SectionErrorBoundary>
          <DashboardTabbedMetrics branchId={selectedBranch} startDate={startDate} endDate={endDate} />
        </SectionErrorBoundary>
      </Suspense>

      {/* #3 — Executive cost trend: la única parte de ExecutiveSummary que no
          se absorbe en las tarjetas de área (el resto era top/bottom
          performer, que ahora vive en /dashboard/executive). */}
      <Suspense fallback={<MetricCardSkeleton count={2} />}>
        <SectionErrorBoundary>
          <ExecutiveSummary branch={selectedBranch} startDate={startDate} endDate={endDate} />
        </SectionErrorBoundary>
      </Suspense>

      {/* #4 — Operational Execution & Incident Distribution Charts */}
      <Suspense fallback={<ChartSkeleton />}>
        <SectionErrorBoundary>
          <DashboardCharts branch={selectedBranch} startDate={startDate} endDate={endDate} />
        </SectionErrorBoundary>
      </Suspense>

      {/* #7 — Recent activity: streams independently via its own server query. */}
      <Suspense fallback={<DataTableSkeleton columns={5} rows={5} />}>
        {companyId ? (
          <RecentActivity companyId={companyId} branchId={selectedBranch} />
        ) : (
          <DataTableSkeleton columns={5} rows={5} />
        )}
      </Suspense>

      {/* #8 — Pinned announcements: low-priority section (Q2); streams last. */}
      {companyId && (
        <Suspense fallback={null}>
          <PinnedAnnouncements companyId={companyId} />
        </Suspense>
      )}
    </PageContainer>
  )
}
