"use client";

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
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

const statusColors = {
  NORMAL: 'text-emerald-600 dark:text-emerald-400',
  WARNING: 'text-amber-600 dark:text-amber-400',
  CRITICAL: 'text-destructive',
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
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="animate-pulse border border-border">
            <CardContent className="p-6">
              <div className="h-16 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (kpis.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => {
        const trend = kpi.previousValue === 0
          ? 0
          : ((kpi.currentValue - kpi.previousValue) / kpi.previousValue) * 100;
        const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
        const StatusIcon = statusIcons[kpi.status as keyof typeof statusIcons] || CheckCircle2;
        const statusColor = statusColors[kpi.status as keyof typeof statusColors] || 'text-muted-foreground';

        return (
          <Card key={kpi.id} className="border border-border hover:bg-muted/20 transition-colors">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {categoryLabels[kpi.category] || kpi.category}
                </p>
                <StatusIcon className={`h-4 w-4 ${statusColor}`} />
              </div>
              <p className="text-2xl font-bold">
                {kpi.currentValue.toFixed(1)}{kpi.unit}
              </p>
              <p className="text-sm text-muted-foreground mt-1 truncate">{kpi.name}</p>
              <div className="flex items-center gap-1 mt-2">
                <TrendIcon className={`h-3 w-3 ${trend >= 0 ? 'text-emerald-600' : 'text-destructive'}`} />
                <span className={`text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground ml-1">vs. período anterior</span>
              </div>
              {kpi.target && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Meta: {kpi.target}{kpi.unit}</span>
                    <span>{Math.min(100, Math.round((kpi.currentValue / kpi.target) * 100))}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${kpi.status === 'NORMAL' ? 'bg-emerald-500' : kpi.status === 'WARNING' ? 'bg-amber-500' : 'bg-destructive'}`}
                      style={{ width: `${Math.min(100, Math.round((kpi.currentValue / kpi.target) * 100))}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
