"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCw, Upload, Loader2, DollarSign } from "lucide-react";

interface PettyCashRegisterProps {
  branches: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

export function PettyCashRegister({ branches, onSuccess }: PettyCashRegisterProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"OUT" | "REPLENISHMENT">("OUT");
  const [branchId, setBranchId] = useState<string>(branches[0]?.id || "");
  const [amount, setAmount] = useState<string>("");
  const [concept, setConcept] = useState<string>("");
  const [category, setCategory] = useState<string>("OTROS");
  const [notes, setNotes] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) {
      toast({ title: "Error", description: "Selecciona una sucursal.", variant: "destructive" });
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({ title: "Error", description: "Ingresa un monto válido mayor a $0.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const amountCents = Math.round(parsedAmount * 100);

      const body =
        mode === "REPLENISHMENT"
          ? { type: "REPLENISHMENT", branchId, amountCents, notes }
          : { type: "OUT", branchId, amountCents, concept, category, authorizationNotes: notes };

      const res = await fetch("/api/petty-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Error al procesar movimiento de caja chica.");
      }

      toast({
        title: mode === "REPLENISHMENT" ? "Fondo Repuesto" : "Retiro Registrado",
        description: `Movimiento por $${parsedAmount.toLocaleString("es-MX")} MXN procesado correctamente.`,
      });

      setAmount("");
      setConcept("");
      setNotes("");
      setOpen(false);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Error al registrar movimiento.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="flex gap-2">
          <Button onClick={() => setMode("OUT")}>
            <Plus className="w-4 h-4 mr-2" /> Registrar Retiro
          </Button>
          <Button variant="outline" onClick={() => setMode("REPLENISHMENT")}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reponer Fondo
          </Button>
        </div>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <DollarSign className="w-5 h-5 text-primary" />
            {mode === "REPLENISHMENT" ? "Reposición de Fondo de Caja Chica" : "Registrar Retiro de Caja Chica"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mode === "REPLENISHMENT"
              ? "Agrega saldo al fondo de caja chica de la sucursal."
              : "Descuenta efectivo de caja chica respaldado con justificación."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="branch">Sucursal</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="branch">
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
            <Label htmlFor="amount">Monto ($ MXN)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {mode === "OUT" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="concept">Concepto / Motivo</Label>
                <Input
                  id="concept"
                  placeholder="ej. Insumos de emergencia, taxi, repuesto de gas"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Categoría</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANTENIMIENTO">Mantenimiento</SelectItem>
                    <SelectItem value="SERVICIOS">Servicios</SelectItem>
                    <SelectItem value="PUBLICIDAD">Publicidad</SelectItem>
                    <SelectItem value="SERVICIOS_PROFESIONALES">Servicios Profesionales</SelectItem>
                    <SelectItem value="OTROS">Otros Gastos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notas o Justificación de Autorización</Label>
            <Input
              id="notes"
              placeholder="ej. Autorizado por gerente de turno"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === "REPLENISHMENT" ? "Reponer Fondo" : "Confirmar Retiro"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
