"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useApprovalInbox,
  useApproveRequest,
  useRejectRequest,
  type ApprovalInboxItem,
} from "@/hooks/queries/use-service-orders";
import {
  ClipboardCheck,
  Check,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

function formatCurrency(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Bandeja "Autorizaciones" de Control Interno (R4).
 * Los items ya vienen filtrados por el API: nivel corriente del documento,
 * rol suficiente para resolverlos y excluye los creados por el propio actor.
 * El scoping de sucursal (GERENTE/SUPERVISOR fijos) también lo aplica el servidor.
 */
export function ApprovalInbox() {
  const inbox = useApprovalInbox();
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();

  const [rejectTarget, setRejectTarget] = useState<ApprovalInboxItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const approve = async (item: ApprovalInboxItem) => {
    try {
      const res = await approveMutation.mutateAsync(item.requestId);
      toast.success(res?.documentFinalized ? `${item.folio}: nivel final aprobado. Documento aprobado.` : `${item.folio}: nivel ${item.level} aprobado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo aprobar");
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    try {
      await rejectMutation.mutateAsync({ requestId: rejectTarget.requestId, reason: rejectReason.trim() });
      toast.success(`${rejectTarget.folio} rechazado`);
      setRejectTarget(null);
      setRejectReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo rechazar");
    }
  };

  if (inbox.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando autorizaciones pendientes…
      </div>
    );
  }

  if (inbox.isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="No se pudo cargar la bandeja"
        description={inbox.error instanceof Error ? inbox.error.message : "Intenta de nuevo."}
        action={
          <Button variant="outline" size="sm" onClick={() => inbox.refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
          </Button>
        }
      />
    );
  }

  const items = inbox.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Sin autorizaciones en tu turno"
        description="Cuando una OC u OS requiera tu nivel de autorización aparecerá aquí."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.requestId} className="rounded-lg border p-4 space-y-3">
          {/* Encabezado del documento */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={item.docType === "OC" ? "secondary" : "outline"}>{item.docType}</Badge>
                <span className="font-mono text-sm font-medium">
                  {item.folio.startsWith("DRAFT") ? <span className="text-muted-foreground">{item.folio}</span> : item.folio}
                </span>
                {item.isEmergency && (
                  <Badge variant="outline" className="border-red-600/40 text-red-700 dark:text-red-400 gap-1">
                    <Zap className="h-3 w-3" /> Emergencia
                  </Badge>
                )}
                <Badge variant="warning">En turno · nivel {item.level}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {item.docTypeLabel}{item.scope ? ` · ${item.scope}` : ""} · {item.branchName ?? "-"}
                {item.costCenterCode ? ` · ${item.costCenterCode}` : ""}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-semibold tabular-nums">{formatCurrency(item.amountCents)}</p>
              <p className="text-xs text-muted-foreground">{formatDate(item.requestedAt)}</p>
            </div>
          </div>

          {/* Contexto financiero: presupuesto restante o cap de emergencias */}
          {item.budget && (
            <BudgetHint
              label={`Presupuesto ${item.costCenterCode ?? ""} · mes en curso`.trim()}
              budgeted={item.budget.budgeted}
              available={item.budget.available}
            />
          )}
          {item.emergency && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" />
              Tope de emergencias: usado {formatCurrency(item.emergency.used)}
              {item.emergency.cap !== null ? ` de ${formatCurrency(item.emergency.cap)}` : " (sin tope configurado)"}
            </p>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-1 border-t">
            <p className="text-xs text-muted-foreground self-center mr-auto">
              Requiere rol <span className="font-medium">{item.requiredRole}</span> · mínimo {item.minQuotes} cotización(es)
            </p>
            <Button size="sm" onClick={() => approve(item)} disabled={approveMutation.isPending}>
              {(approveMutation.isPending) && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              <Check className="h-4 w-4 mr-1" /> Aprobar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setRejectTarget(item)}>
              <X className="h-4 w-4 mr-1" /> Rechazar
            </Button>
          </div>
        </div>
      ))}

      {/* Rechazo con motivo obligatorio (el API exige ≥3 caracteres) */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar {rejectTarget?.folio}</DialogTitle>
            <DialogDescription>El documento pasa a RECHAZADA de inmediato.</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="Motivo del rechazo…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            aria-label="Motivo del rechazo"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>Volver</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 3 || rejectMutation.isPending}
              onClick={reject}
            >
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Barra de consumo + disponible; ámbar cuando queda ≤10% (criterio alert≥90%). */
function BudgetHint({ label, budgeted, available }: { label: string; budgeted: number; available: number }) {
  if (budgeted <= 0) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Wallet className="h-3.5 w-3.5" /> Sin presupuesto capturado para esta partida.
      </p>
    );
  }
  const usedPct = Math.min(100, Math.round(((budgeted - available) / budgeted) * 100));
  const low = available <= budgeted * 0.1;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5" /> {label}
        </span>
        <span className={low ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
          Disponible {formatCurrency(available)} de {formatCurrency(budgeted)}
        </span>
      </div>
      <Progress value={usedPct} className="h-1.5" aria-label={`${label}: ${usedPct}% consumido`} />
    </div>
  );
}
