"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2, ShieldAlert, ArrowRight, RefreshCw } from "lucide-react";
import { ConfirmRemediationDialog } from "@/components/incidents/confirm-remediation-dialog";
import { ErrorState } from "@/components/shared";

interface RemediationAction {
  id: string;
  incidentId: string;
  serviceConfigId?: string | null;
  branchId: string;
  companyId: string;
  actionType: string;
  serviceType: string;
  workflowTemplateId?: string | null;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  scheduledDate?: string | null;
  createdAt: string;
  incidentTitle?: string | null;
  incidentDescription?: string | null;
  incidentSeverity?: string | null;
  incidentStatus?: string | null;
  serviceName?: string | null;
}

const PREVIEW_COUNT = 3;

export function PendingRemediationActionsCard() {
  const [actions, setActions] = useState<RemediationAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedAction, setSelectedAction] = useState<RemediationAction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const res = await fetch("/api/remediation/actions?status=PENDING,CONFIRMED");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setActions(json.data ?? []);
    } catch (err) {
      console.error("Error loading remediation actions:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const pendingCount = actions.filter((a) => a.status === "PENDING").length;

  // Ranked attention queue: pending actions first, then scheduled; show top 3
  // by default with a "ver todo" expansion (see AD-3 in tasks/plan.md).
  const ranked = [...actions].sort((a, b) => {
    const rank = (s: string) => (s === "PENDING" ? 0 : 1);
    return rank(a.status) - rank(b.status);
  });
  const visibleActions = expanded ? ranked : ranked.slice(0, PREVIEW_COUNT);
  const remainingCount = ranked.length - visibleActions.length;

  return (
    <>
      <Card className="border-warning/40">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-warning-text" />
                Acciones de Remediación Externa
              </CardTitle>
              {pendingCount > 0 && (
                <Badge variant="secondary" className="bg-warning text-warning-foreground font-bold px-2 py-0.5 rounded-full text-xs">
                  {pendingCount} Pendiente{pendingCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Incidentes que requieren coordinar visita de un proveedor normativo o especializado
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchActions} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Cargando acciones pendientes...</div>
          ) : error ? (
            <ErrorState
              message="No se pudieron cargar las acciones de remediación."
              onRetry={fetchActions}
            />
          ) : actions.length === 0 ? (
            <div className="py-6 text-center rounded-lg border border-dashed p-4 space-y-1">
              <CheckCircle2 className="w-8 h-8 text-success mx-auto" />
              <p className="text-sm font-medium">Todo al día</p>
              <p className="text-xs text-muted-foreground">No hay incidentes pendientes de servicio externo.</p>
            </div>
          ) : (
            <>
            {visibleActions.map((action) => {
              const isPending = action.status === "PENDING";
              return (
                <div
                  key={action.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl border bg-card hover:bg-muted/40 transition-colors gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={
                          isPending
                            ? "bg-warning/15 text-warning-text border-warning/30"
                            : "bg-info/10 text-info border-info/20"
                        }
                      >
                        {isPending ? "REQUIERE ACCIÓN" : "PROGRAMADO"}
                      </Badge>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {action.serviceName || action.serviceType}
                      </span>
                    </div>

                    <p className="text-sm font-medium truncate text-foreground">
                      {action.incidentTitle || `Incidente en ${action.serviceType}`}
                    </p>

                    {action.scheduledDate && (
                      <div className="flex items-center gap-1.5 text-xs text-info font-medium">
                        <Calendar className="w-3.5 h-3.5" />
                        Visita: {new Date(action.scheduledDate).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    {isPending ? (
                      <Button
                        size="sm"
                        className="bg-warning text-warning-foreground hover:bg-warning/90 gap-1.5 text-xs font-semibold"
                        onClick={() => {
                          setSelectedAction(action);
                          setDialogOpen(true);
                        }}
                      >
                        Confirmar Visita
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-normal">
                        Esperando ejecución de workflow
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {!expanded && remainingCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded(true)}
              >
                Ver todo ({remainingCount} más)
              </Button>
            )}
            {expanded && ranked.length > PREVIEW_COUNT && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded(false)}
              >
                Ver menos
              </Button>
            )}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmRemediationDialog
        action={selectedAction}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={fetchActions}
      />
    </>
  );
}
