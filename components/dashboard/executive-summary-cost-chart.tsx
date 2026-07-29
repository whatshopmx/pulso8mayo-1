"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { ExecutiveSummaryCostTrends } from "@/lib/services/analytics-service";

interface ExecutiveSummaryCostChartProps {
  costTrends: ExecutiveSummaryCostTrends;
}

/**
 * Client-only cost-trends chart (recharts is client-only — refs/class
 * components). Renders server-fetched `costTrends` so the parent
 * `ExecutiveSummary` Server Component keeps the data fetching on the server
 * (AD-2 floor) without dragging recharts into a server context.
 */
export function ExecutiveSummaryCostChart({ costTrends }: ExecutiveSummaryCostChartProps) {
  const chartData = Object.entries(costTrends.currentPeriod.byCategory).map(
    ([category, current]) => ({
      category,
      actual: Number(current),
      anterior: Number(costTrends.previousPeriod.byCategory[category] || 0),
    }),
  );

  return (
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {costTrends.changePercent >= 0 ? (
              <TrendingUp className="h-4 w-4 text-destructive" />
            ) : (
              <TrendingDown className="h-4 w-4 text-emerald-500" />
            )}
            Tendencia de Costos
          </CardTitle>
          <Badge
            variant={costTrends.changePercent > 0 ? "destructive" : "secondary"}
            className="text-xs"
          >
            {costTrends.changePercent > 0 ? "+" : ""}
            {costTrends.changePercent.toFixed(1)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[180px] text-muted-foreground text-sm">
            Sin datos de costos
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="category"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="anterior" name="Período Anterior" fill="oklch(0.70 0.01 85)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Período Actual" fill="oklch(0.52 0.17 25)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <span className="text-sm text-muted-foreground">Total Actual</span>
              <span className="text-lg font-bold">
                ${costTrends.currentPeriod.total.toLocaleString()}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}