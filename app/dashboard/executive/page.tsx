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
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { MorningBriefService } from "@/lib/services/morning-brief-service";
import { ExecutiveDecisionService } from "@/lib/services/executive-decision-service";
import type { ExecutiveViewMode } from "@/components/dashboard/executive/executive-cockpit-header";
import { ExecutiveCockpitTabs } from "@/components/dashboard/executive/executive-cockpit-tabs";
import { ExecutiveDecisionDeck } from "@/components/dashboard/executive/executive-decision-deck";
import { ExecutiveCopilotCard } from "@/components/dashboard/executive/executive-copilot-card";
import { PrimeCostStackCard } from "@/components/dashboard/executive/prime-cost-stack-card";
import { PnlExecutiveWaterfall } from "@/components/dashboard/executive/pnl-executive-waterfall";
import { CashRunwayCard } from "@/components/dashboard/executive/cash-runway-card";
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

  // Fetch core executive models in parallel (incluye resoluciones ya despachadas)
  const [companyRow, twin, ranking, brief, resolvedDecisions] = await Promise.all([
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1),
    ExecutiveTwinEngine.getLatest(companyId),
    CrossBranchService.getBranchRanking(companyId, 30),
    MorningBriefService.getLatest(companyId),
    ExecutiveDecisionService.list(companyId),
  ]);

  const companyName = companyRow[0]?.name ?? "Grupo Restaurantero";

  // Compute Vital Signs Data
  const totalSalesCents = ranking.branches.reduce((acc, b) => acc + b.salesTotalCents, 0);
  const totalSalesMxn = totalSalesCents / 100;

  // Contador de pendientes = casos vivos menos los ya resueltos y persistidos.
  // Las claves replican la derivación de `ExecutiveDecisionDeck` (brief-<rank>-<title>
  // y el id de la anomalía) para que el badge del servidor y la cola coincidan.
  const decisionKeys = new Set<string>([
    ...(brief?.brief?.priorities ?? []).map((p) => `brief-${p.rank}-${p.title}`),
    ...(ranking.anomalies ?? []).map((a) => a.id),
  ]);
  const resolvedDecisionCount = Object.keys(resolvedDecisions).filter((key) =>
    decisionKeys.has(key)
  ).length;

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
    pendingDecisionsCount: Math.max(
      0,
      (brief?.brief?.priorities?.length ?? 0) + (ranking.anomalies?.length ?? 0) - resolvedDecisionCount
    ),
  };

  const cashFlowDays = (twin?.executiveState?.cashFlowProjection as CashFlowDay[]) ?? [];
  const obligations = (twin?.executiveState?.upcomingObligations as Obligation[]) ?? [];

  // Sucursal con la mayor fuga de Prime Cost: se destaca dentro de la cascada P&L.
  const leakBranch =
    [...ranking.branches].sort((a, b) => b.primeCostPercent - a.primeCostPercent)[0] ?? null;

  // Fecha de referencia del servidor: mantiene determinista la proyección
  // preliminar de tesorería entre SSR e hidratación.
  const asOf = new Date().toISOString().slice(0, 10);

  return (
    <ExecutiveCockpitTabs
      companyName={companyName}
      data={vitalSigns}
      initialView={currentView}
      cockpit={
        <div className="space-y-6">
          <ExecutiveDecisionDeck
            priorities={brief?.brief?.priorities}
            anomalies={ranking.anomalies}
            initialResolutions={resolvedDecisions}
          />
          <ExecutiveCopilotCard />
        </div>
      }
      economics={
        <div className="space-y-6">
          <PrimeCostStackCard ranking={ranking} />
          <PnlExecutiveWaterfall
            salesTotalCents={totalSalesCents}
            foodCostPercent={vitalSigns.foodCostPercent}
            laborCostPercent={vitalSigns.laborCostPercent}
            leakBranch={leakBranch}
          />
        </div>
      }
      liquidity={
        <CashRunwayCard
          projectionData={cashFlowDays}
          obligations={obligations}
          liquidityRisk={vitalSigns.liquidityRisk}
          asOf={asOf}
        />
      }
    />
  );
}
