"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OpeningBalanceCard } from "@/components/finance/opening-balance-card";
import { formatCents } from "@/lib/utils";
import {
  CASH_FLOW_PROJECTION_DISCLAIMER,
  computeCashFlowHeroMetrics,
} from "@/lib/services/cash-flow-balance-rules";
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
  // ── Cálculos de Liquidez (FIN-01: sin saldo absoluto aparente sin ancla) ──
  const metrics = useMemo(
    () => computeCashFlowHeroMetrics(projection, horizonDays),
    [projection, horizonDays],
  );

  const hasOpeningBalance = projection.initialBalanceCents !== null;
  const projectionDisclaimer =
    projection.projectionMeta?.disclaimer ?? CASH_FLOW_PROJECTION_DISCLAIMER;

  return (
    <div className="space-y-4">
      {/* ── Banners / Termómetro Principal ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card Principal: Cobertura de Efectivo Estimada */}
        <Card className="lg:col-span-2 border-border bg-card relative overflow-hidden">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="space-y-3 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-primary" /> Caja Proyectada (Estimación)
                </span>
                <Badge variant="outline" className="text-[11px] font-medium">
                  Estimación operativa
                </Badge>
                {metrics.statusLevel === "UNANCHORED" && (
                  <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-medium">
                    <AlertCircle className="w-3 h-3 mr-1" /> Sin ancla bancaria
                  </Badge>
                )}
                {metrics.statusLevel === "HEALTHY" && (
                  <Badge variant="outline" className="bg-success/10 text-success-text border-success/20 font-medium">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Cobertura Estimada Estable
                  </Badge>
                )}
                {metrics.statusLevel === "WARNING" && (
                  <Badge variant="outline" className="bg-warning/10 text-warning-text border-warning/25 font-medium">
                    <AlertTriangle className="w-3 h-3 mr-1" /> Monitorear Compromisos
                  </Badge>
                )}
                {metrics.statusLevel === "CRITICAL" && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-medium">
                    <ShieldAlert className="w-3 h-3 mr-1" /> Riesgo de Liquidez Estimado
                  </Badge>
                )}
              </div>

              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-extrabold tracking-tight text-foreground">
                  {metrics.runwayDays === null
                    ? "Sin saldo base"
                    : metrics.runwayDays >= horizonDays
                      ? `${horizonDays}+ Días`
                      : `${metrics.runwayDays} Días`}
                </span>
                <span className="text-xs text-muted-foreground">
                  horizonte estimado de {horizonDays} días
                </span>
              </div>

              <p className="text-xs text-muted-foreground max-w-[60ch] leading-relaxed">
                {!hasOpeningBalance ? (
                  <span className="text-warning-text font-medium">
                    Sin ancla bancaria ni saldo base capturado no se calcula un saldo absoluto aparente.
                  </span>
                ) : !metrics.hasAbsoluteBalance ? (
                  <span className="text-warning-text font-medium">
                    Sin historial de ventas para estimar entradas futuras; no se calcula saldo proyectado.
                  </span>
                ) : metrics.firstNegativeDay ? (
                  <>
                    Se proyecta déficit estimado a partir del{" "}
                    <strong className="text-foreground">{metrics.firstNegativeDay}</strong>. Revisa los pagos programados para esa semana.
                  </>
                ) : (
                  <>
                    Proyección estimada positiva para los próximos {horizonDays} días.{" "}
                    {projectionDisclaimer}
                  </>
                )}
              </p>
            </div>

            {/* Sub-card: Saldo Mínimo Proyectado (Estimación) */}
            <div className="w-full sm:w-auto flex flex-col gap-2 p-4 rounded-xl border border-border bg-muted/30 shrink-0">
              <span className="text-xs text-muted-foreground font-medium">
                Saldo Mínimo Proyectado (Estimación)
              </span>
              <span
                className={`text-xl font-bold tabular-nums ${
                  metrics.minBalanceCents === null
                    ? "text-muted-foreground"
                    : metrics.minBalanceCents < 0
                      ? "text-destructive"
                      : metrics.minBalanceCents < 50_000_00
                        ? "text-warning-text"
                        : "text-foreground"
                }`}
              >
                {metrics.minBalanceCents === null ? "—" : formatCents(metrics.minBalanceCents)}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                {metrics.minBalanceCents === null ? (
                  <>
                    <AlertCircle className="w-3 h-3 text-muted-foreground shrink-0" />
                    Sin ancla no se calcula saldo aparente
                  </>
                ) : metrics.minBalanceCents < 0 ? (
                  <>
                    <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
                    Punto crítico estimado {metrics.minBalanceDate ? `el ${metrics.minBalanceDate}` : ""}
                  </>
                ) : (
                  <>
                    <Coins className="w-3 h-3 text-muted-foreground shrink-0" />
                    Piso proyectado (estimación)
                  </>
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card Resumen de Flujo Proyectado (Estimación) */}
        <Card className="border-border bg-card">
          <CardContent className="p-6 space-y-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Flujo Proyectado a {horizonDays} Días (Estimación)
            </span>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingUp className="w-4 h-4 text-success" /> Entradas Estimadas
                </span>
                <span className="font-semibold text-success-text tabular-nums">
                  {metrics.totalInflowCents === null ? "Sin estimar" : formatCents(metrics.totalInflowCents)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingDown className="w-4 h-4 text-destructive" /> Egresos Proyectados
                </span>
                <span className="font-semibold text-destructive tabular-nums">
                  -{formatCents(metrics.totalOutflowCents)}
                </span>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between text-sm font-bold">
                <span>Flujo Neto Estimado</span>
                <span
                  className={`tabular-nums ${
                    metrics.netFlowCents === null
                      ? "text-muted-foreground"
                      : metrics.netFlowCents < 0
                        ? "text-destructive"
                        : "text-success-text"
                  }`}
                >
                  {metrics.netFlowCents === null
                    ? "—"
                    : `${metrics.netFlowCents < 0 ? "" : "+"}${formatCents(metrics.netFlowCents)}`}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Saldo Conciliado / Ancla Bancaria ────────────────────────── */}
      <OpeningBalanceCard
        balanceCents={projection.initialBalanceCents}
        openingBalance={projection.openingBalance}
        branchId={projection.scope?.branchId ?? null}
        branchName={projection.scope?.branchName ?? null}
        canEdit={canEditAssumptions}
        onSaved={onAssumptionSaved ?? (() => {})}
      />
    </div>
  );
}
