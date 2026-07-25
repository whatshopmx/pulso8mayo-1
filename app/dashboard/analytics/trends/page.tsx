"use client";

import * as React from "react";
import { PageHeader, PageContainer } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendChart } from "@/components/analytics/trend-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, Filter } from "lucide-react";

type Metric = "workflow_completion" | "inventory_consumption" | "labor_hours" | "costs" | "alert_frequency";
type Period = "7d" | "30d" | "90d" | "1y";

interface TrendPoint {
  date: string;
  value: number;
  raw?: Record<string, number>;
}

interface TrendResponse {
  metric: string;
  period: string;
  trend: TrendPoint[];
  comparison: {
    trend: TrendPoint[];
    change: number | null;
  } | null;
  summary: {
    total: number;
    avg: number;
    min: number;
    max: number;
  };
}

const METRICS: { value: Metric; label: string; chartType: "line" | "area"; metricType: "percentage" | "number" | "currency" }[] = [
  { value: "workflow_completion", label: "Finalización de Flujos", chartType: "line", metricType: "percentage" },
  { value: "inventory_consumption", label: "Consumo de Inventario", chartType: "area", metricType: "number" },
  { value: "labor_hours", label: "Horas Laborales", chartType: "area", metricType: "number" },
  { value: "costs", label: "Costos", chartType: "line", metricType: "currency" },
  { value: "alert_frequency", label: "Frecuencia de Alertas", chartType: "line", metricType: "number" },
];

export default function TrendAnalysisPage() {
  const [metric, setMetric] = React.useState<Metric>("workflow_completion");
  const [period, setPeriod] = React.useState<Period>("30d");
  const [branchId, setBranchId] = React.useState("all");
  const [compareWith, setCompareWith] = React.useState("none");
  const [data, setData] = React.useState<TrendResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [branches, setBranches] = React.useState<{ id: string; name: string }[]>([]);

  const currentMetric = METRICS.find((m) => m.value === metric)!;

  React.useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches");
        if (res.ok) {
          const d = await res.json();
          setBranches(d.branches || []);
        }
      } catch {}
    }
    fetchBranches();
  }, []);

  React.useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ metric, period });
    if (branchId !== "all") params.set("branchId", branchId);
    if (compareWith && compareWith !== "none") params.set("compareWith", compareWith);

    fetch(`/api/analytics/trends?${params}`)
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [metric, period, branchId, compareWith]);

  const metricConfig = METRICS.find((m) => m.value === metric);

  return (
    <PageContainer>
      <PageHeader
        title="Análisis de Tendencias"
        description="Visualiza y compara tendencias de métricas clave en el tiempo"
        icon={TrendingUp}
        actions={
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <CardTitle className="text-base">Filtros</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Métrica</label>
              <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Período</label>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">7 días</SelectItem>
                  <SelectItem value="30d">30 días</SelectItem>
                  <SelectItem value="90d">90 días</SelectItem>
                  <SelectItem value="1y">1 año</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Sucursal</label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Comparar con</label>
              <Select value={compareWith} onValueChange={setCompareWith}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin comparación" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin comparación</SelectItem>
                  <SelectItem value="previous_period">Período anterior</SelectItem>
                  <SelectItem value="same_period_last_year">Mismo período año anterior</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {data && !loading && metricConfig && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-normal">Total</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {metricConfig.metricType === "currency"
                    ? `$${data.summary.total.toLocaleString("es-MX")}`
                    : data.summary.total.toLocaleString("es-MX")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-normal">Promedio</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {metricConfig.metricType === "percentage"
                    ? `${data.summary.avg}%`
                    : metricConfig.metricType === "currency"
                      ? `$${data.summary.avg.toLocaleString("es-MX")}`
                      : data.summary.avg.toLocaleString("es-MX")}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-normal">Mínimo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.summary.min.toLocaleString("es-MX")}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-normal">Máximo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.summary.max.toLocaleString("es-MX")}</div>
              </CardContent>
            </Card>
          </div>

          {data.comparison && data.comparison.change !== null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-normal">
                  Cambio vs Período Anterior
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  {data.comparison.change > 0 ? (
                    <TrendingUp className="h-5 w-5 text-green-500" />
                  ) : data.comparison.change < 0 ? (
                    <TrendingDown className="h-5 w-5 text-red-500" />
                  ) : (
                    <Minus className="h-5 w-5 text-muted-foreground" />
                  )}
                  <span
                    className={`text-2xl font-bold ${
                      data.comparison.change > 0
                        ? "text-green-600"
                        : data.comparison.change < 0
                          ? "text-red-600"
                          : ""
                    }`}
                  >
                    {data.comparison.change > 0 ? "+" : ""}
                    {data.comparison.change}%
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <TrendChart
            title={metricConfig.label}
            data={data.trend}
            comparisonData={data.comparison?.trend || undefined}
            metricType={metricConfig.metricType}
            chartType={metricConfig.chartType}
            height={350}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    {data.comparison && <TableHead className="text-right">Período Anterior</TableHead>}
                    <TableHead className="text-right">Cambio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trend.map((point, i) => {
                    const prevValue = data.comparison?.trend[i]?.value;
                    const change =
                      prevValue && prevValue > 0
                        ? ((point.value - prevValue) / prevValue) * 100
                        : 0;
                    return (
                      <TableRow key={point.date}>
                        <TableCell>{point.date}</TableCell>
                        <TableCell className="text-right font-medium">
                          {metricConfig.metricType === "currency"
                            ? `$${point.value.toLocaleString("es-MX")}`
                            : metricConfig.metricType === "percentage"
                              ? `${point.value}%`
                              : point.value.toLocaleString("es-MX")}
                        </TableCell>
                        {data.comparison && (
                          <TableCell className="text-right text-muted-foreground">
                            {prevValue !== undefined
                              ? metricConfig.metricType === "currency"
                                ? `$${prevValue.toLocaleString("es-MX")}`
                                : metricConfig.metricType === "percentage"
                                  ? `${prevValue}%`
                                  : prevValue.toLocaleString("es-MX")
                              : "-"}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          {prevValue ? (
                            <span
                              className={
                                change > 0
                                  ? "text-green-600"
                                  : change < 0
                                    ? "text-red-600"
                                    : ""
                              }
                            >
                              {change > 0 ? "+" : ""}
                              {change.toFixed(1)}%
                            </span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {loading && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="h-16 animate-pulse bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="p-6">
              <div className="h-[350px] animate-pulse bg-muted rounded" />
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
