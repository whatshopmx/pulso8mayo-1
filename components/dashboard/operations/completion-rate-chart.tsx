"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

interface CompletionDataPoint {
  date: string;
  rate: number;
}

export function CompletionRateChart() {
  const { theme } = useTheme();
  const [data, setData] = useState<CompletionDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports/stats')
      .then(res => res.json())
      .then(data => {
        setData(data.completionRate || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-[350px] text-muted-foreground">Cargando...</div>;
  }

  if (data.length === 0) {
    return <div className="flex items-center justify-center h-[350px] text-muted-foreground">Sin datos de completitud</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={data}>
        <XAxis
          dataKey="date"
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}%`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            color: "hsl(var(--popover-foreground))",
            fontSize: "12px",
          }}
          formatter={(value: number) => [`${value}%`, 'Tasa de Completitud']}
        />
        <Line
          type="monotone"
          dataKey="rate"
          stroke="#2563eb"
          activeDot={{ r: 8 }}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
