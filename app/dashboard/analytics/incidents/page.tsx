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
import {
  ComplianceScoreCard,
  type ComplianceScoreData,
} from "@/components/dashboard/compliance-score-card";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
  const [compliance, setCompliance] = React.useState<ComplianceScoreData | null>(null);
  const [exportando, setExportando] = React.useState(false);

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
        // Las dos lecturas van juntas: el score y las graficas describen el
        // mismo periodo, y cargarlas por separado dejaba la tarjeta mostrando
        // el rango anterior mientras las barras ya habian cambiado.
        const [res, resCompliance] = await Promise.all([
          fetch(`/api/analytics/incidents?${params.toString()}`, {
            signal: controller.signal,
          }),
          fetch(`/api/analytics/incidents/compliance?${params.toString()}`, {
            signal: controller.signal,
          }),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
        setCompliance(resCompliance.ok ? await resCompliance.json() : null);
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

  /**
   * Descarga el CSV con los filtros activos.
   *
   * Se baja como blob y no como `<a href>` directo porque la respuesta puede
   * ser un 401/500 en JSON: con un enlace plano el navegador guardaria el
   * error como si fuera el reporte, y el usuario abriria un CSV con el texto
   * del error dentro.
   */
  const exportarCsv = async () => {
    setExportando(true);
    try {
      const params = new URLSearchParams();
      const dias = period === "7d" ? 7 : period === "90d" ? 90 : 30;
      params.set("start", new Date(Date.now() - dias * 86400000).toISOString());
      params.set("end", new Date().toISOString());
      if (branchId !== "all") params.set("branchId", branchId);

      const res = await fetch(`/api/reports/incidents?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `incidentes-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Reporte descargado");
    } catch {
      toast.error("No se pudo generar el reporte. Intenta de nuevo.");
    } finally {
      setExportando(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Analytics de Incidentes"
        description="Métricas, tendencias y distribución de incidentes por período."
        icon={BarChart3}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={exportarCsv}
            disabled={exportando || loading}
          >
            {exportando ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Exportar CSV
          </Button>
        }
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
        <ComplianceScoreCard data={compliance} loading={loading} />
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
