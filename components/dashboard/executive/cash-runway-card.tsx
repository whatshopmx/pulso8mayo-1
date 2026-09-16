"use client";

import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  Calendar,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Building,
  Users,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CashFlowDay, Obligation } from "@/lib/services/intelligence/types";

interface CashRunwayCardProps {
  projectionData?: CashFlowDay[];
  obligations?: Obligation[];
  liquidityRisk: number;
}

function fmtMxn(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1e8) return `$${(cents / 1e8).toFixed(2)}M`;
  if (abs >= 1e5) return `$${(cents / 1e5).toFixed(0)}K`;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

function dayLabel(dateStr: string, idx: number): string {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }
  return `D${idx + 1}`;
}

export function CashRunwayCard({
  projectionData = [],
  obligations = [],
  liquidityRisk,
}: CashRunwayCardProps) {
  // Format series for the bar chart
  const series = projectionData.map((d, idx) => ({
    label: dayLabel(d.date, idx),
    date: d.date,
    projectedCents: d.projectedCents,
  }));

  // Find lowest cash point
  const lowestPoint = series.length > 0
    ? [...series].sort((a, b) => a.projectedCents - b.projectedCents)[0]
    : null;

  const isLowCashRisk = liquidityRisk > 40;

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Oxígeno & Proyección de Flujo a 14 Días
              </CardTitle>
              <CardDescription>
                Entradas de ventas proyectadas vs obligaciones de nómina, IMSS, proveedores y rentas
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="text-xs h-8">
                <Link href="/dashboard/finance/treasury">
                  Ver Tesorería
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-6">
          {/* Top Status Callout */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Nivel de Riesgo de Liquidez
              </span>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xl font-bold",
                  isLowCashRisk ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                )}>
                  {liquidityRisk}/100
                </span>
                <Badge variant={isLowCashRisk ? "destructive" : "outline"} className="text-xs">
                  {isLowCashRisk ? "Riesgo Activo" : "Controlado"}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Basado en saldo inicial y compromisos
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Punto Más Bajo de Caja (Stress Test)
              </span>
              <div className="text-xl font-bold text-foreground">
                {lowestPoint ? fmtMxn(lowestPoint.projectedCents) : "—"}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {lowestPoint ? `Fecha estimada: ${lowestPoint.label}` : "Sin compromisos críticos"}
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Compromisos Inaplazables (14d)
              </span>
              <div className="text-xl font-bold text-foreground">
                {obligations.length} pagos próximos
              </div>
              <p className="text-[11px] text-muted-foreground">
                Nómina quincenal, IMSS y proveedores A
              </p>
            </div>
          </div>

          {/* 14-Day Projection Bar Chart */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Saldo Bancario Neto Proyectado Día a Día
            </h4>
            {series.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                Calculando proyección de tesorería del Executive Twin...
              </div>
            ) : (
              <div className="h-64 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      tickFormatter={(v: number) => fmtMxn(Number(v))}
                      width={65}
                    />
                    <Tooltip
                      formatter={(v: number) => [fmtMxn(Number(v)), "Saldo disponible"]}
                      labelFormatter={(l) => `Fecha: ${l}`}
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
              </div>
            )}
          </div>

          {/* Mexican Restaurant Critical Milestones */}
          <div className="space-y-3 pt-2 border-t border-border">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-primary" />
              Hitos Críticos del Calendario Restaurantero Mexicano
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {/* Milestone 1: Nómina */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    Día 15 / 30: Nómina
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 border-border">Quincenal</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Dispersión bancaria obligatoria para evitar fricción y rotación operativa en cocina y piso.
                </p>
              </div>

              {/* Milestone 2: IMSS Día 17 */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <Building className="h-3.5 w-3.5 text-amber-500" />
                    Día 17: Cuotas IMSS
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 border-amber-500/30 text-amber-600">Fiscal</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Límite de pago SIPARE / Infonavit para evitar congelamiento de cuentas y multas del SAT.
                </p>
              </div>

              {/* Milestone 3: Proveedores Clave */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <CreditCard className="h-3.5 w-3.5 text-indigo-500" />
                    Viernes: Abasto A
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 border-border">Semanal</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Corte de carnes y perecederos para garantizar abasto antes de los servicios del fin de semana.
                </p>
              </div>

              {/* Milestone 4: Rentas */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <Building className="h-3.5 w-3.5 text-emerald-500" />
                    Días 1-5: Rentas
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 border-border">Mensual</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Cumplimiento de arrendamiento en plazas y locales comerciales para mantener condiciones.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
