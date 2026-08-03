"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Receipt, Loader2 } from "lucide-react";

interface ExpenseFormProps {
  branches: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

export function ExpenseForm({ branches, onSuccess }: ExpenseFormProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState<string>(branches[0]?.id || "");
  const [category, setCategory] = useState<string>("RENTA");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) {
      toast({ title: "Error", description: "Selecciona una sucursal.", variant: "destructive" });
      return;
    }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      toast({ title: "Error", description: "Ingresa un monto válido.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          category,
          amountCents: Math.round(parsed * 100),
          description,
          dueDate: dueDate || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Error al registrar gasto.");
      }

      toast({
        title: "Gasto Registrado",
        description:
          data.data.status === "APPROVED"
            ? "El gasto ha sido auto-aprobado exitosamente."
            : "El gasto se ha registrado y requiere aprobación de gerencia.",
      });

      setAmount("");
      setDescription("");
      setDueDate("");
      setOpen(false);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "No se pudo guardar el gasto.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" /> Nuevo Gasto Operativo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Receipt className="w-5 h-5 text-primary" /> Registrar Gasto Operativo
          </DialogTitle>
          <DialogDescription className="text-xs">
            Registra gastos recurrentes (renta, luz, gas, mantenimientos) sujetando el flujo a reglas de autorización.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="expense-branch">Sucursal</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="expense-branch">
                <SelectValue placeholder="Selecciona sucursal" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-cat">Categoría</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="expense-cat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RENTA">Renta de Inmueble</SelectItem>
                <SelectItem value="SERVICIOS">Servicios (Luz, Agua, Gas, Internet)</SelectItem>
                <SelectItem value="MANTENIMIENTO">Mantenimiento de Equipos</SelectItem>
                <SelectItem value="PUBLICIDAD">Publicidad y Marketing</SelectItem>
                <SelectItem value="SERVICIOS_PROFESIONALES">Servicios Profesionales</SelectItem>
                <SelectItem value="OTROS">Otros Gastos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-amount">Monto ($ MXN)</Label>
            <Input
              id="expense-amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-desc">Descripción / Concepto</Label>
            <Input
              id="expense-desc"
              placeholder="ej. Pago de energía eléctrica bimestre Julio-Agosto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-due">Fecha de Vencimiento (opcional)</Label>
            <Input
              id="expense-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Guardar Gasto
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
