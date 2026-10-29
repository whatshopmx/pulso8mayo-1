import React from "react";
import { LiveCommandService } from "@/lib/services/live-command-service";
import { LivePulseBanner } from "./live-pulse-banner";
import { LiveRushAlerts } from "./live-rush-alerts";
import { LiveCommandMatrix } from "./live-command-matrix";

interface LiveCommandSectionProps {
  companyId: string;
  branchId?: string;
}

export async function LiveCommandSection({ companyId, branchId }: LiveCommandSectionProps) {
  if (!companyId) {
    return null;
  }

  const liveSummary = await LiveCommandService.getLivePulse(companyId, branchId);

  return (
    <div className="space-y-4">
      {/* 1. Banner de Pulso Operativo */}
      <LivePulseBanner summary={liveSummary} />

      {/* 2. Alertas Inmediatas en Rush (si existen) */}
      <LiveRushAlerts rushAlerts={liveSummary.rushAlerts} />

      {/* 3. Matriz Operativa de Sucursales de la Cadena */}
      <LiveCommandMatrix branches={liveSummary.branches} />
    </div>
  );
}

/**
 * F13: el fallback de Suspense debe ocupar una altura parecida a la del
 * contenido real. Antes eran dos bloques fijos (176 px y 384 px) que no
 * correspondían ni al banner ni a la matriz; al hidratar, `main` se desplazaba
 * y el navegador lo contaba como CLS. Este esqueleto replica la estructura
 * (encabezado, cuatro KPI y filas de la matriz) en lugar de estimar un alto.
 */
export function LiveCommandSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-hidden="true">
      {/* Banner de pulso */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-full bg-muted" />
            <div className="space-y-2">
              <div className="h-4 w-52 rounded bg-muted" />
              <div className="h-3 w-40 rounded bg-muted/60" />
            </div>
          </div>
          <div className="h-8 w-36 rounded-lg bg-muted/60" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3.5 rounded-lg border border-border/70 bg-background/50 p-3"
            >
              <div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-24 rounded bg-muted/60" />
                <div className="h-5 w-16 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Matriz operativa */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col justify-between gap-3 border-b border-border/80 bg-muted/20 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="space-y-2">
            <div className="h-4 w-56 rounded bg-muted" />
            <div className="h-3 w-72 rounded bg-muted/60" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-full rounded-lg bg-muted/60 sm:w-56" />
            <div className="h-9 w-24 rounded-lg bg-muted/60" />
          </div>
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 p-4">
              <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-40 rounded bg-muted" />
                <div className="h-3 w-64 rounded bg-muted/60" />
              </div>
              <div className="hidden h-8 w-24 rounded bg-muted/60 sm:block" />
              <div className="h-8 w-20 rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
