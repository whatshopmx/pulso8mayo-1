"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, AlertOctagon, AlertTriangle, Layers, Eye } from "lucide-react";
import type { BranchComplianceMetrics } from "@/lib/services/cross-branch-service";

function barColor(score: number): string {
  if (score >= 90) return "bg-emerald-500";
  if (score >= 75) return "bg-amber-500";
  return "bg-destructive";
}

function badgeColor(score: number): string {
  if (score >= 90)
    return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400";
  if (score >= 75)
    return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400";
  return "bg-red-50 text-destructive dark:bg-red-950 dark:text-red-400";
}

export function BranchRankingClient({
  compliance,
}: {
  compliance: BranchComplianceMetrics[];
}) {
  const [showAll, setShowAll] = useState(false);

  if (compliance.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg">Ranking de Sucursales</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin datos de sucursales todavía.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sort by avgScore descending
  const sorted = [...compliance].sort((a, b) => b.avgScore - a.avgScore);
  const totalCount = sorted.length;
  const isLargeSet = totalCount > 5;

  // Determine displayed items
  let displayed = sorted;
  if (isLargeSet && !showAll) {
    const top3 = sorted.slice(0, 3);
    const bottom3 = sorted.slice(-3).filter((b) => !top3.some((t) => t.branchId === b.branchId));
    displayed = [...top3, ...bottom3];
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          Ranking de Sucursales
          <span className="text-xs font-normal text-muted-foreground">
            ({totalCount} sucursales)
          </span>
        </CardTitle>
        {isLargeSet && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1 bg-muted/50 hover:bg-muted px-2.5 py-1 rounded-md transition-colors"
          >
            {showAll ? (
              <>
                <Layers className="h-3.5 w-3.5" />
                Puntos Críticos (Top & Risk)
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" />
                Ver todas ({totalCount})
              </>
            )}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {displayed.map((b) => {
          const originalIndex = sorted.findIndex((item) => item.branchId === b.branchId);
          const isTop = originalIndex === 0;
          const isBottom = originalIndex === sorted.length - 1 && sorted.length > 1;

          return (
            <div key={b.branchId} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {isTop && <Trophy className="h-4 w-4 text-amber-500 shrink-0" />}
                  {isBottom && <AlertOctagon className="h-4 w-4 text-destructive shrink-0" />}
                  <Link
                    href={`/dashboard/branches?branchId=${b.branchId}`}
                    className="font-medium hover:underline text-foreground truncate max-w-[180px]"
                  >
                    {b.branchName}
                  </Link>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeColor(b.avgScore)}`}
                  >
                    {Math.round(b.avgScore)}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {b.completedWorkflows}/{b.totalWorkflows} completados
                  </span>
                </div>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor(b.avgScore)}`}
                  style={{ width: `${Math.min(b.avgScore, 100)}%` }}
                />
              </div>
              {b.overdueWorkflows > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {b.overdueWorkflows} tareas vencidas
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
