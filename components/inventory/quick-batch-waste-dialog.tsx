"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { InventoryBatch } from "@/hooks/queries/use-lots";
import { REASON_LABELS, type WasteReason } from "@/lib/inventory/waste-labels";

const WASTE_REASON_OPTIONS: { value: WasteReason; label: string }[] = Object.entries(REASON_LABELS).map(
  ([value, { label }]) => ({ value: value as WasteReason, label })
);

export function QuickBatchWasteDialog({
  batch,
  open,
  onOpenChange,
  onSuccess,
}: {
  batch: InventoryBatch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const [reason, setReason] = useState<WasteReason>("EXPIRED");
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!batch) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quantity || quantity <= 0) {
      toast.error("Ingresa una cantidad válida");
      return;
    }
    if (quantity > batch.currentQuantity) {
      toast.error(`La cantidad no puede superar el saldo del lote (${batch.currentQuantity} ${batch.itemUnit})`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/waste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: batch.branchId,
          itemId: batch.itemId,
          batchId: batch.id,
          quantity,
          unit: batch.itemUnit || "UNIT",
          reason,
          notes: notes || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.success || data.data?.waste)) {
        toast.success(`Merma registrada: ${quantity} ${batch.itemUnit} de ${batch.itemName}`, {
          description: `Se actualizó el saldo del lote ${batch.lotNumber || ""} y se registró el movimiento Kardex.`,
        });
        onOpenChange(false);
        setNotes("");
        onSuccess?.();
      } else {
        const errorMsg =
          typeof data.error === "object" && data.error?.message
            ? data.error.message
            : typeof data.error === "string"
              ? data.error
              : "Error al registrar merma en el lote";
        toast.error("No se pudo registrar la merma", { description: errorMsg });
      }
    } catch {
      toast.error("Error de conexión al registrar merma");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" /> Mandar Lote a Merma
          </DialogTitle>
          <DialogDescription className="text-xs">
            Registra descarte o merma para el lote <strong className="font-mono">{batch.lotNumber || "Sin folio"}</strong> de {batch.itemName}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 border rounded-lg bg-muted/30 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Producto:</span>
              <span className="font-medium">{batch.itemName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Saldo disponible en lote:</span>
              <span className="font-semibold font-mono text-foreground">
                {batch.currentQuantity.toLocaleString("es-MX")} {batch.itemUnit}
              </span>
            </div>
            {batch.expirationDate && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Caducidad registrada:</span>
                <span className="font-mono text-muted-foreground">
                  {new Date(batch.expirationDate).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="waste-reason">Motivo de Merma *</Label>
            <Select value={reason} onValueChange={(val) => setReason(val as WasteReason)}>
              <SelectTrigger id="waste-reason">
                <SelectValue placeholder="Seleccionar motivo" />
              </SelectTrigger>
              <SelectContent>
                {WASTE_REASON_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="waste-quantity">Cantidad a Dar de Baja ({batch.itemUnit}) *</Label>
            <div className="space-y-2">
              <Input
                id="waste-quantity"
                type="number"
                step="0.001"
                min="0.001"
                max={batch.currentQuantity}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="font-mono text-sm"
                required
              />
              <div className="flex flex-wrap gap-1.5">
                {[0.5, 1, 5].filter(s => s < batch.currentQuantity).map((step) => (
                  <Button
                    key={step}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-1.5 text-xs font-mono"
                    onClick={() => setQuantity((prev) => Math.min(batch.currentQuantity, +(prev + step).toFixed(3)))}
                  >
                    +{step}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-6 px-2 text-xs font-mono"
                  onClick={() => setQuantity(batch.currentQuantity)}
                >
                  Todo el lote ({batch.currentQuantity})
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="waste-notes">Notas / Justificación</Label>
            <Input
              id="waste-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Caducado / daño en refrigerador"
              className="text-xs"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar Merma
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
