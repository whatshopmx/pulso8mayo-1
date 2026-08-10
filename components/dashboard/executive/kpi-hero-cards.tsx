/**
 * KPI Hero Cards — Executive Dashboard
 *
 * Four large metric cards showing cross-branch aggregates with
 * delta vs previous period and sparkline indicators.
 *
 * Server Component: data fetched via CrossBranchService.
 */

import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import type { ExecutiveTwin } from "@/lib/services/intelligence/types";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import {
  ShieldCheck,
  AlertTriangle,
  Users,
  Activity,
  Wallet,
  Award,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KpiCardData {
  label: string;
  value: string;
  secondary: string;
  delta: number | null; // percentage change; null = no previous data
  deltaLabel: string;
  icon: React.ElementType;
  color: "success" | "warning" | "destructive" | "info";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPercent(n: number): string {
  return `${Math.round(n)}%`;
}

/** Compact MXN for hero cards: $1.82M / $45.3K / $12,400. */
function fmtMxnCompact(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1e8) return `$${(cents / 1e8).toFixed(2)}M`;
  if (abs >= 1e5) return `$${(cents / 1e5).toFixed(1)}K`;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

/** Risk score color (0-100, high = bad): destructiv < 30 success, 30-60 warning, > 60 destructive. */
function riskColor(score: number): KpiCardData["color"] {
  if (score >= 60) return "destructive";
  if (score >= 30) return "warning";
  return "success";
}

/** Health score color (0-100, high = good). */
function healthColor(score: number): KpiCardData["color"] {
  if (score >= 85) return "success";
  if (score >= 70) return "warning";
  return "destructive";
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

function HeroCard({ data }: { data: KpiCardData }) {
  const Icon = data.icon;

  return (
    <MetricCard
      label={data.label}
      value={data.value}
      subtitle={data.secondary}
      icon={<Icon className="h-4 w-4" />}
      tone={data.color}
      delta={
        data.delta !== null
          ? { value: data.delta, isPositive: data.delta > 0, label: data.deltaLabel }
          : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Server component — pulls the 6 hero cards from the Executive Twin.
// Falls back to CrossBranchService aggregates for secondary detail and to a
// "waiting for data" card when the twin has not been computed yet (the
// recalculate-executive-twin Inngest cron populates it every 15 minutes).
// ---------------------------------------------------------------------------

function WaitingCard() {
  return (
    <Card className="border-dashed border-border col-span-full">
      <CardContent className="p-6 flex items-center gap-3 text-sm text-muted-foreground">
        <Activity className="h-5 w-5 animate-pulse text-muted-foreground" />
        <span>
          Calculando métricas del grupo... Las tarjetas se actualizarán automáticamente en el siguiente ciclo.
        </span>
      </CardContent>
    </Card>
  );
}

function twinOrFallbackCards(
  twin: ExecutiveTwin,
  secondary: {
    branchCount: number;
    overdue: number;
    activeIncidents: number;
    absences: number;
  },
): KpiCardData[] {
  const obligationsCount = twin.executiveState?.upcomingObligations?.length ?? 0;
  const bestPractices = twin.bestPracticesCount;

  return [
    {
      label: "Salud del Grupo",
      value: fmtPercent(twin.healthScore),
      secondary: `${secondary.branchCount} sucursales · desv. ${twin.driftScore}`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Activity,
      color: healthColor(twin.healthScore),
    },
    {
      label: "Flujo Disponible",
      value: fmtMxnCompact(twin.projectedCashFlowCents),
      secondary: `${obligationsCount} obligaciones próximas · riesgo liq. ${twin.liquidityRisk}`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Wallet,
      color: riskColor(twin.liquidityRisk),
    },
    {
      label: "Riesgo Operativo",
      value: `${twin.operationalRisk}`,
      secondary: `${secondary.activeIncidents} incidentes activos`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: AlertTriangle,
      color: riskColor(twin.operationalRisk),
    },
    {
      label: "Cumplimiento NOM",
      value: fmtPercent(100 - twin.complianceRisk),
      secondary: `${secondary.overdue} workflows vencidos`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: ShieldCheck,
      color: healthColor(100 - twin.complianceRisk),
    },
    {
      label: "Consistencia de Marca",
      value: fmtPercent(twin.brandConsistency),
      secondary: `${bestPractices} mejores prácticas documentadas`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Award,
      color: healthColor(twin.brandConsistency),
    },
    {
      label: "Riesgo de Personal",
      value: `${twin.peopleRisk}`,
      secondary: `${secondary.absences} ausencias en 30d`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Users,
      color: riskColor(twin.peopleRisk),
    },
  ];
}

export async function KpiHeroCards({ companyId }: { companyId: string }) {
  // The twin is the source of truth for the 6 hero values. CrossBranchService
  // is kept only for secondary detail (counts that add context to each card).
  const [twin, compliance, incidentes, labor] = await Promise.all([
    ExecutiveTwinEngine.getLatest(companyId),
    CrossBranchService.getAllBranchesCompliance(companyId),
    CrossBranchService.getAllBranchesIncidentesActivos(companyId),
    CrossBranchService.getAllBranchesLaborMetrics(companyId),
  ]);

  if (!twin) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <WaitingCard />
      </div>
    );
  }

  const cards = twinOrFallbackCards(twin, {
    branchCount: compliance.length,
    overdue: compliance.reduce((s, b) => s + b.overdueWorkflows, 0),
    activeIncidents: incidentes.reduce((s, b) => s + b.activeIncidents, 0),
    absences: labor.reduce((s, b) => s + b.absenceCount, 0),
  });

  return (
    <MetricGrid columns={3}>
      {cards.map((card) => (
        <HeroCard key={card.label} data={card} />
      ))}
    </MetricGrid>
  );
}
