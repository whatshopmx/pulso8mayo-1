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
import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, AlertTriangle } from "lucide-react";

interface PeriodCloseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number;
  month: number;
  isClosed: boolean;
  onConfirm: () => Promise<void>;
}

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function PeriodCloseDialog({
  open,
  onOpenChange,
  year,
  month,
  isClosed,
  onConfirm,
}: PeriodCloseDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  const monthName = MONTH_NAMES[month - 1] || `Mes ${month}`;
  const actionText = isClosed ? "REABRIR" : "CERRAR";

  const handleAction = async () => {
    if (confirmText.toUpperCase() !== actionText) return;
    setLoading(true);
    try {
      await onConfirm();
      setConfirmText("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isClosed ? (
              <>
                <Unlock className="h-5 w-5 text-amber-500" /> Reabrir Periodo Financiero
              </>
            ) : (
              <>
                <Lock className="h-5 w-5 text-destructive" /> Cerrar Periodo Financiero
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {monthName} {year}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3 text-sm">
          {!isClosed ? (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 space-y-2 text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> ¡Atención!
              </div>
              <p className="text-xs leading-relaxed">
                Al cerrar el periodo mensual, **ningún usuario podrá registrar ni modificar
                gastos, cortes de venta ni recepciones** correspondientes a {monthName} {year}.
                Se congelará automáticamente el P&L mensual.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-blue-500/20 bg-blue-500/10 p-3 text-blue-900 dark:text-blue-200 text-xs leading-relaxed">
              Reabrir el periodo permitirá nuevamente modificaciones en gastos y ventas de {monthName} {year}.
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Para confirmar, escribe <strong className="text-foreground">{actionText}</strong> a continuación:
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Escribe ${actionText}`}
              className="font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant={isClosed ? "default" : "destructive"}
            onClick={handleAction}
            disabled={confirmText.toUpperCase() !== actionText || loading}
          >
            {loading ? "Procesando..." : `${isClosed ? "Reabrir" : "Cerrar"} Periodo`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
