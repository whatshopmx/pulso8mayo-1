"use client";

import { useState, useEffect } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Building2 } from "lucide-react";
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
  const [branchId, setBranchId] = useState("ALL");
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (open) {
      fetch("/api/branches")
        .then((res) => res.json())
        .then((json) => {
          if (json.success && Array.isArray(json.data)) {
            setBranches(json.data);
          }
        })
        .catch(() => {});
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !runDate) {
      toast.error("Campos incompletos", { description: "Por favor proporciona un título y fecha de ejecución." });
      return;
    }

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
            branchId: branchId === "ALL" ? null : branchId,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Corrida de pago creada", {
          description: "La corrida se ha creado en estatus borrador. Ya puedes agregar ítems.",
        });
        setOpen(false);
        setTitle("");
        setRunDate("");
        setBranchId("ALL");
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
              Programa una nueva corrida para agrupar facturas conciliadas, nómina y servicios operativos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="branchId" className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Sucursal Destino
              </Label>
              <div className="min-w-0">
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger id="branchId" className="w-full min-w-0">
                    <SelectValue placeholder="Selecciona sucursal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas las sucursales (Consolidado)</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="title">Título de la Corrida</Label>
              <Input
                id="title"
                placeholder="Ej. Nómina Q1 Septiembre ó Proveedores Cárnicos"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  className="text-xs bg-muted hover:bg-muted/80 text-muted-foreground px-2 py-0.5 rounded border border-border/40 transition-colors"
                  onClick={() => setTitle("Nómina Quincenal")}
                >
                  + Nómina
                </button>
                <button
                  type="button"
                  className="text-xs bg-muted hover:bg-muted/80 text-muted-foreground px-2 py-0.5 rounded border border-border/40 transition-colors"
                  onClick={() => setTitle("Proveedores Alimentos & Bebidas")}
                >
                  + Proveedores A&B
                </button>
                <button
                  type="button"
                  className="text-xs bg-muted hover:bg-muted/80 text-muted-foreground px-2 py-0.5 rounded border border-border/40 transition-colors"
                  onClick={() => setTitle("Servicios & Renta")}
                >
                  + Servicios & Renta
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="runDate">Fecha Programada de Dispersión</Label>
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
              Guardar Corrida
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
