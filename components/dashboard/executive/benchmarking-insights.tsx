/**
 * Benchmarking Insights — Executive Dashboard
 *
 * Displays best and worst branch cards with concrete, actionable factors.
 * If there aren't enough data (min 4 weeks), shows a "recolectando datos" message.
 *
 * Server Component.
 */

import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, AlertOctagon, TrendingUp, Clock } from "lucide-react";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function BenchmarkingInsights({
  companyId,
}: {
  companyId: string;
}) {
  const data = await CrossBranchService.getBenchmarking(companyId);

  if (!data) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            Benchmarking Interno
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Se necesitan al menos <strong>2 sucursales</strong> con datos para
            activar el benchmarking.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Check if we have enough data (heuristic: at least one metric with values > 0)
  const hasData = data.metrics.some(
    (m) => m.rankings.length >= 2 && m.rankings.some((r) => r.value > 0),
  );

  if (!hasData) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            Benchmarking Interno
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              ⏳ Recolectando datos...
            </p>
            <p className="text-xs text-muted-foreground">
              Se requiere un mínimo de <strong>4 semanas</strong> de actividad
              operativa para generar insights de benchmarking confiables.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { bestPractices, worstPractices } = data;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
          Benchmarking Interno
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Best practice card */}
        {bestPractices && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                {bestPractices.summary}
              </p>
            </div>
            <ul className="space-y-1">
              {bestPractices.factors.map((f, i) => (
                <li
                  key={i}
                  className="text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-1.5"
                >
                  <span className="mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Worst practice card */}
        {worstPractices && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertOctagon className="h-5 w-5 text-destructive" />
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                {worstPractices.summary}
              </p>
            </div>
            <ul className="space-y-1">
              {worstPractices.factors.map((f, i) => (
                <li
                  key={i}
                  className="text-xs text-red-700 dark:text-red-400 flex items-start gap-1.5"
                >
                  <span className="mt-0.5">•</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
