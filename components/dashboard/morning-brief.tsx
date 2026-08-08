import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Sunrise, ArrowRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { MorningBriefService } from "@/lib/services/morning-brief-service";
import { TierService } from "@/lib/services/tier-service";
import type { ImpactLevel } from "@/lib/services/intelligence/types";

/**
 * Sección 0 del dashboard ejecutivo — el "momento CEO" del día.
 *
 * Server Component: lee la última fila de `morning_briefs`. No calcula nada,
 * por eso puede ir arriba del todo sin retrasar el render de la página.
 */

const IMPACT_STYLES: Record<ImpactLevel, { label: string; className: string }> = {
  CRITICAL: { label: "Crítico", className: "bg-destructive text-destructive-foreground" },
  HIGH: { label: "Alto", className: "bg-amber-500 text-white" },
  MEDIUM: { label: "Medio", className: "bg-sky-500 text-white" },
  LOW: { label: "Bajo", className: "bg-muted text-muted-foreground" },
};

/** Comparación de salud vs el brief de ayer. Menos riesgo = mejor. */
function healthDelta(today: number, yesterday: number | null) {
  if (yesterday == null) return null;
  const diff = today - yesterday;
  if (diff === 0) return { icon: Minus, text: "sin cambio vs ayer", tone: "text-muted-foreground" };
  if (diff > 0)
    return { icon: TrendingUp, text: `+${diff} pts vs ayer`, tone: "text-emerald-600" };
  return { icon: TrendingDown, text: `${diff} pts vs ayer`, tone: "text-destructive" };
}

export async function MorningBrief({ companyId }: { companyId: string }) {
  const allowed = await TierService.hasFeature(companyId, "morning_brief");
  if (!allowed) return null;

  const latest = await MorningBriefService.getLatest(companyId);

  if (!latest) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sunrise className="h-5 w-5 text-amber-500" />
            Morning Brief
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            bare
            title="Aún no hay brief"
            description="El brief se genera todos los días a las 7:00 AM (hora del centro). Aparecerá aquí en cuanto corra el primer ciclo."
          />
        </CardContent>
      </Card>
    );
  }

  const prevDate = new Date(`${latest.briefDate}T00:00:00Z`);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const previous = await MorningBriefService.getByDate(
    companyId,
    prevDate.toISOString().slice(0, 10),
  );

  const todayHealth = (latest.twinSnapshot.healthScore as number) ?? 0;
  const yesterdayHealth = (previous?.twinSnapshot.healthScore as number) ?? null;
  const delta = healthDelta(todayHealth, yesterdayHealth);
  const DeltaIcon = delta?.icon;

  const formattedDate = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${latest.briefDate}T00:00:00Z`));

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sunrise className="h-5 w-5 text-amber-500" />
              Morning Brief
            </CardTitle>
            <CardDescription className="capitalize">{formattedDate}</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold leading-none">{todayHealth}<span className="text-sm text-muted-foreground">/100</span></p>
            {delta && DeltaIcon && (
              <p className={`mt-1 flex items-center justify-end gap-1 text-xs ${delta.tone}`}>
                <DeltaIcon className="h-3 w-3" />
                {delta.text}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <p className="text-sm font-medium">{latest.brief.headline}</p>

        {/* Las 3 prioridades del día */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prioridades de hoy
          </h3>
          {latest.brief.priorities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin prioridades marcadas para hoy.
            </p>
          ) : (
            <ol className="space-y-2">
              {latest.brief.priorities.map((p) => {
                const style = IMPACT_STYLES[p.impact] ?? IMPACT_STYLES.LOW;
                return (
                  <li
                    key={p.rank}
                    className="flex flex-wrap items-start gap-3 rounded-lg border p-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                      {p.rank}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{p.title}</p>
                        <Badge className={style.className}>{style.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{p.why}</p>
                      <p className="text-xs">{p.recommendedAction}</p>
                    </div>
                    {p.actionUrl && (
                      <Button variant="ghost" size="sm" asChild className="shrink-0">
                        <Link href={p.actionUrl}>
                          Ir
                          <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Secciones narrativas con sus métricas */}
        <div className="grid gap-3 md:grid-cols-3">
          {latest.brief.sections.map((s) => (
            <div key={s.id} className="rounded-lg border p-3 space-y-2">
              <h4 className="text-sm font-semibold">{s.title}</h4>
              <p className="text-xs text-muted-foreground">{s.body}</p>
              {s.metrics && s.metrics.length > 0 && (
                <dl className="space-y-1">
                  {s.metrics.map((m) => (
                    <div key={m.label} className="flex justify-between gap-2 text-xs">
                      <dt className="text-muted-foreground truncate">{m.label}</dt>
                      <dd className="font-medium shrink-0">{m.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
