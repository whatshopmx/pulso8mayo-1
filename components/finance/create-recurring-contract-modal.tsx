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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

interface CreateRecurringContractModalProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function CreateRecurringContractModal({ onSuccess, trigger }: CreateRecurringContractModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [title, setTitle] = useState("");
  const [contractType, setContractType] = useState("RENTA");
  const [baseAmount, setBaseAmount] = useState("");
  const [startDate, setStartDate] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !baseAmount || !startDate) return;

    setLoading(true);
    try {
      const res = await fetch("/api/finance/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_RECURRING_CONTRACT",
          payload: {
            title,
            contractType,
            baseAmountCents: Math.round(parseFloat(baseAmount) * 100),
            startDate,
            // Supplier ID is mocked for this modal since it requires a supplier selector in a real environment
            supplierId: "00000000-0000-0000-0000-000000000000",
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Contrato registrado", {
          description: "El gasto recurrente ha sido registrado exitosamente.",
        });
        setOpen(false);
        setTitle("");
        setBaseAmount("");
        setStartDate("");
        setContractType("RENTA");
        if (onSuccess) onSuccess();
      } else {
        toast.error("Error al registrar", { description: json.error || "Ocurrió un error inesperado." });
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
            <Plus className="mr-2 h-4 w-4" /> Nuevo Contrato
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Registrar Gasto Recurrente</DialogTitle>
            <DialogDescription>
              Da de alta un contrato para monitorear varianzas de cobro mensual o anual.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Concepto</Label>
              <Input
                id="title"
                placeholder="Ej. Renta Local Centro"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contractType">Tipo de Gasto</Label>
                <Select value={contractType} onValueChange={setContractType}>
                  <SelectTrigger id="contractType">
                    <SelectValue placeholder="Selecciona..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RENTA">Renta</SelectItem>
                    <SelectItem value="SERVICIO_BASICO">Servicio Básico (CFE/Agua)</SelectItem>
                    <SelectItem value="MANTENIMIENTO">Mantenimiento</SelectItem>
                    <SelectItem value="SOFTWARE">Software / Licencias</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="baseAmount">Monto Base Mensual</Label>
                <Input
                  id="baseAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={baseAmount}
                  onChange={(e) => setBaseAmount(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="startDate">Fecha de Inicio / Próximo Cobro</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
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
