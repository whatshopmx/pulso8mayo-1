"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Medal, Award, ArrowUpRight, ShieldCheck, AlertCircle } from "lucide-react";
import type { BranchQSRScore } from "@/lib/services/cross-branch-service";

interface LegacyRankingItem {
  rank: number;
  branchId: string;
  branchName: string;
  performanceIndex: number;
}

interface Props {
  /** Lista completa de sucursales con métricas QSR calculadas (forma recomendada) */
  qsrBranches?: BranchQSRScore[];
  /** Ranking simple legado */
  ranking?: LegacyRankingItem[];
  /** Período seleccionado para conservar en drill-down */
  period?: string;
}

const rankIcons = [Trophy, Medal, Award];

export function BranchRankingTable({ qsrBranches, ranking, period }: Props) {
  // Si tenemos datos QSR completos, renderizamos la tabla analítica multi-sucursal
  if (qsrBranches && qsrBranches.length > 0) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">
                Consistencia Multi-Unidad & Prime Cost
              </CardTitle>
              <CardDescription className="text-xs">
                Métricas comparativas estandarizadas para las sucursales del grupo
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> &lt;60% Saludable
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> 60-65% Observación
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-destructive" /> &gt;65% Crítico
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[60px] text-center">Lugar</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Score QSR</TableHead>
                  <TableHead className="text-right">Venta Período</TableHead>
                  <TableHead className="text-right">Food Cost %</TableHead>
                  <TableHead className="text-right">Labor Cost %</TableHead>
                  <TableHead className="text-center">Prime Cost %</TableHead>
                  <TableHead className="text-right">NOM-251</TableHead>
                  <TableHead className="text-right">Cuadre Caja</TableHead>
                  <TableHead className="text-center">Datos</TableHead>
                  <TableHead className="w-[80px] text-right">Ficha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {qsrBranches.map((item) => {
                  const RankIcon = item.rank <= 3 ? rankIcons[item.rank - 1] : null;

                  const primeCostClass =
                    item.primeCostStatus === "HEALTHY"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                      : item.primeCostStatus === "WATCH"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                      : "bg-destructive/10 text-destructive border-destructive/20";

                  return (
                    <TableRow
                      key={item.branchId}
                      className="transition-colors hover:bg-muted/40 cursor-pointer"
                    >
                      {/* Rank */}
                      <TableCell className="text-center font-bold">
                        <div className="flex items-center justify-center">
                          {RankIcon ? (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                              <RankIcon className="h-4 w-4 text-primary" aria-hidden="true" />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">#{item.rank}</span>
                          )}
                        </div>
                      </TableCell>

                      {/* Branch Name */}
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/branches/${item.branchId}${period ? `?period=${period}` : ""}`}
                          className="hover:text-primary transition-colors flex items-center gap-1.5"
                        >
                          {item.branchName}
                          {item.rank === 1 && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1 border-primary/40 text-primary">
                              Líder
                            </Badge>
                          )}
                        </Link>
                      </TableCell>

                      {/* Score QSR */}
                      <TableCell className="text-right">
                        <span className="font-extrabold tabular-nums text-foreground">
                          {item.compositeScore.toFixed(1)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">/100</span>
                      </TableCell>

                      {/* Venta Período */}
                      <TableCell className="text-right tabular-nums font-medium">
                        {item.salesTotalCents > 0
                          ? `$${Math.round(item.salesTotalCents / 100).toLocaleString("es-MX")}`
                          : "Sin venta"}
                      </TableCell>

                      {/* Food Cost */}
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            item.foodCostPercent > 35
                              ? "text-destructive font-semibold"
                              : item.foodCostPercent <= 30
                              ? "text-emerald-600 dark:text-emerald-400 font-medium"
                              : "text-foreground"
                          }
                        >
                          {item.foodCostPercent.toFixed(1)}%
                        </span>
                      </TableCell>

                      {/* Labor Cost */}
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            item.laborCostPercent > 28
                              ? "text-destructive font-semibold"
                              : "text-foreground"
                          }
                        >
                          {item.laborCostPercent.toFixed(1)}%
                        </span>
                      </TableCell>

                      {/* Prime Cost */}
                      <TableCell className="text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border tabular-nums ${primeCostClass}`}
                        >
                          {item.primeCostPercent.toFixed(1)}%
                        </span>
                      </TableCell>

                      {/* NOM-251 */}
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            item.nom251ComplianceRate >= 95
                              ? "text-emerald-600 dark:text-emerald-400 font-medium"
                              : item.nom251ComplianceRate < 85
                              ? "text-destructive font-semibold"
                              : "text-amber-600 font-medium"
                          }
                        >
                          {item.nom251ComplianceRate.toFixed(0)}%
                        </span>
                      </TableCell>

                      {/* Cuadre Caja */}
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            item.cashReconciliationRate >= 95
                              ? "text-foreground font-medium"
                              : "text-destructive font-semibold"
                          }
                        >
                          {item.cashReconciliationRate.toFixed(0)}%
                        </span>
                      </TableCell>

                      {/* Data Quality */}
                      <TableCell className="text-center">
                        <Badge
                          variant={item.dataQuality === "VERIFIED" ? "secondary" : "outline"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {item.dataQuality === "VERIFIED" ? "Real" : "Estimado"}
                        </Badge>
                      </TableCell>

                      {/* Ficha Link */}
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild className="h-7 w-7 p-0">
                          <Link
                            href={`/dashboard/branches/${item.branchId}${period ? `?period=${period}` : ""}`}
                            aria-label={`Ver ficha de ${item.branchName}`}
                          >
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fallback simple legado
  const datos = ranking ?? [];
  if (datos.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="py-8 text-center text-muted-foreground">
            Sin datos para este período
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ranking de sucursales</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {datos.map((item) => {
            const RankIcon = item.rank <= 3 ? rankIcons[item.rank - 1] : null;
            return (
              <li
                key={item.branchId}
                className="flex items-center gap-4 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                  {RankIcon ? (
                    <RankIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground" aria-hidden="true">
                      #{item.rank}
                    </span>
                  )}
                  <span className="sr-only">Lugar {item.rank}</span>
                </div>
                <p className="flex-1 text-sm font-medium">{item.branchName}</p>
                <p className="text-right text-lg font-bold tabular-nums">
                  {item.performanceIndex.toFixed(1)}
                </p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
