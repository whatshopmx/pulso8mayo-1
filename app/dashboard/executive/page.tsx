/**
 * Executive Dashboard — Single Pane of Glass
 *
 * Route: /dashboard/executive
 * Audience: Owner / Director de Operaciones
 *
 * Full-span view of all branches with KPI cards, branch ranking,
 * alerts panel, and compliance trend chart.
 */

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  KpiCardsSkeleton,
  ChartSkeleton,
} from "@/components/shared";
import { MorningBrief } from "@/components/dashboard/morning-brief";
import { ExecutiveCopilot } from "@/components/dashboard/executive/executive-copilot";
import { KpiHeroCards } from "@/components/dashboard/executive/kpi-hero-cards";
import { BranchRanking } from "@/components/dashboard/executive/branch-ranking";
import { AlertsPanel } from "@/components/dashboard/executive/alerts-panel";
import { PredictionsPanel } from "@/components/dashboard/executive/predictions-panel";
import { BenchmarkingInsights } from "@/components/dashboard/executive/benchmarking-insights";
import {
  ComplianceTrendChart,
  type TrendDataPoint,
} from "@/components/dashboard/executive/compliance-trend-chart";
import { PnlBranchTable } from "@/components/finance/pnl-branch-table";
import { CashFlowProjection } from "@/components/dashboard/executive/cash-flow-projection";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";

// ---------------------------------------------------------------------------
// Trend chart wrapper: fetches data and transforms for client component
// ---------------------------------------------------------------------------

async function TrendChartWrapper({ companyId }: { companyId: string }) {
  const trend = await CrossBranchService.getComplianceTrend(companyId);

  if (trend.weeks.length === 0) {
    return (
      <ComplianceTrendChart data={[]} branchNames={[]} />
    );
  }

  // Transform { byBranch: { name: [scores...] } } → TrendDataPoint[]
  const branchNames = Object.keys(trend.byBranch);

  const data: TrendDataPoint[] = trend.weeks.map((week, weekIdx) => {
    const point: TrendDataPoint = { week };
    for (const name of branchNames) {
      point[name] = trend.byBranch[name]?.[weekIdx] ?? null;
    }
    return point;
  });

  return <ComplianceTrendChart data={data} branchNames={branchNames} />;
}

// ---------------------------------------------------------------------------
// Cash flow projection wrapper: fetches the Executive Twin and passes its
// cached 14-day projection to the client chart.
// ---------------------------------------------------------------------------

async function CashFlowProjectionWrapper({ companyId }: { companyId: string }) {
  const twin = await ExecutiveTwinEngine.getLatest(companyId);
  return <CashFlowProjection data={twin?.executiveState?.cashFlowProjection} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ExecutiveDashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/sign-in");
  if (!session.user.companyId) redirect("/onboarding");

  const companyId = session.user.companyId;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Dashboard Ejecutivo
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vista consolidada de todas las sucursales del grupo
        </p>
      </div>

      {/* Section 0: Morning Brief — la rutina diaria del dueño */}
      <Suspense fallback={<KpiCardsSkeleton />}>
        <MorningBrief companyId={companyId} />
      </Suspense>

      {/* Section 0.5: Copiloto ejecutivo — pregunta abierta sobre el twin */}
      <Suspense fallback={<KpiCardsSkeleton />}>
        <ExecutiveCopilot companyId={companyId} />
      </Suspense>

      {/* Section 1: KPI Hero Cards */}
      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiHeroCards companyId={companyId} />
      </Suspense>

      {/* Section 1.5: 14-day cash flow projection (Executive Twin) */}
      <Suspense fallback={<ChartSkeleton />}>
        <CashFlowProjectionWrapper companyId={companyId} />
      </Suspense>

      {/* Section 2: Branch Ranking + Alerts (side by side on desktop) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense
            fallback={
              <div className="h-64 rounded-xl bg-muted animate-pulse border border-border" />
            }
          >
            <BranchRanking companyId={companyId} />
          </Suspense>
        </div>
        <div className="lg:col-span-1">
          <Suspense
            fallback={
              <div className="h-64 rounded-xl bg-muted animate-pulse border border-border" />
            }
          >
            <AlertsPanel companyId={companyId} />
          </Suspense>
        </div>
      </div>

      {/* Section 2.5: Benchmarking Insights */}
      <Suspense
        fallback={
          <div className="h-48 rounded-xl bg-muted animate-pulse border border-border" />
        }
      >
        <BenchmarkingInsights companyId={companyId} />
      </Suspense>

      {/* Section 3: Predictions + Trend */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Suspense
            fallback={
              <div className="h-64 rounded-xl bg-muted animate-pulse border border-border" />
            }
          >
            <PredictionsPanel companyId={companyId} />
          </Suspense>
        </div>
        <div className="lg:col-span-2">
          <Suspense fallback={<ChartSkeleton />}>
            <TrendChartWrapper companyId={companyId} />
          </Suspense>
        </div>
      </div>

      {/* Section 4: P&L Operativo Estimado por Sucursal */}
      <div>
        <PnlBranchTable />
      </div>
    </div>
  );
}
