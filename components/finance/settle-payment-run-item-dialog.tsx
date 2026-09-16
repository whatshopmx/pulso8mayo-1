"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

export interface SettleableRunItem {
  id: string;
  itemType: string;
  amountCents: number;
  referenceId: string;
  settlementStatus?: "PENDING" | "CONFIRMED" | "FAILED" | string;
  settlementReference?: string | null;
  failureReason?: string | null;
  notes?: string | null;
  invoiceDetails?: {
    folio?: string | null;
    rfcEmisor?: string | null;
    nombreEmisor?: string | null;
  } | null;
  payrollDetails?: {
    periodStart?: string | null;
    periodEnd?: string | null;
  } | null;
  expenseDetails?: {
    description?: string | null;
    category?: string | null;
  } | null;
}

interface SettlePaymentRunItemDialogProps {
  runId: string;
  item: SettleableRunItem | null;
  mode: "CONFIRM" | "REJECT" | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettled: () => void;
}

export function SettlePaymentRunItemDialog({
  runId,
  item,
  mode,
  open,
  onOpenChange,
  onSettled,
}: SettlePaymentRunItemDialogProps) {
  const [reference, setReference] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!item || !mode) return null;

  const isConfirm = mode === "CONFIRM";
  const itemLabel =
    item.itemType === "INVOICE"
      ? `Factura ${item.invoiceDetails?.folio ? `FAC-${item.invoiceDetails.folio}` : item.referenceId.slice(0, 8)} ${item.invoiceDetails?.nombreEmisor ? `(${item.invoiceDetails.nombreEmisor})` : ""}`
      : item.itemType === "PAYROLL"
        ? `Nómina (${item.payrollDetails?.periodStart ? new Date(item.payrollDetails.periodStart).toLocaleDateString("es-MX") : "Período"})`
        : item.expenseDetails?.description || `Partida ${item.referenceId.slice(0, 8)}`;

  const formattedAmount = (item.amountCents / 100).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isConfirm && !reference.trim()) {
      toast.error("Referencia obligatoria", {
        description:
          "Para confirmar el pago captura el folio, clave de rastreo o referencia del comprobante SPEI.",
      });
      return;
    }

    if (!isConfirm && !failureReason.trim()) {
      toast.error("Motivo obligatorio", {
        description:
          "Indica por qué fue devuelta la transferencia para que la partida pueda corregirse.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/finance/treasury/runs/${runId}/items/${item.id}/settle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settlementStatus: isConfirm ? "CONFIRMED" : "FAILED",
            reference: isConfirm ? reference.trim() : null,
            failureReason: !isConfirm ? failureReason.trim() : null,
            notes: notes.trim() || null,
          }),
        }
      );

      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error || json.message || "Error al liquidar la partida."
        );
      }

      toast.success(
        isConfirm
          ? "Pago de partida confirmado"
          : "Rechazo registrado",
        {
          description: isConfirm
            ? `Se saldó la obligación de ${formattedAmount}.`
            : `La deuda de ${formattedAmount} se mantiene viva para una futura corrida.`,
        }
      );

      // Reset and notify
      setReference("");
      setFailureReason("");
      setNotes("");
      onOpenChange(false);
      onSettled();
    } catch (error: any) {
      toast.error("Error en la liquidación", {
        description: error.message || "No se pudo actualizar la partida.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {isConfirm ? (
                <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              ) : (
                <div className="p-2 rounded-md bg-destructive/10 text-destructive">
                  <XCircle className="h-5 w-5" />
                </div>
              )}
              <div>
                <DialogTitle className="text-lg font-semibold">
                  {isConfirm
                    ? "Confirmar Pago con Comprobante"
                    : "Registrar Rechazo Bancario"}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {isConfirm
                    ? "Saldar la partida y asentar el comprobante bancario correspondiente."
                    : "Registrar devolución del banco sin dar por saldada la deuda."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Resumen de la partida */}
          <div className="p-3 bg-muted/50 rounded-lg border border-border/60 text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Concepto:</span>
              <span className="font-medium text-foreground truncate max-w-[240px]">
                {itemLabel}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Importe:</span>
              <span className="font-semibold text-foreground text-sm">
                {formattedAmount}
              </span>
            </div>
            {item.settlementStatus === "FAILED" && isConfirm && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1 border-t border-border/40 mt-1">
                Corrige el rechazo anterior: el comprobante saldará la obligación pendiente.
              </p>
            )}
          </div>

          {isConfirm ? (
            <div className="space-y-2">
              <Label htmlFor="reference" className="text-xs font-medium">
                Folio / Clave de Rastreo SPEI / Referencia <span className="text-destructive">*</span>
              </Label>
              <Input
                id="reference"
                placeholder="Ej. 202609151234567890 o Folio 98412"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                autoFocus
                disabled={isSubmitting}
                className="text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Dato indispensable para contrastar la salida contra el estado de cuenta.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  La partida no se marcará como pagada. La factura o gasto seguirá en cuentas por pagar para reprogramarse en un nuevo lote.
                </span>
              </div>
              <Label htmlFor="failureReason" className="text-xs font-medium">
                Motivo del Rechazo del Banco <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="failureReason"
                placeholder="Ej. Cuenta beneficiaria bloqueada, CLABE no coincide con RFC emisor, o saldo insuficiente."
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                autoFocus
                disabled={isSubmitting}
                rows={2}
                className="text-sm resize-none"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes" className="text-xs font-medium text-muted-foreground">
              Notas adicionales (opcional)
            </Label>
            <Input
              id="notes"
              placeholder="Detalle operativo relevante..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              className="text-xs"
            />
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={isConfirm ? "default" : "destructive"}
              disabled={isSubmitting}
              className={isConfirm ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isConfirm ? "Confirmar Pago" : "Registrar Rechazo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
