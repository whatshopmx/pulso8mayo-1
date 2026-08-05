"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Layers, Activity } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendDataPoint {
  week: string; // e.g. "Sem 1", "Sem 2", ...
  [branchName: string]: number | string | null; // dynamic per-branch scores
}

interface ComplianceTrendChartProps {
  data: TrendDataPoint[];
  branchNames: string[];
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const BRANCH_COLORS = [
  "#10b981", // emerald
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#14b8a6", // teal
  "#ef4444", // red
  "#6366f1", // indigo
];

function branchColor(idx: number): string {
  return BRANCH_COLORS[idx % BRANCH_COLORS.length];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComplianceTrendChart({
  data,
  branchNames,
}: ComplianceTrendChartProps) {
  const isLarge = branchNames.length > 5;
  const [viewMode, setViewMode] = useState<"branches" | "aggregate">(
    isLarge ? "aggregate" : "branches",
  );

  // Compute aggregate stats per week (promedio, min, max, range)
  const transformedData = useMemo(() => {
    return data.map((pt) => {
      const scores: number[] = [];
      for (const name of branchNames) {
        const val = pt[name];
        if (typeof val === "number") scores.push(val);
      }

      if (scores.length === 0) {
        return { ...pt, promedioGrupo: null, rangeGrupo: [0, 0], minGrupo: 0, maxGrupo: 0 };
      }

      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const sum = scores.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / scores.length);

      return {
        ...pt,
        promedioGrupo: avg,
        rangeGrupo: [min, max],
        minGrupo: min,
        maxGrupo: max,
      };
    });
  }, [data, branchNames]);

  if (data.length === 0 || branchNames.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg">Tendencia de Compliance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin datos suficientes para mostrar tendencias.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
          Tendencia de Compliance (4 semanas)
        </CardTitle>
        {branchNames.length > 3 && (
          <button
            onClick={() =>
              setViewMode(viewMode === "branches" ? "aggregate" : "branches")
            }
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1 bg-muted/50 hover:bg-muted px-2.5 py-1 rounded-md transition-colors"
          >
            {viewMode === "aggregate" ? (
              <>
                <Layers className="h-3.5 w-3.5" />
                Ver Sucursales ({branchNames.length})
              </>
            ) : (
              <>
                <Activity className="h-3.5 w-3.5" />
                Ver Promedio del Grupo
              </>
            )}
          </button>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={transformedData}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted/30"
              />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "0.75rem",
                  border: "1px solid hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))",
                }}
                labelStyle={{ fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />

              {viewMode === "aggregate" ? (
                <>
                  <Area
                    type="monotone"
                    dataKey="rangeGrupo"
                    name="Rango Min-Max del Grupo"
                    fill="#10b981"
                    stroke="none"
                    fillOpacity={0.15}
                  />
                  <Line
                    type="monotone"
                    dataKey="promedioGrupo"
                    name="Promedio del Grupo"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={{ r: 4, fill: "#10b981" }}
                    activeDot={{ r: 6 }}
                  />
                </>
              ) : (
                branchNames.map((name, idx) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={branchColor(idx)}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
