"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Thermometer, AlertTriangle, CheckCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface TemperatureMonitorProps {
  period?: string;
  branchId?: string;
}

interface TemperatureStats {
  totalReadings: number;
  complianceRate: number;
  violationsToday: number;
}

interface TrendPoint {
  date: string;
  total: number;
  violations: number;
}

interface Violation {
  id: string;
  branchName: string;
  readingValue: number;
  unit: string;
  location: string;
  minThreshold: number;
  maxThreshold: number;
  timestamp: string;
}

interface TemperatureData {
  summary: TemperatureStats;
  trend: TrendPoint[];
  recentViolations: Violation[];
}

export function TemperatureMonitor({ period = "30d", branchId }: TemperatureMonitorProps) {
  const [data, setData] = useState<TemperatureData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ period });
    if (branchId && branchId !== "all") params.set("branchId", branchId);
    fetch(`/api/analytics/temperature-monitoring?${params}`)
      .then((res) => res.json())
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period, branchId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="h-[250px] bg-muted rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || !data.summary) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        Sin datos de temperatura
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-blue-50 text-blue-600">
                <Thermometer className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Lecturas</p>
                <p className="text-2xl font-bold">{data.summary.totalReadings.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-50 text-green-600">
                <CheckCircle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cumplimiento</p>
                <p className="text-2xl font-bold">{data.summary.complianceRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-red-50 text-orange-600">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Violaciones Hoy</p>
                <p className="text-2xl font-bold">{data.summary.violationsToday}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Tendencia de Temperatura</CardTitle>
        </CardHeader>
        <CardContent>
          {data.trend.length === 0 ? (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
              Sin datos de tendencia
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <YAxis
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Lecturas"
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="violations"
                  name="Violaciones"
                  stroke="#dc2626"
                  fill="#dc2626"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {data.recentViolations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Violaciones Recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2 pr-4 font-medium">Sucursal</th>
                    <th className="text-left py-2 pr-4 font-medium">Lectura</th>
                    <th className="text-left py-2 pr-4 font-medium">Ubicación</th>
                    <th className="text-left py-2 pr-4 font-medium">Límites</th>
                    <th className="text-left py-2 font-medium">Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentViolations.map((v) => (
                    <tr
                      key={v.id}
                      className="text-sm border-b last:border-0 border-l-2 border-l-orange-400"
                    >
                      <td className="py-2 pr-4">{v.branchName}</td>
                      <td className="py-2 pr-4 font-medium text-orange-600">
                        {v.readingValue}{v.unit}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{v.location}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {v.minThreshold} - {v.maxThreshold} °C
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(v.timestamp), { addSuffix: true, locale: es })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
