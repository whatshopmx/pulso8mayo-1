"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Loader2, Plus, Building2, AlertCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatCents } from "@/lib/utils";

export interface CreatePaymentRunInitialItem {
  itemType: "INVOICE" | "OPERATING_EXPENSE";
  referenceId: string;
  amountCents: number;
  reference: string;
  counterparty: string;
}

interface CreatePaymentRunModalProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialItems?: CreatePaymentRunInitialItem[];
  defaultBranchId?: string;
}

export function CreatePaymentRunModal({
  onSuccess,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialItems,
  defaultBranchId,
}: CreatePaymentRunModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(val);
    } else {
      setInternalOpen(val);
    }
  };

  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [runDate, setRunDate] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId || "ALL");
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

  const initialTotalCents = useMemo(
    () => initialItems?.reduce((sum, it) => sum + it.amountCents, 0) ?? 0,
    [initialItems]
  );

  useEffect(() => {
    if (open && initialItems && initialItems.length > 0 && !title) {
      const todayStr = new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
      setTitle(`Lote ${todayStr} (${initialItems.length} partidas)`);
    }
    if (open && !runDate) {
      setRunDate(new Date().toISOString().slice(0, 10));
    }
  }, [open, initialItems, title, runDate]);

  const isPastDate = useMemo(() => {
    if (!runDate) return false;
    const selected = new Date(runDate + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selected < today;
  }, [runDate]);

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
            items:
              initialItems && initialItems.length > 0
                ? initialItems.map((it) => ({
                    itemType: it.itemType,
                    referenceId: it.referenceId,
                    amountCents: it.amountCents,
                  }))
                : undefined,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          initialItems && initialItems.length > 0
            ? "Lote de pago programado"
            : "Corrida de pago creada",
          {
            description:
              initialItems && initialItems.length > 0
                ? `Se agregaron ${initialItems.length} partidas con cuentas congeladas.`
                : "La corrida se ha creado en estatus borrador. Ya puedes agregar ítems.",
          }
        );
        setOpen(false);
        setTitle("");
        setRunDate("");
        setBranchId(defaultBranchId || "ALL");
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
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      {!trigger && !isControlled && (
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" /> Crear Corrida
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialItems && initialItems.length > 0 ? "Programar Lote de Pago" : "Nueva Corrida de Pago"}
            </DialogTitle>
            <DialogDescription>
              {initialItems && initialItems.length > 0
                ? "Crea una corrida con las partidas seleccionadas y congela las cuentas destino."
                : "Programa una nueva corrida para agrupar facturas conciliadas, nómina y servicios operativos."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {initialItems && initialItems.length > 0 && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-primary">
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    Lote con {initialItems.length} partida{initialItems.length === 1 ? "" : "s"} ({formatCents(initialTotalCents)})
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Se congelará la cuenta bancaria verificada activa de cada contraparte en la partida para garantizar el destino de pago sin alteraciones posteriores.
                </p>
              </div>
            )}
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
                  className="text-xs bg-muted hover:bg-muted/80 text-muted-foreground px-2 py-0.5 rounded border border-border/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Autocompletar título con Nómina Quincenal"
                  onClick={() => setTitle("Nómina Quincenal")}
                >
                  + Nómina
                </button>
                <button
                  type="button"
                  className="text-xs bg-muted hover:bg-muted/80 text-muted-foreground px-2 py-0.5 rounded border border-border/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Autocompletar título con Proveedores Alimentos & Bebidas"
                  onClick={() => setTitle("Proveedores Alimentos & Bebidas")}
                >
                  + Proveedores A&B
                </button>
                <button
                  type="button"
                  className="text-xs bg-muted hover:bg-muted/80 text-muted-foreground px-2 py-0.5 rounded border border-border/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Autocompletar título con Servicios & Renta"
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
              {isPastDate && (
                <div className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-md">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>Fecha en el pasado. Se registrará como dispersión extemporánea.</span>
                </div>
              )}
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
