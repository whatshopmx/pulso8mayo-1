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
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Clock, Building2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ConfirmRemediationDialogProps {
  action: {
    id: string;
    incidentId: string;
    serviceType: string;
    serviceName?: string | null;
    incidentTitle?: string | null;
    incidentSeverity?: string | null;
    createdAt?: string | Date;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ConfirmRemediationDialog({
  action,
  open,
  onOpenChange,
  onSuccess,
}: ConfirmRemediationDialogProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  if (!action) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      toast.error("Por favor selecciona una fecha de visita");
      return;
    }

    try {
      setLoading(true);
      const scheduledDate = new Date(`${date}T${time}:00`);
      if (isNaN(scheduledDate.getTime())) {
        toast.error("Fecha u hora inválida");
        setLoading(false);
        return;
      }

      if (scheduledDate < new Date()) {
        toast.error("La fecha programada debe ser en el futuro");
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/remediation/actions/${action.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledDate: scheduledDate.toISOString(),
          notes,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al confirmar la visita");
      }

      toast.success("Visita de proveedor confirmada y workflow programado exitosamente");
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Error al confirmar la visita");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Calendar className="w-5 h-5 text-amber-500" />
            Confirmar Visita de Proveedor Extero
          </DialogTitle>
          <DialogDescription>
            Programa la fecha y hora en que el proveedor realizará el servicio de remediación para resolver el incidente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirm} className="space-y-4 py-2">
          {/* Incident summary banner */}
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg space-y-1">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-800 dark:text-amber-300">
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {action.incidentSeverity || "HIGH"} PRIORITY
              </span>
              <span>{action.serviceType}</span>
            </div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {action.incidentTitle || `Requerimiento de ${action.serviceType}`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date" className="flex items-center gap-1.5 text-sm font-medium">
                <Calendar className="w-4 h-4 text-muted-foreground" /> Fecha de Visita
              </Label>
              <Input
                id="date"
                type="date"
                min={new Date().toISOString().split("T")[0]}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="time" className="flex items-center gap-1.5 text-sm font-medium">
                <Clock className="w-4 h-4 text-muted-foreground" /> Hora
              </Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes" className="text-sm font-medium">
              Instrucciones / Notas para el Personal
            </Label>
            <Textarea
              id="notes"
              placeholder="Ej. El proveedor llegará a las 10:00 AM. Asegurar acceso a cocina y almacén."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="bg-amber-600 hover:bg-amber-700 text-white">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Programando...
                </>
              ) : (
                "Confirmar y Programar Workflow"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
