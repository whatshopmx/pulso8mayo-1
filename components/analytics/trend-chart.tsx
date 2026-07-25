"use client";

import * as React from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MetricType = "percentage" | "number" | "currency";
type ChartType = "line" | "area";

interface TrendDataPoint {
  date: string;
  value: number;
  raw?: Record<string, number>;
}

interface TrendChartProps {
  title?: string;
  data: TrendDataPoint[];
  comparisonData?: TrendDataPoint[];
  metricType?: MetricType;
  chartType?: ChartType;
  height?: number;
  loading?: boolean;
}

function formatValue(value: number, metricType: MetricType): string {
  switch (metricType) {
    case "percentage":
      return `${value.toFixed(1)}%`;
    case "currency":
      return `$${value.toLocaleString("es-MX")}`;
    default:
      return value.toLocaleString("es-MX");
  }
}

function CustomTooltip({
  active,
  payload,
  label,
  metricType,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  metricType: MetricType;
}) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background border rounded-lg p-3 shadow-lg">
        <p className="font-semibold mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium">
              {formatValue(entry.value, metricType)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function TrendChart({
  title,
  data,
  comparisonData,
  metricType = "number",
  chartType = "line",
  height = 300,
  loading = false,
}: TrendChartProps) {
  if (loading) {
    return (
      <Card>
        {title && (
          <CardHeader>
            <CardTitle className="text-base">{title}</CardTitle>
          </CardHeader>
        )}
        <CardContent>
          <div
            className="animate-pulse bg-muted rounded"
            style={{ height }}
          />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        {title && (
          <CardHeader>
            <CardTitle className="text-base">{title}</CardTitle>
          </CardHeader>
        )}
        <CardContent>
          <div
            className="flex items-center justify-center text-muted-foreground"
            style={{ height }}
          >
            Sin datos disponibles
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((d, i) => {
    const point: Record<string, any> = { date: d.date, actual: d.value };
    if (comparisonData?.[i]) {
      point.previous = comparisonData[i].value;
    }
    return point;
  });

  const commonProps = {
    data: chartData,
    margin: { top: 10, right: 30, left: 0, bottom: 0 },
  };

  const yAxisTickFormatter = (v: number) => {
    if (metricType === "percentage") return `${v}%`;
    if (metricType === "currency") return `$${(v / 1000).toFixed(0)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return v.toString();
  };

  const renderChart = () => {
    const baseComponents = (
      <>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis
          className="text-xs"
          tick={{ fontSize: 11 }}
          tickFormatter={yAxisTickFormatter}
        />
        <Tooltip content={<CustomTooltip metricType={metricType} />} />
        <Legend />
      </>
    );

    if (chartType === "area") {
      return (
        <AreaChart {...commonProps}>
          {baseComponents}
          <defs>
            <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8} />
              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
            </linearGradient>
            {comparisonData && (
              <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(var(--chart-2))"
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(var(--chart-2))"
                  stopOpacity={0}
                />
              </linearGradient>
            )}
          </defs>
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="hsl(var(--chart-1))"
            fillOpacity={1}
            fill="url(#colorActual)"
            strokeWidth={2}
          />
          {comparisonData && (
            <Area
              type="monotone"
              dataKey="previous"
              name="Período Anterior"
              stroke="hsl(var(--chart-2))"
              fillOpacity={1}
              fill="url(#colorPrevious)"
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          )}
        </AreaChart>
      );
    }

    return (
      <LineChart {...commonProps}>
        {baseComponents}
        <Line
          type="monotone"
          dataKey="actual"
          name="Actual"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
        {comparisonData && (
          <Line
            type="monotone"
            dataKey="previous"
            name="Período Anterior"
            stroke="hsl(var(--chart-2))"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
          />
        )}
      </LineChart>
    );
  };

  return (
    <Card>
      {title && (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          {renderChart()}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
