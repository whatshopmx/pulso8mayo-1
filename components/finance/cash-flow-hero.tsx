"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OpeningBalanceCard } from "@/components/finance/opening-balance-card";
import { formatCents } from "@/lib/utils";
import {
  Clock,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Coins,
  ShieldAlert,
} from "lucide-react";
import type { CashFlowProjection } from "@/components/finance/cash-flow-calendar";

interface CashFlowHeroProps {
  projection: CashFlowProjection;
  horizonDays: number;
  canEditAssumptions?: boolean;
  onAssumptionSaved?: () => void;
}

export function CashFlowHero({
  projection,
  horizonDays,
  canEditAssumptions = false,
  onAssumptionSaved,
}: CashFlowHeroProps) {
  // ── Cálculos de Liquidez ─────────────────────────────────────────
  const metrics = useMemo(() => {
    const days = projection.days || [];
    let minBalanceCents = projection.initialBalanceCents ?? 0;
    let minBalanceDate: string | null = null;
    let firstNegativeDay: string | null = null;
    let runwayDays = horizonDays;

    let totalInflowCents = 0;
    let totalOutflowCents = 0;

    days.forEach((day, index) => {
      if (day.projectedInflowCents !== null) {
        totalInflowCents += day.projectedInflowCents;
      }
      totalOutflowCents += day.projectedOutflowCents;

      if (day.cumulativeBalanceCents !== null) {
        if (day.cumulativeBalanceCents < minBalanceCents) {
          minBalanceCents = day.cumulativeBalanceCents;
          minBalanceDate = day.date;
        }

        if (day.cumulativeBalanceCents < 0 && firstNegativeDay === null) {
          firstNegativeDay = day.date;
          runwayDays = index + 1;
        }
      }
    });

    const netFlowCents = totalInflowCents - totalOutflowCents;

    // Clasificación de Riesgo según principios de DESIGN.md (Operational Red con moderación)
    let statusLevel: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    if (minBalanceCents < 0 || runwayDays < 14) {
      statusLevel = "CRITICAL";
    } else if (runwayDays < horizonDays || minBalanceCents < 50_000_00) {
      statusLevel = "WARNING";
    }

    return {
      minBalanceCents,
      minBalanceDate,
      firstNegativeDay,
      runwayDays,
      totalInflowCents,
      totalOutflowCents,
      netFlowCents,
      statusLevel,
    };
  }, [projection, horizonDays]);

  const initialBalance = projection.initialBalanceCents;
  const hasOpeningBalance = initialBalance !== null;

  return (
    <div className="space-y-4">
      {/* ── Banners / Termómetro Principal ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card Principal: Cobertura de Efectivo (Days of Runway) */}
        <Card className="lg:col-span-2 border-border bg-card/60 backdrop-blur-sm relative overflow-hidden">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="space-y-3 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-primary" /> Cobertura de Operación (Runway)
                </span>
                {metrics.statusLevel === "HEALTHY" && (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-medium">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Cobertura Estable
                  </Badge>
                )}
                {metrics.statusLevel === "WARNING" && (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-medium">
                    <AlertTriangle className="w-3 h-3 mr-1" /> Monitorear Compromisos
                  </Badge>
                )}
                {metrics.statusLevel === "CRITICAL" && (
                  <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/20 font-medium">
                    <ShieldAlert className="w-3 h-3 mr-1" /> Riesgo de Liquidez
                  </Badge>
                )}
              </div>

              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-extrabold tracking-tight text-foreground">
                  {metrics.runwayDays >= horizonDays ? `${horizonDays}+ Días` : `${metrics.runwayDays} Días`}
                </span>
                <span className="text-xs text-muted-foreground">
                  horizonte de {horizonDays} días
                </span>
              </div>

              <p className="text-xs text-muted-foreground max-w-[55ch] leading-relaxed">
                {!hasOpeningBalance ? (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    Captura el saldo inicial en caja/bancos para habilitar el termómetro de cobertura exacto.
                  </span>
                ) : metrics.firstNegativeDay ? (
                  <>
                    Se proyecta déficit de efectivo a partir del{" "}
                    <strong className="text-foreground">{metrics.firstNegativeDay}</strong>. Revisa los pagos programados para esa semana.
                  </>
                ) : (
                  <>
                    Tu flujo de caja sostiene la operación de los próximos {horizonDays} días con un saldo acumulado positivo.
                  </>
                )}
              </p>
            </div>

            {/* Sub-card: Saldo Mínimo Proyectado */}
            <div className="w-full sm:w-auto flex flex-col gap-2 p-4 rounded-xl border border-border bg-muted/30 shrink-0">
              <span className="text-xs text-muted-foreground font-medium">Saldo Mínimo Proyectado</span>
              <span
                className={`text-xl font-bold tabular-nums ${
                  metrics.minBalanceCents < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : metrics.minBalanceCents < 50_000_00
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-foreground"
                }`}
              >
                {formatCents(metrics.minBalanceCents)}
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                {metrics.minBalanceCents < 0 ? (
                  <>
                    <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
                    Punto crítico {metrics.minBalanceDate ? `el ${metrics.minBalanceDate}` : ""}
                  </>
                ) : (
                  <>
                    <Coins className="w-3 h-3 text-muted-foreground shrink-0" />
                    Piso proyectado en la ventana
                  </>
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card Resumen de Balances y Flujo Neto */}
        <Card className="border-border bg-card">
          <CardContent className="p-6 space-y-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Balance General a {horizonDays} Días
            </span>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingUp className="w-4 h-4 text-emerald-500" /> Ingresos Estimados
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatCents(metrics.totalInflowCents)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingDown className="w-4 h-4 text-rose-500" /> Egresos Proyectados
                </span>
                <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                  -{formatCents(metrics.totalOutflowCents)}
                </span>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between text-sm font-bold">
                <span>Flujo Neto</span>
                <span
                  className={`tabular-nums ${
                    metrics.netFlowCents < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {metrics.netFlowCents < 0 ? "" : "+"}
                  {formatCents(metrics.netFlowCents)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Captura / Verificación del Saldo Inicial ─────────────────── */}
      <OpeningBalanceCard
        initialBalanceCents={projection.initialBalanceCents}
        openingBalance={projection.openingBalance}
        scope={projection.scope}
        canEdit={canEditAssumptions}
        onSaved={onAssumptionSaved}
      />
    </div>
  );
}
