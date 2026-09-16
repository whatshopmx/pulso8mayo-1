"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  DollarSign,
  PackageCheck,
  ShieldAlert,
  Users,
  ExternalLink,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BriefPriority, ImpactLevel } from "@/lib/services/intelligence/types";
import type { NetworkAnomalyFinding } from "@/lib/services/cross-branch-service";

interface ExecutiveDecisionDeckProps {
  priorities?: BriefPriority[];
  anomalies?: NetworkAnomalyFinding[];
  companyId: string;
}

const IMPACT_BADGES: Record<ImpactLevel, { label: string; className: string }> = {
  CRITICAL: {
    label: "Crítico",
    className: "bg-destructive text-destructive-foreground",
  },
  HIGH: {
    label: "Alto Impacto",
    className: "bg-amber-500 text-white dark:bg-amber-600",
  },
  MEDIUM: {
    label: "Medio",
    className: "bg-sky-500 text-white dark:bg-sky-600",
  },
  LOW: {
    label: "Preventivo",
    className: "bg-muted text-muted-foreground",
  },
};

function fmtPesos(cents?: number): string | null {
  if (cents == null || cents === 0) return null;
  const abs = Math.abs(cents);
  if (abs >= 1e8) return `$${(cents / 1e8).toFixed(2)}M MXN`;
  if (abs >= 1e5) return `$${(cents / 1e5).toFixed(1)}K MXN`;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;
}

export function ExecutiveDecisionDeck({
  priorities = [],
  anomalies = [],
  companyId,
}: ExecutiveDecisionDeckProps) {
  // Combine priorities and critical network anomalies into an executive queue
  const combinedDecisions = [
    ...priorities.map((p) => ({
      id: `brief-${p.rank}-${p.title}`,
      title: p.title,
      description: p.why,
      recommendedAction: p.recommendedAction,
      impact: p.impact,
      amountLabel: p.estimatedSavingsCents ? `Ahorro est. ${fmtPesos(p.estimatedSavingsCents)}` : null,
      actionUrl: p.actionUrl ?? "/dashboard/exceptions",
      actionLabel: "Revisar & Resolver",
      type: "DECISION",
    })),
    ...anomalies.slice(0, 3).map((a) => ({
      id: a.id,
      title: a.title,
      description: a.narrative,
      recommendedAction: a.suggestedAction,
      impact: (a.severity === "critical" ? "CRITICAL" : "HIGH") as ImpactLevel,
      amountLabel: a.estimatedImpactMxn ? `En riesgo: $${a.estimatedImpactMxn.toLocaleString("es-MX")} MXN` : null,
      actionUrl: `/dashboard/branches/${a.affectedBranchId}`,
      actionLabel: "Auditar Sucursal",
      type: a.type,
    })),
  ];

  // Take top 4 most urgent items
  const queue = combinedDecisions.slice(0, 4);

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <AlertOctagon className="h-5 w-5 text-primary" />
              Cola de Decisiones & Autorizaciones
            </CardTitle>
            <CardDescription>
              Casos que requieren firma del dueño o arbitraje de red para evitar fuga de margen
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit text-xs font-medium border-border">
            {queue.length} {queue.length === 1 ? "caso activo" : "casos activos"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0 divide-y divide-border">
        {queue.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="font-semibold text-foreground text-sm">Red en Control Operativo</p>
            <p className="text-xs text-muted-foreground max-w-md">
              No hay autorizaciones de emergencia, desviaciones críticas de prime cost ni alertas rojas bloqueadas el día de hoy.
            </p>
          </div>
        ) : (
          queue.map((item, idx) => {
            const badge = IMPACT_BADGES[item.impact] ?? IMPACT_BADGES.MEDIUM;
            const isCritical = item.impact === "CRITICAL";

            return (
              <div
                key={item.id}
                className={cn(
                  "p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between transition-colors",
                  isCritical ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/30"
                )}
              >
                {/* Left: Info & Narrative */}
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded", badge.className)}>
                      {badge.label}
                    </span>
                    {item.amountLabel && (
                      <span className="text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded border border-border">
                        {item.amountLabel}
                      </span>
                    )}
                    <span className="text-xs font-medium text-muted-foreground">
                      Prioridad #{idx + 1}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>

                  {item.recommendedAction && (
                    <p className="text-xs font-medium text-foreground/90 flex items-center gap-1.5 pt-0.5">
                      <span className="text-primary font-bold">Acción sugerida:</span>
                      {item.recommendedAction}
                    </p>
                  )}
                </div>

                {/* Right: Direct Action Buttons */}
                <div className="flex items-center gap-2 sm:shrink-0 pt-2 sm:pt-0">
                  <Button
                    asChild
                    size="sm"
                    className={cn(
                      "text-xs font-medium h-8",
                      isCritical
                        ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                  >
                    <Link href={item.actionUrl}>
                      {item.actionLabel}
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
