"use client";

import { MetricCard, MetricGrid, MetricCardSkeleton } from "@/components/ui/metric-card";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

interface KpiSummary {
  id: string;
  name: string;
  currentValue: number;
  previousValue: number;
  status: string;
  unit: string;
  target: number | null;
  category: string;
}

const categoryLabels: Record<string, string> = {
  OPERATIONS: 'Operaciones',
  COMPLIANCE: 'Cumplimiento',
  LABOR: 'RH',
  INVENTORY: 'Inventario',
};

const statusIcons = {
  NORMAL: CheckCircle2,
  WARNING: AlertTriangle,
  CRITICAL: XCircle,
};

// status → tone MetricCard: NORMAL = dentro de meta (success), WARNING/C
// semánticos como los statusBadgeClasses.
const statusTones = {
  NORMAL: 'success' as const,
  WARNING: 'warning' as const,
  CRITICAL: 'destructive' as const,
};

interface KpiSummaryCardsProps {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

export function KpiSummaryCards({ branchId, startDate, endDate }: KpiSummaryCardsProps) {
  const [kpis, setKpis] = useState<KpiSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ period: '7d' });
    if (branchId && branchId !== 'all') params.set('branchId', branchId);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    fetch(`/api/kpi/dashboard?${params}`)
      .then(res => res.json())
      .then(data => {
        setKpis((data.kpis || []).slice(0, 4));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [branchId, startDate, endDate]);

  if (loading) {
    return <MetricCardSkeleton count={4} />;
  }

  if (kpis.length === 0) return null;

  return (
    <MetricGrid>
      {kpis.map((kpi) => {
        const trend = kpi.previousValue === 0
          ? 0
          : ((kpi.currentValue - kpi.previousValue) / kpi.previousValue) * 100;
        const StatusIcon = statusIcons[kpi.status as keyof typeof statusIcons] || CheckCircle2;
        const tone = statusTones[kpi.status as keyof typeof statusTones] ?? 'success';

        return (
          <MetricCard
            key={kpi.id}
            label={categoryLabels[kpi.category] || kpi.category}
            value={`${kpi.currentValue.toFixed(1)}${kpi.unit}`}
            icon={<StatusIcon className="h-4 w-4" />}
            tone={tone}
            subtitle={kpi.name}
            delta={{
              value: Number(trend.toFixed(1)),
              isPositive: trend >= 0,
            }}
            progress={
              kpi.target
                ? {
                    value: kpi.currentValue,
                    max: kpi.target,
                    label: `Meta: ${kpi.target}${kpi.unit}`,
                  }
                : undefined
            }
          />
        );
      })}
    </MetricGrid>
  );
}