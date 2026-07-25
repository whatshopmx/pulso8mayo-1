"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Legend,
} from "recharts";

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
}

export function DashboardCharts({ stockByCategory, recentMovements }: DashboardChartsProps) {
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

  // Curated Design System Color Palette (OKLCH mapping to HEX variables)
  const COLORS = [
    "oklch(0.52 0.17 25)",   // Chart 1: Brand Red/Crimson
    "oklch(0.62 0.16 70)",   // Chart 2: Orange/Warm
    "oklch(0.55 0.10 160)",  // Chart 3: Teal/Sage
    "oklch(0.52 0.08 240)",  // Chart 4: Soft Slate Blue
    "oklch(0.56 0.15 0)"     // Chart 5: Dark Rose
  ];

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
                <defs>
                  {movementTypes.map((type, i) => (
                    <linearGradient key={type} id={`color-${type}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0}/>
                    </linearGradient>
                  ))}
                </defs>
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
                    fillOpacity={1}
                    fill={`url(#color-${type})`}
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
