"use client";

/**
 * Cash Flow Projection — Executive Dashboard mini-chart (Sprint 1 Task 10).
 *
 * 14-day projected cash flow bar chart. Data comes from the Executive Twin's
 * `executiveState.cashFlowProjection` (one `CashFlowDay` per day, populated by
 * `ExecutiveTwinEngine.recalculate` from `cash-flow-service`). Bars are green
 * when the projected cumulative balance is ≥ 0 and red when negative.
 *
 * Client component: Recharts needs a client surface. The server fetches the
 * twin and passes the series as props (no client-side fetch).
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import type { CashFlowDay } from "@/lib/services/intelligence/types";

interface CashFlowProjectionProps {
  data?: CashFlowDay[];
}

function fmtMxn(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1e8) return `$${(cents / 1e8).toFixed(2)}M`;
  if (abs >= 1e5) return `$${(cents / 1e5).toFixed(0)}K`;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

function dayLabel(dateStr: string, idx: number): string {
  // Prefer a short date (dd/mm); fall back to D1..D14.
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }
  return `D${idx + 1}`;
}

export function CashFlowProjection({ data }: CashFlowProjectionProps) {
  const series = (data ?? []).map((d, idx) => ({
    label: dayLabel(d.date, idx),
    projectedCents: d.projectedCents,
  }));

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          Proyección de Flujo (14 días)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {series.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Esperando datos del Executive Twin…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={series}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                tickFormatter={(v: number) => fmtMxn(Number(v))}
                width={64}
              />
              <Tooltip
                formatter={(v: number) => [fmtMxn(Number(v)), "Saldo proyectado"]}
                labelFormatter={(l) => `Día ${l}`}
                cursor={{ fillOpacity: 0.1 }}
              />
              <Bar dataKey="projectedCents" radius={[3, 3, 0, 0]}>
                {series.map((s, i) => (
                  <Cell
                    key={i}
                    fill={s.projectedCents >= 0 ? "#10b981" : "#ef4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}