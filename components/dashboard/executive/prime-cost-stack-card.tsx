"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Flame, ArrowRight, Percent, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BranchQSRRankingResult } from "@/lib/services/cross-branch-service";

export function PrimeCostStackCard({ ranking }: { ranking: BranchQSRRankingResult }) {
  const { branches, networkAveragePrimeCost, networkAverageFoodCost, networkAverageLaborCost, anomalies } = ranking;

  // Sort branches by primeCostPercent ascending (best margin efficiency first)
  const sortedByPrime = [...branches].sort((a, b) => a.primeCostPercent - b.primeCostPercent);

  // Escala dinámica: la peor sucursal de la red define el ancho total, así una
  // desviación por encima del 80% de Prime Cost no se recorta ni desborda.
  const worstPrimeCost = branches.reduce(
    (max, branch) => Math.max(max, branch.primeCostPercent),
    0
  );
  const scaleMax = Math.max(80, Math.ceil(worstPrimeCost / 10) * 10);
  const widthPercent = (value: number) => Math.min(100, Math.max(0, (value / scaleMax) * 100));

  return (
    <div className="space-y-4">
      {/* Prime Cost Stack Visualizer Card */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Percent className="h-5 w-5 text-primary" />
                Anatomía de Costos: Prime Cost por Sucursal
              </CardTitle>
              <CardDescription>
                Regla de Oro Gastronómica: Costo de Alimentos % + Mano de Obra % ≤ 60.0%
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Promedio de Red:
              </span>
              <span
                className={cn(
                  "text-xs font-bold px-2 py-0.5 rounded",
                  networkAveragePrimeCost <= 60
                    ? "bg-success/10 text-success-text"
                    : "bg-destructive/10 text-destructive"
                )}
              >
                {networkAveragePrimeCost.toFixed(1)}% Prime Cost
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-5">
          {/* Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pb-2 border-b border-border/50">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-chart-4 inline-block" />
                <span>Alimentos (Food Cost %) · Prom: {networkAverageFoodCost.toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-chart-6 inline-block" />
                <span>Nómina (Labor Cost %) · Prom: {networkAverageLaborCost.toFixed(1)}%</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <span className="h-3 w-0.5 bg-destructive inline-block" />
                <span>Umbral Máximo Seguro: 60%</span>
              </div>
              <span className="tabular-nums">Escala del riel: 0–{scaleMax}%</span>
            </div>
          </div>

          {/* Branch Bars */}
          <div className="space-y-4">
            {sortedByPrime.map((branch, idx) => {
              const isBest = idx === 0 && branch.primeCostPercent <= 60;
              const isLeak = branch.primeCostPercent > 65;
              const isWarning = branch.primeCostPercent > 60 && branch.primeCostPercent <= 65;

              return (
                <div key={branch.branchId} className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                    <div className="flex items-center gap-2">
                      {isBest && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      {isLeak && <Flame className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      <Link
                        href={`/dashboard/branches/${branch.branchId}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {branch.branchName}
                      </Link>
                      {isBest && (
                        <span className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 bg-amber-500/10 text-amber-600 rounded">
                          Benchmark
                        </span>
                      )}
                      {isLeak && (
                        <span className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 bg-destructive/10 text-destructive rounded">
                          Fuga de Margen
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-xs">
                        Comida <strong className="text-foreground">{branch.foodCostPercent.toFixed(1)}%</strong> + Nómina <strong className="text-foreground">{branch.laborCostPercent.toFixed(1)}%</strong>
                      </span>
                      <span
                        className={cn(
                          "font-bold text-xs px-2 py-0.5 rounded",
                          branch.primeCostPercent <= 60
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : isWarning
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "bg-destructive/10 text-destructive"
                        )}
                      >
                        = {branch.primeCostPercent.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Horizontal Stack Bar — ancho relativo a la escala dinámica */}
                  <div
                    className="relative flex h-4 w-full overflow-hidden rounded bg-muted"
                    role="img"
                    aria-label={`${branch.branchName}: Prime Cost ${branch.primeCostPercent.toFixed(1)}% (Alimentos ${branch.foodCostPercent.toFixed(1)}% + Nómina ${branch.laborCostPercent.toFixed(1)}%)`}
                  >
                    {/* Food cost segment */}
                    <div
                      style={{ width: `${widthPercent(branch.foodCostPercent)}%` }}
                      className="h-full bg-chart-4 transition-all"
                    />
                    {/* Labor cost segment */}
                    <div
                      style={{ width: `${widthPercent(branch.laborCostPercent)}%` }}
                      className="h-full bg-chart-6 transition-all"
                    />

                    {/* 60% Reference Threshold Line */}
                    <div
                      style={{ left: `${widthPercent(60)}%` }}
                      className="absolute top-0 bottom-0 w-0.5 bg-destructive z-10"
                      title="Límite máximo recomendado: 60%"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Network Anomaly Findings (Why the margin is leaking) */}
      {anomalies.length > 0 && (
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Hallazgos de Inteligencia de Red (Causas de Varianza)
            </CardTitle>
            <CardDescription>
              Discrepancias detectadas automáticamente entre sucursales hermanas que operan el mismo menú
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0 divide-y divide-border">
            {anomalies.map((item) => (
              <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs font-bold uppercase px-2 py-0.5 rounded",
                      item.severity === "critical" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"
                    )}>
                      {item.type.replace(/_/g, " ")}
                    </span>
                    {item.estimatedImpactMxn && (
                      <span className="text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded border border-border">
                        Impacto: ${item.estimatedImpactMxn.toLocaleString("es-MX")} MXN
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-foreground">{item.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.narrative}</p>
                  <p className="text-xs font-medium text-foreground pt-0.5">
                    <strong className="text-primary">Acción de mitigación:</strong> {item.suggestedAction}
                  </p>
                </div>

                <div className="shrink-0">
                  <Button asChild size="sm" variant="outline" className="text-xs h-8">
                    <Link href={`/dashboard/branches/${item.affectedBranchId}`}>
                      Auditar Tienda
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
