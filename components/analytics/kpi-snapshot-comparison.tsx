"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface SnapshotMetrics {
  [kpiId: string]: number;
}

interface Snapshot {
  id: string;
  companyId: string;
  branchId: string | null;
  snapshotType: string;
  snapshotDate: string;
  metrics: SnapshotMetrics;
  periodStart: string | null;
  periodEnd: string | null;
}

interface KpiMeta {
  id: string;
  name: string;
  metricType: string;
  unit: string | null;
}

interface KpiSnapshotComparisonProps {
  snaps: {
    current: Snapshot[];
    previous: Snapshot[];
  };
  kpis: KpiMeta[];
}

function formatValue(value: number, metricType: string): string {
  if (metricType === "PERCENTAGE") return `${value.toFixed(1)}%`;
  if (metricType === "TIME") return `${value.toFixed(1)} hrs`;
  if (metricType === "CURRENCY") return `$${value.toFixed(2)}`;
  return value.toFixed(2);
}

function getChangeIcon(change: number) {
  if (change > 0) return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (change < 0) return <TrendingDown className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export function KpiSnapshotComparison({ snaps, kpis }: KpiSnapshotComparisonProps) {
  const kpiMap = React.useMemo(() => {
    const map = new Map<string, KpiMeta>();
    for (const kpi of kpis) map.set(kpi.id, kpi);
    return map;
  }, [kpis]);

  const mergedMetrics = React.useMemo(() => {
    const allKpiIds = new Set<string>();

    const currentMetrics: SnapshotMetrics = {};
    for (const snap of snaps.current) {
      Object.assign(currentMetrics, snap.metrics);
      for (const kpiId of Object.keys(snap.metrics)) allKpiIds.add(kpiId);
    }

    const previousMetrics: SnapshotMetrics = {};
    for (const snap of snaps.previous) {
      Object.assign(previousMetrics, snap.metrics);
      for (const kpiId of Object.keys(snap.metrics)) allKpiIds.add(kpiId);
    }

    return { allKpiIds: Array.from(allKpiIds), currentMetrics, previousMetrics };
  }, [snaps]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparativa de KPIs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>KPI</TableHead>
              <TableHead className="text-right">Anterior</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Cambio</TableHead>
              <TableHead>Tendencia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mergedMetrics.allKpiIds.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No hay datos de snapshots disponibles
                </TableCell>
              </TableRow>
            )}
            {mergedMetrics.allKpiIds.map((kpiId) => {
              const kpi = kpiMap.get(kpiId);
              const current =
                mergedMetrics.currentMetrics[kpiId] ?? 0;
              const previous =
                mergedMetrics.previousMetrics[kpiId] ?? 0;
              const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
              const changeText =
                change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`;

              if (!kpi) {
                return (
                  <TableRow key={kpiId}>
                    <TableCell className="font-medium">{kpiId}</TableCell>
                    <TableCell className="text-right">{formatValue(previous, "COUNT")}</TableCell>
                    <TableCell className="text-right">{formatValue(current, "COUNT")}</TableCell>
                    <TableCell className="text-right">{changeText}</TableCell>
                    <TableCell>{getChangeIcon(change)}</TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow key={kpiId}>
                  <TableCell className="font-medium">{kpi.name}</TableCell>
                  <TableCell className="text-right">{formatValue(previous, kpi.metricType)}</TableCell>
                  <TableCell className="text-right">{formatValue(current, kpi.metricType)}</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={change > 0 ? "default" : change < 0 ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      {changeText}
                    </Badge>
                  </TableCell>
                  <TableCell>{getChangeIcon(change)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
