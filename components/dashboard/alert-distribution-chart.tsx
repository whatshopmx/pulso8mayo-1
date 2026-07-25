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
import { useEffect, useState } from "react";

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

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (branch && branch !== "all") params.set("branchId", branch);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    fetch(`/api/analytics/alert-distribution?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setData(data.alertDistribution || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [branch, startDate, endDate]);

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
      </CardContent>
    </Card>
  );
}
