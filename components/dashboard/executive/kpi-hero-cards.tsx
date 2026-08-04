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
  color: "green" | "amber" | "red" | "blue";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deltaColor(delta: number | null): "emerald" | "red" | "muted" {
  if (delta === null) return "muted";
  if (delta > 0) return "emerald";
  return "red";
}

// DeltaIcon + deltaColor retained for the (optional) delta badge on cards.
// All Sprint 1 cards use delta: null, so the badge never renders; the helpers
// stay so future cards can opt into a delta without touching HeroCard.
function DeltaIcon({ className }: { delta: number | null; className: string }) {
  return <Activity className={className} />;
}

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

/** Risk score color (0-100, high = bad): green < 30, amber 30-60, red > 60. */
function riskColor(score: number): KpiCardData["color"] {
  if (score >= 60) return "red";
  if (score >= 30) return "amber";
  return "green";
}

/** Health score color (0-100, high = good). */
function healthColor(score: number): KpiCardData["color"] {
  if (score >= 85) return "green";
  if (score >= 70) return "amber";
  return "red";
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

function HeroCard({ data }: { data: KpiCardData }) {
  const Icon = data.icon;
  const dColor = deltaColor(data.delta);

  const bgMap: Record<string, string> = {
    green: "bg-emerald-50 dark:bg-emerald-950/30",
    amber: "bg-amber-50 dark:bg-amber-950/30",
    red: "bg-red-50 dark:bg-red-950/30",
    blue: "bg-blue-50 dark:bg-blue-950/30",
  };

  const iconColorMap: Record<string, string> = {
    green: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-destructive",
    blue: "text-blue-600 dark:text-blue-400",
  };

  return (
    <Card className="border-border hover:border-muted-foreground/20 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              {data.label}
            </p>
            <p className="text-3xl font-bold tracking-tight">{data.value}</p>
            <p className="text-xs text-muted-foreground">{data.secondary}</p>
          </div>
          <div className={`p-2.5 rounded-xl ${bgMap[data.color]}`}>
            <Icon className={`h-5 w-5 ${iconColorMap[data.color]}`} />
          </div>
        </div>

        {data.delta !== null && (
          <div className="mt-3 flex items-center gap-1 text-xs">
            <DeltaIcon delta={data.delta} className={`h-3.5 w-3.5 text-${dColor}-600 dark:text-${dColor}-400`} />
            <span
              className={`font-semibold text-${dColor}-600 dark:text-${dColor}-400`}
            >
              {data.delta > 0 ? "+" : ""}
              {data.delta}%
            </span>
            <span className="text-muted-foreground">{data.deltaLabel}</span>
          </div>
        )}
      </CardContent>
    </Card>
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
        <Activity className="h-5 w-5 animate-pulse" />
        <span>
          Construyendo el Executive Twin… las tarjetas se poblarán en el
          siguiente ciclo del cron (cada 15 min) o al forzar un refresh desde
          <span className="font-medium text-foreground"> POST /api/executive/twin/refresh</span>.
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
      label: "Group Health",
      value: fmtPercent(twin.healthScore),
      secondary: `${secondary.branchCount} sucursales · drift ${twin.driftScore}`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Activity,
      color: healthColor(twin.healthScore),
    },
    {
      label: "Cash Available",
      value: fmtMxnCompact(twin.projectedCashFlowCents),
      secondary: `${obligationsCount} obligaciones próximas · riesgo liq. ${twin.liquidityRisk}`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Wallet,
      color: riskColor(twin.liquidityRisk),
    },
    {
      label: "Op. Risk",
      value: `${twin.operationalRisk}`,
      secondary: `${secondary.activeIncidents} incidentes activos`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: AlertTriangle,
      color: riskColor(twin.operationalRisk),
    },
    {
      label: "Compliance",
      value: fmtPercent(100 - twin.complianceRisk),
      secondary: `${secondary.overdue} workflows vencidos`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: ShieldCheck,
      color: healthColor(100 - twin.complianceRisk),
    },
    {
      label: "Brand",
      value: fmtPercent(twin.brandConsistency),
      secondary: `${bestPractices} mejores prácticas documentadas`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Award,
      color: healthColor(twin.brandConsistency),
    },
    {
      label: "People Risk",
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <HeroCard key={card.label} data={card} />
      ))}
    </div>
  );
}
