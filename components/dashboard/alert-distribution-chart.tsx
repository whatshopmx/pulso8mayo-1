"use client";

import {
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/shared";
import { useEffect, useState, useCallback } from "react";

interface AlertItem {
  name: string;
  value: number;
  color: string;
}

interface AlertDistributionChartProps {
  branch?: string;
  startDate?: string;
  endDate?: string;
}

export function AlertDistributionChart({ branch, startDate, endDate }: AlertDistributionChartProps) {
  const [data, setData] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async (signal: AbortSignal) => {
    const params = new URLSearchParams();
    if (branch && branch !== "all") params.set("branchId", branch);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    try {
      const res = await fetch(`/api/analytics/alert-distribution?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.alertDistribution || []);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(true);
    } finally {
      setLoading(false);
    }
  }, [branch, startDate, endDate]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  const retry = () => {
    setLoading(true);
    setError(false);
    fetchData(new AbortController().signal);
  };

  if (loading) {
    return (
      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Distribución de Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Cargando...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Distribución de Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            message="No se pudo cargar la distribución de alertas."
            onRetry={retry}
          />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="border border-border">
        <CardHeader>
          <CardTitle>Distribución de Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            No hay alertas activas
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-border">
      <CardHeader>
        <CardTitle>Distribución de Alertas</CardTitle>
      </CardHeader>
      <CardContent>
        <div role="img" aria-label="Gráfica de pastel: distribución de alertas por tipo">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value} alertas`,
                  name,
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
