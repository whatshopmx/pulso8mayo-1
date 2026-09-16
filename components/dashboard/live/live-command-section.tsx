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

export function LiveCommandSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-44 rounded-xl border border-border/60 bg-muted/30" />
      <div className="h-96 rounded-xl border border-border/60 bg-muted/30" />
    </div>
  );
}
