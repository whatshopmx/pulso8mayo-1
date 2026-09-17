"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertOctagon,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MessageCircle,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BriefPriority,
  ImpactLevel,
  ExecutiveDecisionResolution,
} from "@/lib/services/intelligence/types";
import type { NetworkAnomalyFinding } from "@/lib/services/cross-branch-service";

interface ExecutiveDecisionDeckProps {
  priorities?: BriefPriority[];
  anomalies?: NetworkAnomalyFinding[];
  /**
   * Resoluciones ya persistidas en `executive_decisions`, resueltas en el
   * servidor. La cola se hidrata con ellas: al recargar, lo despachado
   * permanece despachado y el badge del servidor coincide con la cola.
   */
  initialResolutions?: Record<
    string,
    { resolution: ExecutiveDecisionResolution; resolvedByName: string | null }
  >;
}

interface DecisionItem {
  id: string;
  title: string;
  description: string;
  recommendedAction: string;
  impact: ImpactLevel;
  amountLabel: string | null;
  actionUrl: string;
  actionLabel: string;
  branchName: string | null;
  sourceLabel: string;
}

type DecisionResolution = "authorized" | "deferred";

const IMPACT_BADGES: Record<ImpactLevel, { label: string; className: string }> = {
  CRITICAL: {
    label: "Crítico",
    className: "bg-destructive text-destructive-foreground",
  },
  HIGH: {
    label: "Alto Impacto",
    className: "bg-warning text-warning-foreground",
  },
  MEDIUM: {
    label: "Medio",
    className: "bg-chart-4/15 text-chart-4",
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

/**
 * Redacta la instrucción correctiva que Dirección manda al gerente de sucursal:
 * dato desfasado, instrucción concreta e hipervínculo para subir la evidencia.
 */
function buildManagerMessage(item: DecisionItem, evidenceUrl: string): string {
  return [
    "Hola, te escribo de Dirección.",
    "",
    `*Caso:* ${item.title}`,
    `*Desviación:* ${item.description}`,
    `*Instrucción:* ${item.recommendedAction}`,
    item.amountLabel ? `*Impacto:* ${item.amountLabel}` : null,
    "",
    `Sube la evidencia de corrección aquí: ${evidenceUrl}`,
    "Confirmo contigo antes del cierre del día.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Abre WhatsApp con el mensaje ya redactado (gesto explícito de clic). */
function openWhatsApp(message: string) {
  const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ExecutiveDecisionDeck({
  priorities = [],
  anomalies = [],
  initialResolutions = {},
}: ExecutiveDecisionDeckProps) {
  const [resolutions, setResolutions] = useState<Record<string, DecisionResolution>>(() => {
    const hydrated: Record<string, DecisionResolution> = {};
    for (const [key, record] of Object.entries(initialResolutions)) {
      hydrated[key] = record.resolution;
    }
    return hydrated;
  });
  const [resolvedNames, setResolvedNames] = useState<Record<string, string | null>>(() => {
    const hydrated: Record<string, string | null> = {};
    for (const [key, record] of Object.entries(initialResolutions)) {
      hydrated[key] = record.resolvedByName;
    }
    return hydrated;
  });
  const [persisting, setPersisting] = useState<Record<string, boolean>>({});
  const [whatsappSent, setWhatsappSent] = useState<Record<string, boolean>>({});

  // Cola ejecutiva: prioridades del brief matutino + anomalías de red (top 4).
  const queue = useMemo<DecisionItem[]>(() => {
    const fromBrief: DecisionItem[] = priorities.map((priority) => ({
      id: `brief-${priority.rank}-${priority.title}`,
      title: priority.title,
      description: priority.why,
      recommendedAction: priority.recommendedAction,
      impact: priority.impact,
      amountLabel: priority.estimatedSavingsCents
        ? `Ahorro est. ${fmtPesos(priority.estimatedSavingsCents)}`
        : null,
      actionUrl: priority.actionUrl ?? "/dashboard/exceptions",
      actionLabel: "Auditoría a fondo",
      branchName: null,
      sourceLabel: `Brief Matutino · Prioridad #${priority.rank}`,
    }));

    const fromAnomalies: DecisionItem[] = anomalies.slice(0, 3).map((anomaly) => ({
      id: anomaly.id,
      title: anomaly.title,
      description: `${anomaly.narrative} (desvío de ${anomaly.variancePoints.toFixed(1)} pts vs. ${
        anomaly.benchmarkBranchName ?? "la red"
      })`,
      recommendedAction: anomaly.suggestedAction,
      impact: (anomaly.severity === "critical" ? "CRITICAL" : "HIGH") as ImpactLevel,
      amountLabel: anomaly.estimatedImpactMxn
        ? `En riesgo: $${anomaly.estimatedImpactMxn.toLocaleString("es-MX")} MXN`
        : null,
      actionUrl: `/dashboard/branches/${anomaly.affectedBranchId}`,
      actionLabel: "Auditar Tienda",
      branchName: anomaly.affectedBranchName,
      sourceLabel: `Anomalía de Red · ${anomaly.type.replace(/_/g, " ").toLowerCase()}`,
    }));

    return [...fromBrief, ...fromAnomalies].slice(0, 4);
  }, [priorities, anomalies]);

  const pendingCount = queue.filter((item) => !resolutions[item.id]).length;

  /**
   * POST optimista a /api/executive/decisions. Si el guard o la red fallan,
   * ejecuta `revert` (snapshot capturado por el llamador) para que la UI nunca
   * muestre un estado que la base de datos no respalda.
   */
  async function persistDecision(
    item: DecisionItem,
    payload: { resolution: ExecutiveDecisionResolution | "revoke" },
    revert: () => void
  ) {
    try {
      const res = await fetch("/api/executive/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionKey: item.id, resolution: payload.resolution }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message ?? "No se pudo guardar la resolución.");
      }
      if (payload.resolution !== "revoke") {
        setResolvedNames((state) => ({
          ...state,
          [item.id]: (json?.data?.resolvedByName as string | null) ?? null,
        }));
      } else {
        setResolvedNames((state) => {
          const next = { ...state };
          delete next[item.id];
          return next;
        });
      }
    } catch (error) {
      revert();
      toast.error(
        error instanceof Error ? error.message : "No se pudo guardar la resolución.",
        { description: item.title }
      );
    } finally {
      setPersisting((previous) => {
        const next = { ...previous };
        delete next[item.id];
        return next;
      });
    }
  }

  function resolveDecision(item: DecisionItem, resolution: DecisionResolution) {
    const previous = resolutions[item.id];
    setResolutions((state) => ({ ...state, [item.id]: resolution }));
    setPersisting((state) => ({ ...state, [item.id]: true }));
    toast.success(resolution === "authorized" ? "Caso autorizado" : "Caso diferido 24 h", {
      description: item.title,
    });
    void persistDecision(item, { resolution }, () => {
      setResolutions((state) => {
        const next = { ...state };
        if (previous) next[item.id] = previous;
        else delete next[item.id];
        return next;
      });
    });
  }

  function undoResolution(item: DecisionItem) {
    const previous = resolutions[item.id];
    if (!previous) return;
    setResolutions((state) => {
      const next = { ...state };
      delete next[item.id];
      return next;
    });
    setPersisting((state) => ({ ...state, [item.id]: true }));
    void persistDecision(item, { resolution: "revoke" }, () => {
      setResolutions((state) => ({ ...state, [item.id]: previous }));
    });
  }

  function handleWhatsApp(item: DecisionItem) {
    const evidenceUrl = `${window.location.origin}${item.actionUrl}`;
    openWhatsApp(buildManagerMessage(item, evidenceUrl));
    setWhatsappSent((previous) => ({ ...previous, [item.id]: true }));
  }

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
              Despacha, delega o difiere cada caso sin salir de la cabina: firma en un clic o manda la
              instrucción correctiva al gerente por WhatsApp
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit text-xs font-medium border-border">
            {pendingCount} de {queue.length} {queue.length === 1 ? "caso pendiente" : "casos pendientes"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0 divide-y divide-border">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm font-semibold text-foreground">Red en Control Operativo</p>
            <p className="max-w-md text-xs text-muted-foreground">
              No hay autorizaciones de emergencia, desviaciones críticas de prime cost ni alertas rojas
              bloqueadas el día de hoy.
            </p>
          </div>
        ) : (
          queue.map((item, idx) => {
            const badge = IMPACT_BADGES[item.impact] ?? IMPACT_BADGES.MEDIUM;
            const isCritical = item.impact === "CRITICAL";
            const resolution = resolutions[item.id];

            return (
              <div
                key={item.id}
                className={cn(
                  "flex flex-col gap-3 p-4 transition-colors sm:p-5",
                  resolution
                    ? "bg-muted/40"
                    : isCritical
                      ? "bg-destructive/5 hover:bg-destructive/10"
                      : "hover:bg-muted/30"
                )}
              >
                {/* Contexto del caso y acción sugerida */}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-2xl space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider",
                          badge.className
                        )}
                      >
                        {badge.label}
                      </span>
                      {item.amountLabel && (
                        <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-bold text-foreground">
                          {item.amountLabel}
                        </span>
                      )}
                      <span className="text-xs font-medium text-muted-foreground">{item.sourceLabel}</span>
                      <span className="text-xs font-medium text-muted-foreground">· Caso #{idx + 1}</span>
                    </div>

                    <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                    <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>

                    <p className="flex items-start gap-1.5 pt-0.5 text-xs font-medium text-foreground/90">
                      <span className="font-bold text-primary">Acción sugerida:</span>
                      <span>{item.recommendedAction}</span>
                    </p>

                    {item.branchName && (
                      <p className="text-xs text-muted-foreground">
                        Sucursal responsable:{" "}
                        <strong className="text-foreground">{item.branchName}</strong>
                      </p>
                    )}
                  </div>

                  {/* Despacho de 60 segundos: firma, diferimiento o WhatsApp */}
                  <div className="flex shrink-0 flex-col items-start gap-2">
                    {resolution ? (
                      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                        {resolution === "authorized" ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <Clock3 className="h-4 w-4 text-warning" />
                        )}
                        <span className="text-xs font-medium text-foreground">
                          {resolution === "authorized"
                            ? resolvedNames[item.id]
                              ? `Autorizado por ${resolvedNames[item.id]}`
                              : "Autorizado por Dirección"
                            : "Diferido 24 horas"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          disabled={Boolean(persisting[item.id])}
                          onClick={() => undoResolution(item)}
                        >
                          <Undo2 className="mr-1 h-3.5 w-3.5" />
                          Deshacer
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className={cn(
                              "h-8 text-xs font-medium",
                              isCritical
                                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                : "bg-primary text-primary-foreground hover:bg-primary/90"
                            )}
                            disabled={Boolean(persisting[item.id])}
                            onClick={() => resolveDecision(item, "authorized")}
                          >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Autorizar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-medium"
                            disabled={Boolean(persisting[item.id])}
                            onClick={() => resolveDecision(item, "deferred")}
                          >
                            <Clock3 className="mr-1.5 h-3.5 w-3.5" />
                            Diferir 24 h
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-medium"
                            disabled={Boolean(persisting[item.id])}
                            onClick={() => handleWhatsApp(item)}
                          >
                            <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                            WhatsApp al Gerente
                          </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <Link
                            href={item.actionUrl}
                            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {item.actionLabel}
                          </Link>
                          {whatsappSent[item.id] && (
                            <span className="text-xs font-medium text-success-text">
                              Mensaje redactado en WhatsApp
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
