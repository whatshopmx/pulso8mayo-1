/**
 * Executive Dashboard — Cockpit de Dirección & Unit Economics
 *
 * Route: /dashboard/executive
 * Audience: Dueño / Director General / Socio Operador (3 a 15 sucursales)
 *
 * Organizado en 3 modos de decisión vía ?view=cockpit|economics|liquidity:
 *  1. Despacho & Decisiones (La Rutina de 60 Segundos)
 *  2. Unit Economics & Prime Cost (Rentabilidad & Fugas de Margen)
 *  3. Oxígeno & Flujo 14D (Capital, Nómina e Hitos Críticos)
 */

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { MorningBriefService } from "@/lib/services/morning-brief-service";
import {
  ExecutiveCockpitHeader,
  type ExecutiveViewMode,
} from "@/components/dashboard/executive/executive-cockpit-header";
import { ExecutiveDecisionDeck } from "@/components/dashboard/executive/executive-decision-deck";
import { ExecutiveCopilotCard } from "@/components/dashboard/executive/executive-copilot-card";
import { PrimeCostStackCard } from "@/components/dashboard/executive/prime-cost-stack-card";
import { PnlExecutiveWaterfall } from "@/components/dashboard/executive/pnl-executive-waterfall";
import { CashRunwayCard } from "@/components/dashboard/executive/cash-runway-card";
import { ExecutiveCockpitSkeleton } from "@/components/dashboard/executive/executive-cockpit-skeleton";
import type { CashFlowDay, Obligation } from "@/lib/services/intelligence/types";

interface PageProps {
  searchParams?: Promise<{ view?: string }>;
}

export default async function ExecutiveDashboardPage(props: PageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/sign-in");
  if (!session.user.companyId) redirect("/onboarding");

  const companyId = session.user.companyId;

  // Resolve searchParams safely in Next.js 15+
  const resolvedParams = props.searchParams ? await props.searchParams : {};
  const rawView = resolvedParams?.view;
  const currentView: ExecutiveViewMode =
    rawView === "economics" || rawView === "liquidity" ? rawView : "cockpit";

  // Fetch core executive models in parallel
  const [companyRow, twin, ranking, brief] = await Promise.all([
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1),
    ExecutiveTwinEngine.getLatest(companyId),
    CrossBranchService.getBranchRanking(companyId, 30),
    MorningBriefService.getLatest(companyId),
  ]);

  const companyName = companyRow[0]?.name ?? "Grupo Restaurantero";

  // Compute Vital Signs Data
  const totalSalesCents = ranking.branches.reduce((acc, b) => acc + b.salesTotalCents, 0);
  const totalSalesMxn = totalSalesCents / 100;

  const vitalSigns = {
    healthScore: twin?.healthScore ?? 88,
    driftScore: twin?.driftScore ?? 12,
    salesMonthMxn: totalSalesMxn > 0 ? totalSalesMxn : 4820000,
    salesTargetPercent: 96,
    primeCostPercent: ranking.networkAveragePrimeCost > 0 ? ranking.networkAveragePrimeCost : 57.8,
    foodCostPercent: ranking.networkAverageFoodCost > 0 ? ranking.networkAverageFoodCost : 29.4,
    laborCostPercent: ranking.networkAverageLaborCost > 0 ? ranking.networkAverageLaborCost : 28.4,
    freeCash14dCents: twin?.projectedCashFlowCents ?? 64800000,
    liquidityRisk: twin?.liquidityRisk ?? 22,
    pendingDecisionsCount: (brief?.brief?.priorities?.length ?? 0) + (ranking.anomalies?.length ?? 0),
  };

  const cashFlowDays = (twin?.executiveState?.cashFlowProjection as CashFlowDay[]) ?? [];
  const obligations = (twin?.executiveState?.upcomingObligations as Obligation[]) ?? [];

  return (
    <div className="space-y-6">
      {/* Header & Vital Signs Bar */}
      <Suspense fallback={<ExecutiveCockpitSkeleton />}>
        <ExecutiveCockpitHeader
          companyName={companyName}
          data={vitalSigns}
          activeView={currentView}
        />
      </Suspense>

      {/* View 1: Despacho & Decisiones */}
      {currentView === "cockpit" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <ExecutiveDecisionDeck
            priorities={brief?.brief?.priorities}
            anomalies={ranking.anomalies}
            companyId={companyId}
          />
          <ExecutiveCopilotCard companyId={companyId} />
        </div>
      )}

      {/* View 2: Unit Economics & Prime Cost */}
      {currentView === "economics" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <PrimeCostStackCard ranking={ranking} />
          <PnlExecutiveWaterfall
            salesTotalCents={totalSalesCents}
            foodCostPercent={vitalSigns.foodCostPercent}
            laborCostPercent={vitalSigns.laborCostPercent}
          />
        </div>
      )}

      {/* View 3: Oxígeno & Flujo 14D */}
      {currentView === "liquidity" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <CashRunwayCard
            projectionData={cashFlowDays}
            obligations={obligations}
            liquidityRisk={vitalSigns.liquidityRisk}
          />
        </div>
      )}
    </div>
  );
}
