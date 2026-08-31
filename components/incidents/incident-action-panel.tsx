"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Hourglass,
  RefreshCw,
  Settings2,
  ShieldAlert,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { ConfirmRemediationDialog } from "@/components/incidents/confirm-remediation-dialog";

export type RecommendedActionKind =
  | "CONFIRM_EXTERNAL"
  | "AWAIT_SCHEDULED"
  | "CONFIGURE_PROVIDER"
  | "REQUEST_EXTERNAL"
  | "RUN_PROTOCOL_STEP"
  | "DECLARED_ACTION"
  | "SUGGESTED_FIX"
  | "ESCALATE"
  | "RESOLVE_MANUAL";

export interface RecommendedAction {
  kind: RecommendedActionKind;
  label: string;
  rationale: string;
  urgency: "HIGH" | "MEDIUM" | "LOW";
  payload?: {
    remediationActionId?: string;
    serviceType?: string;
    stepIndex?: number;
    escalationLevel?: number;
    scheduledDate?: string;
    branchId?: string;
    href?: string;
    cta?: string;
  };
}

interface RemediationActionRow {
  id: string;
  incidentId: string;
  serviceType: string;
  serviceName?: string | null;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  scheduledDate?: string | null;
  createdAt: string;
}

interface IncidentActionPanelProps {
  incidentId: string;
  incidentTitle?: string;
  incidentSeverity?: string;
  /** Cambiar este valor fuerza un refetch (p. ej. tras avanzar un paso del protocolo). */
  refreshToken?: number;
  /** Deja que el detalle sepa qué se recomienda (el wizard depende de ello, AD-5). */
  onRecommendationChange?: (recommended: RecommendedAction | null) => void;
  /** Se dispara tras confirmar una visita, para que el detalle recargue el incidente. */
  onActionConfirmed?: () => void;
  /** Abrir el diálogo de resolución manual cuando se muestra RESOLVE_MANUAL. */
  onResolveManual?: () => void;
}

/**
 * Estilo por tipo de recomendación. El ámbar es el mismo lenguaje visual que
 * usa la tarjeta del dashboard para "requiere acción"; azul para lo que ya está
 * agendado y no pide nada, y neutro para lo informativo.
 */
const KIND_STYLES: Record<
  RecommendedActionKind,
  { icon: typeof ShieldAlert; card: string; chip: string; chipLabel: string }
> = {
  CONFIRM_EXTERNAL: {
    icon: ShieldAlert,
    card: "border-amber-200/60 dark:border-amber-900/50",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300",
    chipLabel: "REQUIERE ACCIÓN",
  },
  CONFIGURE_PROVIDER: {
    icon: Settings2,
    card: "border-amber-200/60 dark:border-amber-900/50",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300",
    chipLabel: "BLOQUEADO",
  },
  ESCALATE: {
    icon: TrendingUp,
    card: "border-orange-200/60 dark:border-orange-900/50",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-300",
    chipLabel: "ESCALAR",
  },
  RUN_PROTOCOL_STEP: {
    icon: ClipboardCheck,
    card: "border-amber-200/60 dark:border-amber-900/50",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300",
    chipLabel: "REQUIERE ACCIÓN",
  },
  AWAIT_SCHEDULED: {
    icon: CalendarClock,
    card: "border-blue-200/60 dark:border-blue-900/50",
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300",
    chipLabel: "PROGRAMADO",
  },
  REQUEST_EXTERNAL: {
    icon: Hourglass,
    card: "border-blue-200/60 dark:border-blue-900/50",
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300",
    chipLabel: "EN PROCESO",
  },
  // Declarada por la regla: no es una sugerencia, es lo que se configuró.
  DECLARED_ACTION: {
    icon: ClipboardCheck,
    card: "border-amber-200/60 dark:border-amber-900/50",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300",
    chipLabel: "ACCIÓN DEL FLUJO",
  },
  SUGGESTED_FIX: {
    icon: Wrench,
    card: "border-amber-200/60 dark:border-amber-900/50",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300",
    chipLabel: "ACCIÓN SUGERIDA",
  },
  RESOLVE_MANUAL: {
    icon: CheckCircle2,
    card: "",
    chip: "bg-muted text-muted-foreground",
    chipLabel: "SIN AUTOMATIZACIÓN",
  },
};

