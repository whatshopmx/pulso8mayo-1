/**
 * KPI Hero Cards — Executive Dashboard
 *
 * Four large metric cards showing cross-branch aggregates with
 * delta vs previous period and sparkline indicators.
 *
 * Server Component: data fetched via CrossBranchService.
 */

import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { Card, CardContent } from "@/components/ui/card";
import {
  ShieldCheck,
  Trash2,
  AlertTriangle,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
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

function DeltaIcon({ delta, className }: { delta: number | null; className: string }) {
  if (delta === null) return <Minus className={className} />;
  if (delta > 0) return <TrendingUp className={className} />;
  if (delta < 0) return <TrendingDown className={className} />;
  return <Minus className={className} />;
}

function fmtPercent(n: number): string {
  return `${Math.round(n)}%`;
}

function fmtCents(n: number): string {
  return `$${(n / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

function fmtNumber(n: number): string {
  return n.toLocaleString("es-MX");
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
// Server component
// ---------------------------------------------------------------------------

export async function KpiHeroCards({ companyId }: { companyId: string }) {
  const [compliance, merma, incidentes, labor] = await Promise.all([
    CrossBranchService.getAllBranchesCompliance(companyId),
    CrossBranchService.getAllBranchesMerma(companyId),
    CrossBranchService.getAllBranchesIncidentesActivos(companyId),
    CrossBranchService.getAllBranchesLaborMetrics(companyId),
  ]);

  // Aggregate compliance
  const totalWorkflows = compliance.reduce((s, b) => s + b.totalWorkflows, 0);
  const completedWorkflows = compliance.reduce(
    (s, b) => s + b.completedWorkflows,
    0,
  );
  const avgScore =
    compliance.length > 0
      ? compliance.reduce((s, b) => s + b.avgScore, 0) / compliance.length
      : 0;
  const totalOverdue = compliance.reduce((s, b) => s + b.overdueWorkflows, 0);

  // Aggregate merma
  const totalMerma = merma.reduce((s, b) => s + b.totalLossCents, 0);
  const totalWasteCount = merma.reduce((s, b) => s + b.wasteCount, 0);

  // Aggregate incidents
  const totalIncidentes = incidentes.reduce(
    (s, b) => s + b.activeIncidents,
    0,
  );
  const criticalPlusFatal = incidentes.reduce(
    (s, b) => s + b.criticalCount + b.fatalCount,
    0,
  );

  // Aggregate labor
  const totalEmployees = labor.reduce((s, b) => s + b.activeEmployees, 0);
  const totalAusencias = labor.reduce((s, b) => s + b.absenceCount, 0);
  const avgLate =
    labor.length > 0
      ? labor.reduce((s, b) => s + b.avgLateMinutes, 0) / labor.length
      : 0;

  // Build cards
  const cards: KpiCardData[] = [
    {
      label: "Compliance Score",
      value: totalWorkflows > 0 ? fmtPercent(avgScore) : "—",
      secondary: `${completedWorkflows}/${totalWorkflows} workflows · ${totalOverdue} vencidos`,
      delta: null, // No previous period data yet
      deltaLabel: "vs período anterior",
      icon: ShieldCheck,
      color: avgScore >= 85 ? "green" : avgScore >= 70 ? "amber" : "red",
    },
    {
      label: "Merma Total",
      value: totalMerma > 0 ? fmtCents(totalMerma) : "$0",
      secondary: `${fmtNumber(totalWasteCount)} registros`,
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Trash2,
      color: totalMerma === 0 ? "green" : "amber",
    },
    {
      label: "Incidentes Activos",
      value: fmtNumber(totalIncidentes),
      secondary:
        criticalPlusFatal > 0
          ? `${criticalPlusFatal} críticos/fatales`
          : "Sin críticos",
      delta: null,
      deltaLabel: "vs período anterior",
      icon: AlertTriangle,
      color: criticalPlusFatal > 0 ? "red" : totalIncidentes > 0 ? "amber" : "green",
    },
    {
      label: "Personal Activo",
      value: fmtNumber(totalEmployees),
      secondary:
        totalAusencias > 0
          ? `${totalAusencias} ausencias · ${Math.round(avgLate)}min retraso prom.`
          : "Sin ausencias",
      delta: null,
      deltaLabel: "vs período anterior",
      icon: Users,
      color: "blue",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <HeroCard key={card.label} data={card} />
      ))}
    </div>
  );
}
