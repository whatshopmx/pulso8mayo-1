"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Legend,
} from "recharts";
import { ErrorState } from "@/components/shared/error-state";

interface StockByCategory {
  category: string | null;
  count: number;
}

interface RecentMovement {
  date: string;
  type: string;
  count: number;
}

interface DashboardChartsProps {
  stockByCategory?: StockByCategory[];
  recentMovements?: RecentMovement[];
  isError?: boolean;
  onRetry?: () => void;
}

export function DashboardCharts({ stockByCategory, recentMovements, isError, onRetry }: DashboardChartsProps) {
  // Category Donut Chart Data Mapping
  const categoryData = (stockByCategory || []).map((c) => ({
    name: c.category || "Sin categoría",
    value: c.count,
  }));

  // Movements Area Chart Data Mapping
  const movementsByDate: Record<string, Record<string, number>> = {};
  (recentMovements || []).forEach((m) => {
    const day = m.date?.slice(0, 10);
    if (!day) return;
    if (!movementsByDate[day]) movementsByDate[day] = {};
    movementsByDate[day][m.type] = (movementsByDate[day][m.type] || 0) + m.count;
  });

  const movementChartData = Object.entries(movementsByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, types]) => ({
      date: date.slice(5),
      ...types,
    }));

  const movementTypes = [...new Set((recentMovements || []).map((m) => m.type))];

  // Design-system chart tokens (track theme, consistent in dark mode)
  const COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  if (isError) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Distribución por Categorías</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center min-h-[300px]">
            <ErrorState
              message="No se pudieron cargar las categorías."
              onRetry={onRetry}
            />
          </CardContent>
        </Card>
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Movimientos Recientes (7 días)</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-[300px] flex items-center justify-center">
            <ErrorState
              message="No se pudieron cargar los movimientos."
              onRetry={onRetry}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* 1. Category Distribution: Donut Chart */}
      <Card className="flex flex-col justify-between">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Distribución por Categorías</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center min-h-[300px]">
          {categoryData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin datos de categorías</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    background: 'var(--popover)', 
                    borderColor: 'var(--border)', 
                    borderRadius: '6px',
                    fontSize: '12px'
                  }} 
                />
                <Legend 
                  layout="horizontal" 
                  align="center" 
                  verticalAlign="bottom" 
                  iconType="circle"
                  wrapperStyle={{ paddingTop: 10 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 2. Recent Movements: Gradient Area Chart */}
      <Card className="flex flex-col justify-between">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Movimientos Recientes (7 días)</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-[300px]">
          {movementChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin movimientos en este periodo</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={movementChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false} 
                  stroke="var(--muted-foreground)"
                />
                <YAxis 
                  tick={{ fontSize: 11 }} 
                  axisLine={false} 
                  tickLine={false}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip 
                  contentStyle={{ 
                    background: 'var(--popover)', 
                    borderColor: 'var(--border)', 
                    borderRadius: '6px',
                    fontSize: '12px'
                  }} 
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                {movementTypes.map((type, i) => (
                  <Area
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.15}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
