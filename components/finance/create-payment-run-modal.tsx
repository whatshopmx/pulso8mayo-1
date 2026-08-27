"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

interface CreatePaymentRunModalProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function CreatePaymentRunModal({ onSuccess, trigger }: CreatePaymentRunModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [runDate, setRunDate] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !runDate) return;

    setLoading(true);
    try {
      const res = await fetch("/api/finance/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_PAYMENT_RUN",
          payload: {
            title,
            runDate,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Corrida de pago creada", {
          description: "La corrida se ha creado en estatus borrador.",
        });
        setOpen(false);
        setTitle("");
        setRunDate("");
        if (onSuccess) onSuccess();
      } else {
        toast.error("Error al crear", { description: json.error || "Ocurrió un error inesperado." });
      }
    } catch (err) {
      toast.error("Error de red", { description: "No se pudo conectar al servidor." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" /> Crear Corrida
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Nueva Corrida de Pago</DialogTitle>
            <DialogDescription>
              Programa una nueva corrida para agrupar facturas y pagos de nómina.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Título de la Corrida</Label>
              <Input
                id="title"
                placeholder="Ej. Nómina Q1 Agosto"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="runDate">Fecha de Ejecución</Label>
              <Input
                id="runDate"
                type="date"
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
