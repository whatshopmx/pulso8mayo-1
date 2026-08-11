import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getExecutiveSummary } from "@/lib/services/analytics-service";
import type { Role } from "@/lib/permissions";
import { ExecutiveSummaryCostChart } from "./executive-summary-cost-chart";

interface ExecutiveSummaryProps {
  /** Active branch scope (cookie-derived by the home page; null/"all" ⇒ chain rollup). */
  branch?: string | null;
  /** Kept for prop parity with sibling sections; the summary is period-based historically. */
  startDate?: string;
  endDate?: string;
}

/**
 * Executive summary — Server Component under the AD-2 floor (Server Component
 * + Suspense). Loads via `getExecutiveSummary` (lib/services/, shared with the
 * `/api/analytics/executive-summary` route), inheriting auth/tenant from the
 * session. The home page wraps this in `<Suspense>` + `<SectionErrorBoundary>`;
 * on a hard top-level failure this async component throws so the boundary can
 * render `ErrorState` with retry (never a silent null gap — H9/H1).
 *
 * The recharts cost-trend card lives in the client child
 * `ExecutiveSummaryCostChart` because recharts is client-only (refs/class
 * components); the parent server component passes server-fetched props.
 */
export async function ExecutiveSummary({ branch }: ExecutiveSummaryProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  const companyId = session?.user?.companyId;
  const userRole = (session?.user as { role?: Role })?.role;
  const userBranchId = (session?.user as { branchId?: string })?.branchId;
  const requestedBranchId = branch && branch !== "all" ? branch : null;

  if (!companyId || !userRole) {
    // No authenticated tenant context; nothing to summarise. Render nothing
    // rather than attempt a query that would 401 (the boundary needn't fire).
    return null;
  }

  const data = await getExecutiveSummary({
    companyId,
    userRole,
    userBranchId,
    requestedBranchId,
  });

  if (!data || !data.alertSummary) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Rendimiento de Sucursales
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                {data.branchOverview.totalBranches} sucursales
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Rendimiento Promedio</span>
                <span className="text-2xl font-bold">{data.branchOverview.avgPerformanceIndex.toFixed(1)}</span>
              </div>

              {data.branchOverview.topPerformer && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Mejor Sucursal</p>
                      <p className="text-sm font-medium">{data.branchOverview.topPerformer.branchName}</p>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {data.branchOverview.topPerformer.performanceIndex.toFixed(1)}
                  </span>
                </div>
              )}

              {data.branchOverview.bottomPerformer && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="flex items-center gap-2">
                    <ArrowDownRight className="h-4 w-4 text-destructive" />
                    <div>
                      <p className="text-xs text-destructive font-medium">Requiere Atención</p>
                      <p className="text-sm font-medium">{data.branchOverview.bottomPerformer.branchName}</p>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-destructive">
                    {data.branchOverview.bottomPerformer.performanceIndex.toFixed(1)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm text-muted-foreground">Cumplimiento</span>
                <span className="font-medium">{data.complianceOverview.completionRate.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Score Promedio</span>
                <span className="font-medium">{data.complianceOverview.avgScore.toFixed(1)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <ExecutiveSummaryCostChart costTrends={data.costTrends} />
      </div>
    </div>
  );
}