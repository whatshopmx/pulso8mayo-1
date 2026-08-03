/**
 * Branch Ranking — Executive Dashboard
 *
 * Vertical list of branches sorted by compliance score, with
 * color-coded progress bars (🟢 ≥90, 🟡 ≥75, 🔴 <75).
 *
 * Server Component.
 */

import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, AlertOctagon } from "lucide-react";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function BranchRanking({ companyId }: { companyId: string }) {
  const compliance = await CrossBranchService.getAllBranchesCompliance(
    companyId,
  );

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

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Ranking de Sucursales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sorted.map((b, i) => (
          <div key={b.branchId} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {i === 0 && (
                  <Trophy className="h-4 w-4 text-amber-500" />
                )}
                {i === sorted.length - 1 && sorted.length > 1 && (
                  <AlertOctagon className="h-4 w-4 text-destructive" />
                )}
                <span className="font-medium truncate max-w-[180px]">
                  {b.branchName}
                </span>
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
              <p className="text-xs text-muted-foreground">
                ⚠️ {b.overdueWorkflows} tareas vencidas
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
