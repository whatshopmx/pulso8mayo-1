"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  ExternalLink,
  FileText,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type CaseSourceType = "expense" | "cut" | "violation";

export interface HoyCaseItem {
  id: string;
  rawId: string;
  sourceType: CaseSourceType;
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  amountCents: number | null;
  href: string;
  branchName?: string;
  dateOrAge?: string;
  category?: string;
  notes?: string;
  evidenceUrl?: string;
  requiredRole?: string;
  // Metadata específica de corte
  cutVariance?: {
    direction: "faltante" | "sobrante";
    varianceCents: number;
    cashSalesCents?: number;
    cashCountedCents?: number;
    shift?: string;
    businessDate?: string;
  };
  // Metadata de violación de control interno
  violationMeta?: {
    ruleCode?: string;
    description?: string;
    severity?: string;
  };
}

interface HoyCaseDossierProps {
  selectedCase: HoyCaseItem | null;
  onClose?: () => void;
  onCaseResolved?: (resolvedCaseId: string) => void;
}

export function HoyCaseDossier({
  selectedCase,
  onClose,
  onCaseResolved,
}: HoyCaseDossierProps) {
  const { toast } = useToast();
  const [loadingAction, setLoadingAction] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  if (!selectedCase) {
    return (
      <Card className="h-full border-border flex flex-col items-center justify-center p-8 text-center bg-muted/10">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Expediente del caso</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-[32ch]">
          Selecciona un pendiente de la bandeja para inspeccionar su evidencia, antecedentes y resolverlo in-situ.
        </p>
      </Card>
    );
  }

  const handleApproveExpense = async () => {
    setLoadingAction(true);
    try {
      const res = await fetch("/api/expenses/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expenseId: selectedCase.rawId,
          notes: "Aprobado directamente desde la bandeja Hoy",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: "Gasto aprobado",
          description: `Se autorizó el gasto por ${formatCents(selectedCase.amountCents ?? 0)}.`,
        });
        onCaseResolved?.(selectedCase.id);
      } else {
        toast({
          title: "No se pudo autorizar el gasto",
          description: data?.error || "Error al procesar la autorización en el servidor.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error de conexión",
        description: "Revisa tu conexión a internet e intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(false);
    }
  };

  const handleRejectExpense = async () => {
    if (!rejectReason.trim()) return;

    setLoadingAction(true);
    try {
      const res = await fetch("/api/expenses/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expenseId: selectedCase.rawId,
          reason: rejectReason.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: "Gasto rechazado",
          description: "El gasto ha sido rechazado y quedó asentado en la bitácora.",
        });
        setRejectDialogOpen(false);
        setRejectReason("");
        onCaseResolved?.(selectedCase.id);
      } else {
        toast({
          title: "No se pudo rechazar",
          description: data?.error || "Error al registrar el rechazo.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error de conexión",
        description: "Revisa tu conexión a internet e intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <>
      <Card className="h-full flex flex-col border-border bg-card">
        {/* Encabezado del expediente */}
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={statusBadgeClasses(
                  selectedCase.severity === "HIGH"
                    ? "destructive"
                    : selectedCase.severity === "MEDIUM"
                      ? "warning"
                      : "neutral"
                )}
              >
                {selectedCase.severity === "HIGH"
                  ? "Crítico"
                  : selectedCase.severity === "MEDIUM"
                    ? "Requiere atención"
                    : "Normal"}
              </Badge>
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                {selectedCase.sourceType === "expense"
                  ? "Gasto Operativo"
                  : selectedCase.sourceType === "cut"
                    ? "Arqueo de Caja"
                    : "Control Interno"}
              </span>
            </div>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={onClose}
              >
                <X className="w-4 h-4" />
                <span className="sr-only">Cerrar</span>
              </Button>
            )}
          </div>
          <CardTitle className="text-base font-bold mt-2 leading-snug">
            {selectedCase.title}
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            {selectedCase.detail}
          </CardDescription>
        </CardHeader>

        {/* Cuerpo del expediente */}
        <CardContent className="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
          {/* Monto destacado */}
          {selectedCase.amountCents !== null && (
            <div className="p-3.5 rounded-lg bg-muted/40 border border-border/80">
              <span className="text-xs text-muted-foreground font-medium block">
                {selectedCase.sourceType === "cut"
                  ? `Diferencia de Arqueo (${selectedCase.cutVariance?.direction || "varianza"})`
                  : "Importe involucrado"}
              </span>
              <span className="text-2xl font-bold tabular-nums text-foreground mt-0.5 block">
                {formatCents(selectedCase.amountCents)}
              </span>
            </div>
          )}

          {/* Bloque específico para GASTO */}
          {selectedCase.sourceType === "expense" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground block">Sucursal</span>
                  <span className="font-semibold text-foreground">
                    {selectedCase.branchName || "No especificada"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Categoría</span>
                  <span className="font-semibold text-foreground">
                    {selectedCase.category || "Gasto general"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Rol Requerido</span>
                  <span className="font-semibold text-foreground">
                    {selectedCase.requiredRole || "Gerente / Admin"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Antigüedad</span>
                  <span className="font-semibold text-foreground">
                    {selectedCase.dateOrAge || "Hoy"}
                  </span>
                </div>
              </div>

              {selectedCase.notes && (
                <div className="p-2.5 rounded border border-border bg-background text-xs">
                  <span className="text-muted-foreground font-medium block mb-0.5">Notas del registro:</span>
                  <p className="text-foreground">{selectedCase.notes}</p>
                </div>
              )}

              {selectedCase.evidenceUrl && (
                <div className="p-2.5 rounded border border-border bg-background text-xs flex items-center justify-between">
                  <span className="text-muted-foreground">Comprobante / Evidencia digital</span>
                  <a
                    href={selectedCase.evidenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary font-medium hover:underline inline-flex items-center gap-1"
                  >
                    Ver archivo <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Bloque específico para CORTE DE CAJA */}
          {selectedCase.sourceType === "cut" && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground block">Sucursal</span>
                  <span className="font-semibold text-foreground">
                    {selectedCase.branchName || "Sucursal"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Turno</span>
                  <span className="font-semibold text-foreground">
                    {selectedCase.cutVariance?.shift || "Turno del día"}
                  </span>
                </div>
                {selectedCase.cutVariance?.cashSalesCents !== undefined && (
                  <div>
                    <span className="text-muted-foreground block">Efectivo POS Esperado</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatCents(selectedCase.cutVariance.cashSalesCents)}
                    </span>
                  </div>
                )}
                {selectedCase.cutVariance?.cashCountedCents !== undefined && (
                  <div>
                    <span className="text-muted-foreground block">Efectivo Contado</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatCents(selectedCase.cutVariance.cashCountedCents)}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-3 rounded border border-warning/30 bg-warning/5 text-xs text-warning-text flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  El dinero contado en el arqueo discrepa de la venta en efectivo registrada en el sistema.
                  Revisa los tickets y el corte del cajero.
                </span>
              </div>
            </div>
          )}

          {/* Bloque específico para VIOLACIÓN DE CONTROL INTERNO */}
          {selectedCase.sourceType === "violation" && (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded border border-destructive/20 bg-destructive/5 space-y-1">
                <span className="font-semibold text-destructive block">Regla infringida</span>
                <p className="text-foreground">
                  {selectedCase.violationMeta?.description || selectedCase.detail}
                </p>
              </div>
              <p className="text-muted-foreground">
                Las excepciones de control interno requieren revisión y justificación firmada para cerrar el período sin observaciones.
              </p>
            </div>
          )}
        </CardContent>

        {/* Acciones directas in-situ */}
        <CardFooter className="pt-3 border-t border-border/60 flex flex-col gap-2">
          {selectedCase.sourceType === "expense" ? (
            <div className="w-full flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                className="flex-1 h-9 text-xs font-semibold"
                onClick={handleApproveExpense}
                disabled={loadingAction}
              >
                {loadingAction ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                Aprobar Gasto
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => setRejectDialogOpen(true)}
                disabled={loadingAction}
              >
                <XCircle className="w-3.5 h-3.5 mr-1.5" />
                Rechazar
              </Button>
            </div>
          ) : (
            <Button variant="default" size="sm" asChild className="w-full h-9 text-xs font-semibold">
              <Link href={selectedCase.href}>
                Abrir registro completo <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Link>
            </Button>
          )}

          <Button variant="ghost" size="sm" asChild className="w-full h-7 text-xs text-muted-foreground">
            <Link href={selectedCase.href}>
              Ver en pantalla de origen <ExternalLink className="w-3 h-3 ml-1.5" />
            </Link>
          </Button>
        </CardFooter>
      </Card>

      {/* Diálogo de rechazo con motivo obligatorio */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold">Rechazar gasto operativo</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              Indica el motivo del rechazo. Quedará registrado en la bitácora de auditoría y se notificará al solicitante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-1.5">
            <Label htmlFor="rejectReason" className="text-xs font-medium">
              Motivo del rechazo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="rejectReason"
              placeholder="Ej. Falta factura con CFDI válido, excedió presupuesto de mantenimiento..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="text-xs h-24"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!rejectReason.trim() || loadingAction}
              onClick={handleRejectExpense}
            >
              {loadingAction ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirmar Rechazo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