export function IncidentActionPanel({
  incidentId,
  incidentTitle,
  incidentSeverity,
  refreshToken = 0,
  onRecommendationChange,
  onActionConfirmed,
  onResolveManual,
}: IncidentActionPanelProps) {
  const [recommended, setRecommended] = useState<RecommendedAction | null>(null);
  const [actions, setActions] = useState<RemediationActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Los callbacks van por ref a propósito: `onRecommendationChange` sube estado
  // al detalle, así que si `fetchActions` dependiera de su identidad, un padre
  // que pase una arrow inline volvería a montar el efecto en cada render y el
  // fetch entraría en bucle.
  const onRecommendationChangeRef = useRef(onRecommendationChange);
  const onActionConfirmedRef = useRef(onActionConfirmed);

  useEffect(() => {
    onRecommendationChangeRef.current = onRecommendationChange;
    onActionConfirmedRef.current = onActionConfirmed;
  });

  const fetchActions = useCallback(async () => {
    if (!incidentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/actions`);
      const json: {
        success?: boolean;
        data?: { actions?: RemediationActionRow[]; recommended?: RecommendedAction | null };
        error?: { message?: string };
      } = await res.json().catch(() => ({}));

      if (!res.ok || json?.success === false) {
        throw new Error(json?.error?.message || "No se pudieron cargar las acciones");
      }

      setActions(json.data?.actions ?? []);
      setRecommended(json.data?.recommended ?? null);
      onRecommendationChangeRef.current?.(json.data?.recommended ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudieron cargar las acciones";
      setError(message);
      setRecommended(null);
      onRecommendationChangeRef.current?.(null);
    } finally {
      setLoading(false);
    }
    // `refreshToken` entra a propósito: el detalle lo incrementa cuando avanza
    // un paso del protocolo y la recomendación cambia con él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, refreshToken]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const handleConfirmSuccess = useCallback(() => {
    fetchActions();
    onActionConfirmed?.();
  }, [fetchActions, onActionConfirmed]);

  // Altura mínima estable en los tres estados para no provocar layout shift
  // cuando la carga termina.
  const shell = "min-h-[132px]";

  if (loading) {
    return (
      <Card className={shell}>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={`${shell} border-destructive/30`}>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium">No se pudo cargar la acción recomendada</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchActions} className="gap-1.5 shrink-0">
            <RefreshCw className="w-3.5 h-3.5" />
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!recommended) {
    return (
      <Card className={shell}>
        <CardContent className="p-4 flex items-center gap-2.5 h-full">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-medium">Sin acción pendiente</p>
            <p className="text-xs text-muted-foreground">
              Este incidente no tiene una acción recomendada por ahora.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const style = KIND_STYLES[recommended.kind] ?? KIND_STYLES.RESOLVE_MANUAL;
  const Icon = style.icon;

  const pendingAction =
    recommended.kind === "CONFIRM_EXTERNAL"
      ? actions.find((a) => a.id === recommended.payload?.remediationActionId) ??
        actions.find((a) => a.status === "PENDING") ??
        null
      : null;

  return (
    <>
      <Card className={`${shell} shadow-sm ${style.card}`}>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Icon className="w-4 h-4" />
                Acción recomendada
              </span>
              <Badge variant="outline" className={style.chip}>
                {style.chipLabel}
              </Badge>
            </div>

            <p className="text-base font-semibold text-foreground">{recommended.label}</p>

            {/* El rationale es lo que evita que la recomendación sea una orden opaca. */}
            <p className="text-sm text-muted-foreground">{recommended.rationale}</p>
          </div>

          <div className="shrink-0 w-full sm:w-auto flex sm:justify-end">
            {recommended.kind === "CONFIRM_EXTERNAL" && pendingAction && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 text-xs font-semibold w-full sm:w-auto"
                onClick={() => setDialogOpen(true)}
              >
                Confirmar visita
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}

            {/* El catálogo trae a dónde ir; sin destino, la sugerencia queda
                sólo como texto (p. ej. higiene personal, que se corrige con
                la persona y no en una pantalla). */}
            {(recommended.kind === "SUGGESTED_FIX" ||
              recommended.kind === "DECLARED_ACTION") &&
              recommended.payload?.href && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs font-semibold w-full sm:w-auto"
              >
                <Link href={recommended.payload.href}>
                  {recommended.payload.cta || "Ir"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Button>
            )}

            {recommended.kind === "CONFIGURE_PROVIDER" && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs font-semibold w-full sm:w-auto"
              >
                <Link href="/dashboard/equipment/compliance">
                  Configurar proveedor
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Button>
            )}

            {recommended.kind === "RESOLVE_MANUAL" && onResolveManual && (
              <Button
                size="sm"
                variant="outline"
                onClick={onResolveManual}
                className="gap-1.5 text-xs font-semibold w-full sm:w-auto"
              >
                Resolver manualmente
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmRemediationDialog
        action={
          pendingAction
            ? {
                id: pendingAction.id,
                incidentId: pendingAction.incidentId,
                serviceType: pendingAction.serviceType,
                serviceName: pendingAction.serviceName,
                incidentTitle: incidentTitle ?? null,
                incidentSeverity: incidentSeverity ?? null,
                createdAt: pendingAction.createdAt,
              }
            : null
        }
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={handleConfirmSuccess}
      />
    </>
  );
}
