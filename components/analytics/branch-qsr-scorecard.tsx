"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Trophy,
  Medal,
  Award,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Percent,
  DollarSign,
  ArrowRight,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type {
  BranchQSRScore,
  NetworkAnomalyFinding,
  BranchQSRRankingResult,
} from "@/lib/services/cross-branch-service";

interface BranchQSRScorecardProps {
  data: BranchQSRRankingResult;
  period?: string;
}

/**
 * Indicador semafórico de Prime Cost
 */
export function PrimeCostBadge({
  status,
  percent,
}: {
  status: BranchQSRScore["primeCostStatus"];
  percent: number;
}) {
  if (status === "HEALTHY") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
        {percent.toFixed(1)}% Saludable
      </span>
    );
  }
  if (status === "WATCH") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
        {percent.toFixed(1)}% Observación
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20">
      {percent.toFixed(1)}% Crítico
    </span>
  );
}

/**
 * Podio Top 3 de la Liga de Sucursales
 */
export function BranchPodium({
  top3,
  period,
}: {
  top3: BranchQSRScore[];
  period?: string;
}) {
  if (top3.length === 0) return null;

  // Orden para el podio: [2do, 1ero, 3ero] si hay 3 sucursales
  const first = top3[0];
  const second = top3[1];
  const third = top3[2];

  const orderedSlots = [
    second ? { item: second, rank: 2, medal: "🥈", title: "2° Lugar", height: "h-[220px]" } : null,
    first ? { item: first, rank: 1, medal: "🥇", title: "1° Lugar — Líder de Red", height: "h-[250px]" } : null,
    third ? { item: third, rank: 3, medal: "🥉", title: "3° Lugar", height: "h-[200px]" } : null,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Podio de Honor QSR</h2>
          <p className="text-xs text-muted-foreground">
            Top unidades del período por eficiencia integral de costos, inocuidad y ventas
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        {orderedSlots.map((slot) => {
          if (!slot) return null;
          const { item, rank, medal, title } = slot;
          const isFirst = rank === 1;

          return (
            <Card
              key={item.branchId}
              className={`relative overflow-hidden transition-all hover:border-primary/50 ${
                isFirst
                  ? "border-primary/40 bg-card shadow-sm order-first md:order-none ring-1 ring-primary/20"
                  : "bg-card/70"
              }`}
            >
              {isFirst && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-primary to-amber-500" />
              )}
              <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl" role="img" aria-label={title}>
                      {medal}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Rank #{rank}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold tracking-tight line-clamp-1">
                      {item.branchName}
                    </h3>
                    <p className="text-xs text-muted-foreground">{title}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Score Integral</span>
                    <span className="text-lg font-extrabold tabular-nums text-foreground">
                      {item.compositeScore.toFixed(1)}
                      <span className="text-[10px] font-normal text-muted-foreground">/100</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Prime Cost</span>
                    <PrimeCostBadge status={item.primeCostStatus} percent={item.primeCostPercent} />
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[11px]">Food / Labor</span>
                    <span className="font-medium tabular-nums">
                      {item.foodCostPercent.toFixed(0)}% / {item.laborCostPercent.toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">NOM-251 Frío</span>
                    <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      {item.nom251ComplianceRate.toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <Button variant="ghost" size="sm" asChild className="w-full justify-between h-8 text-xs">
                    <Link href={`/dashboard/branches/${item.branchId}${period ? `?period=${period}` : ""}`}>
                      Ver Ficha 360°
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Resumen de métricas de red QSR
 */
export function NetworkKpisSummary({ data }: { data: BranchQSRRankingResult }) {
  const healthyCount = data.branches.filter((b) => b.primeCostStatus === "HEALTHY").length;
  const totalCount = data.branches.length;
  const healthyRate = totalCount > 0 ? Math.round((healthyCount / totalCount) * 100) : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card className="bg-card/70 border-border/80">
        <CardContent className="p-4 space-y-1">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Percent className="h-3.5 w-3.5 text-primary" />
            Prime Cost Promedio
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">
              {data.networkAveragePrimeCost.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">Meta &lt;60%</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70 border-border/80">
        <CardContent className="p-4 space-y-1">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <TrendingDown className="h-3.5 w-3.5 text-blue-500" />
            Food Cost Promedio
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">
              {data.networkAverageFoodCost.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">Insumos y merma</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70 border-border/80">
        <CardContent className="p-4 space-y-1">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-purple-500" />
            Labor Cost Promedio
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">
              {data.networkAverageLaborCost.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">Nómina y turnos</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70 border-border/80">
        <CardContent className="p-4 space-y-1">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Salud de Red (&lt;60%)
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {healthyCount}/{totalCount}
            </span>
            <span className="text-xs text-muted-foreground">({healthyRate}%)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Panel de Hallazgos de Red / Executive Twin
 */
export function NetworkAnomaliesPanel({
  anomalies,
}: {
  anomalies: NetworkAnomalyFinding[];
}) {
  if (anomalies.length === 0) {
    return (
      <Card className="bg-card/50 border-border/70">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">Consistencia de red óptima</h4>
            <p className="text-xs text-muted-foreground">
              No se detectaron desviaciones significativas (&gt;3%) en costos ni fugas críticas de Prime Cost entre unidades hermanas.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-destructive/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-destructive/10 text-destructive">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Hallazgos de Inteligencia de Red (Executive Twin)</CardTitle>
              <CardDescription>
                Desviaciones de costos y varianzas no explicadas entre tiendas con el mismo menú
              </CardDescription>
            </div>
          </div>
          <Badge variant="destructive" className="font-semibold text-xs">
            {anomalies.length} {anomalies.length === 1 ? "alerta" : "alertas"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {anomalies.map((a) => {
          const isCritical = a.severity === "critical";
          return (
            <div
              key={a.id}
              className={`p-3.5 rounded-lg border text-sm space-y-2 ${
                isCritical
                  ? "bg-destructive/5 border-destructive/20"
                  : "bg-amber-500/5 border-amber-500/20"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    className={`h-4 w-4 shrink-0 ${
                      isCritical ? "text-destructive" : "text-amber-500"
                    }`}
                  />
                  <span className="font-semibold tracking-tight">{a.title}</span>
                </div>
                {a.estimatedImpactMxn > 0 && (
                  <span className="text-xs font-semibold tabular-nums text-destructive shrink-0 bg-background px-2 py-0.5 rounded border border-border">
                    ${a.estimatedImpactMxn.toLocaleString("es-MX")} MXN en riesgo
                  </span>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">{a.narrative}</p>

              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
                <span className="text-muted-foreground">
                  <strong className="text-foreground">Acción recomendada:</strong> {a.suggestedAction}
                </span>
                <Link
                  href={`/dashboard/branches/${a.affectedBranchId}`}
                  className="font-medium text-primary hover:underline flex items-center gap-1 shrink-0 ml-3"
                >
                  Auditar
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * Exportación consolidada
 */
export function BranchQSRScorecard({ data, period }: BranchQSRScorecardProps) {
  return (
    <div className="space-y-6">
      <NetworkKpisSummary data={data} />
      <BranchPodium top3={data.podiumTop3} period={period} />
      <NetworkAnomaliesPanel anomalies={data.anomalies} />
    </div>
  );
}
