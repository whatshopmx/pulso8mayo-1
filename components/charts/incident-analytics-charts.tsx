"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface SeverityItem {
  severity: string;
  count: number;
}

interface TrendItem {
  date: string;
  count: number;
}

interface BranchItem {
  branchId: string;
  name: string;
  count: number;
  active: number;
}

interface IncidentAnalyticsChartsProps {
  bySeverity: SeverityItem[];
  trends: TrendItem[];
  byBranch: BranchItem[];
  loading?: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#f97316",
  WARNING: "#eab308",
  FATAL: "#7f1d1d",
};

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Crítico",
  HIGH: "Alto",
  WARNING: "Advertencia",
  FATAL: "Fatal",
};

function SeverityChart({ data, loading }: { data: SeverityItem[]; loading?: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((d) => ({
    name: SEVERITY_LABELS[d.severity] || d.severity,
    total: d.count,
    fill: SEVERITY_COLORS[d.severity] || "#6b7280",
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Por Severidad</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
            Sin datos para este período
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip
                formatter={(value: number) => [`${value} incidentes`, "Total"]}
              />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TrendChart({ data, loading }: { data: TrendItem[]; loading?: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tendencia Diaria</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
            Sin datos para este período
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                className="text-xs"
                tickFormatter={(v) => {
                  const d = new Date(v);
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
              />
              <YAxis className="text-xs" />
              <Tooltip
                formatter={(value: number) => [`${value} incidentes`, "Total"]}
                labelFormatter={(label) => {
                  const d = new Date(label);
                  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="hsl(var(--chart-1))"
                strokeWidth={2}
                dot={{ fill: "hsl(var(--chart-1))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPieChart({ data, loading }: { data: { active: number; resolved: number }; loading?: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const pieData = [
    { name: "Activos", value: data.active, color: "#f97316" },
    { name: "Resueltos", value: data.resolved, color: "#22c55e" },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Por Estado</CardTitle>
      </CardHeader>
      <CardContent>
        {pieData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
            Sin datos para este período
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value} incidentes`,
                  name,
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function IncidentAnalyticsCharts({
  bySeverity,
  trends,
  byBranch,
  loading,
}: IncidentAnalyticsChartsProps) {
  const totals = byBranch.reduce(
    (acc, b) => ({ active: acc.active + b.active, resolved: acc.resolved + (b.count - b.active) }),
    { active: 0, resolved: 0 },
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SeverityChart data={bySeverity} loading={loading} />
      <StatusPieChart data={totals} loading={loading} />
      <div className="md:col-span-2">
        <TrendChart data={trends} loading={loading} />
      </div>
    </div>
  );
}
