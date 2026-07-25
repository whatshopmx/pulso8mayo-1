"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
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
  const categoryData = (stockByCategory || []).map((c) => ({
    name: c.category || "Sin categoría",
    productos: c.count,
  }));

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

  const COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)"
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stock por Categoría</CardTitle>
        </CardHeader>
        <CardContent>
          {categoryData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin datos</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="productos" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Movimientos Recientes (7 días)</CardTitle>
        </CardHeader>
        <CardContent>
          {movementChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin movimientos</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={movementChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip />
                <Legend />
                {movementTypes.map((type, i) => (
                  <Line
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
