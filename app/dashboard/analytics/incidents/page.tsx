"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import { IncidentKPICards } from "@/components/dashboard/incident-kpi-cards";
import { IncidentAnalyticsCharts } from "@/components/charts/incident-analytics-charts";
import { BarChart3 } from "lucide-react";

interface IncidentAnalyticsData {
  summary: {
    total: number;
    active: number;
    resolved: number;
    avgResolutionHours: number;
    totalDelta: number;
    activeDelta: number;
  };
  bySeverity: { severity: string; count: number }[];
  byBranch: { branchId: string; name: string; count: number; active: number }[];
  trends: { date: string; count: number }[];
  timeToResolution: { avg: number; min: number; max: number };
}

export default function IncidentAnalyticsPage() {
  const [data, setData] = React.useState<IncidentAnalyticsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [period, setPeriod] = React.useState("30d");
  const [branchId, setBranchId] = React.useState("all");
  const [branches, setBranches] = React.useState<{ id: string; name: string }[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches", { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          setBranches(json.branches || json || []);
        }
      } catch {
        // ignore
      }
    }
    fetchBranches();
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    async function fetchData() {
      const params = new URLSearchParams({ period });
      if (branchId !== "all") params.set("branchId", branchId);

      try {
        const res = await fetch(`/api/analytics/incidents?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Failed to load incident analytics:", err);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    return () => controller.abort();
  }, [period, branchId]);

  return (
    <PageContainer>
      <PageHeader
        title="Analytics de Incidentes"
        description="Métricas, tendencias y distribución de incidentes por período."
        icon={<BarChart3 className="h-5 w-5" />}
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
            <SelectItem value="90d">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>

        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sucursal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sucursales</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-6">
        <IncidentKPICards summary={data?.summary ?? null} loading={loading} />
        <IncidentAnalyticsCharts
          bySeverity={data?.bySeverity ?? []}
          trends={data?.trends ?? []}
          byBranch={data?.byBranch ?? []}
          loading={loading}
        />
      </div>
    </PageContainer>
  );
}
