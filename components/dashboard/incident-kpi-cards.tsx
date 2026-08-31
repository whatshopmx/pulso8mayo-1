"use client";

import { AlertTriangle, Clock, CheckCircle2, Activity } from "lucide-react";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";

interface IncidentSummary {
  total: number;
  active: number;
  resolved: number;
  avgResolutionHours: number;
  totalDelta: number;
  activeDelta: number;
}

interface IncidentKPICardsProps {
  summary: IncidentSummary | null;
  loading?: boolean;
}

export function IncidentKPICards({ summary, loading }: IncidentKPICardsProps) {
  if (loading || !summary) {
    return (
      <MetricGrid>
        <MetricCard label="" value="" loading />
        <MetricCard label="" value="" loading />
        <MetricCard label="" value="" loading />
        <MetricCard label="" value="" loading />
      </MetricGrid>
    );
  }

  const resolvedPct =
    summary.total > 0
      ? Math.round((summary.resolved / summary.total) * 100)
      : 0;

  return (
    <MetricGrid>
      <MetricCard
        label="Total Incidentes"
        value={summary.total}
        icon={<AlertTriangle className="h-4 w-4" />}
        tone="warning"
        delta={{
          value: summary.totalDelta,
          isPositive: summary.totalDelta <= 0,
          label: "vs. período anterior",
        }}
      />
      <MetricCard
        label="Tiempo Prom. Resolución"
        value={`${summary.avgResolutionHours}h`}
        icon={<Clock className="h-4 w-4" />}
        tone="info"
        subtitle="Horas desde detección"
      />
      <MetricCard
        label="% Resueltos"
        value={`${resolvedPct}%`}
        icon={<CheckCircle2 className="h-4 w-4" />}
        tone={resolvedPct >= 80 ? "success" : resolvedPct >= 60 ? "warning" : "destructive"}
        progress={{ value: resolvedPct }}
        subtitle={`${summary.resolved} de ${summary.total}`}
      />
      <MetricCard
        label="Incidentes Activos"
        value={summary.active}
        icon={<Activity className="h-4 w-4" />}
        tone={summary.active === 0 ? "success" : summary.active < 3 ? "warning" : "destructive"}
        delta={{
          value: summary.activeDelta,
          isPositive: summary.activeDelta <= 0,
          label: "vs. período anterior",
        }}
      />
    </MetricGrid>
  );
}
