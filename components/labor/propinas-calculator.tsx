"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Coins, Plus, Loader2 } from "lucide-react";

interface PropinasCalculatorProps {
  branches: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

export function PropinasCalculator({ branches, onSuccess }: PropinasCalculatorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState<string>(branches[0]?.id || "");
  const [shift, setShift] = useState<"MATUTINO" | "VESPERTINO" | "COMPLETO">("MATUTINO");
  const [businessDate, setBusinessDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [totalPool, setTotalPool] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) {
      toast({ title: "Error", description: "Selecciona una sucursal.", variant: "destructive" });
      return;
    }
    const parsedPool = parseFloat(totalPool);
    if (isNaN(parsedPool) || parsedPool <= 0) {
      toast({ title: "Error", description: "Ingresa un pozo de propinas válido mayor a $0.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/propinas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          businessDate,
          shift,
          totalPoolCents: Math.round(parsedPool * 100),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Error al calcular propinas.");
      }

      toast({
        title: "Propinas Distribuidas",
        description: `Pozo de $${parsedPool.toLocaleString("es-MX")} MXN distribuido entre ${data.data.staffCount} empleados (${(data.data.perStaffAmountCents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} c/u).`,
      });

      setTotalPool("");
      setOpen(false);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "No se pudo calcular la distribución.",
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
          <Coins className="w-4 h-4 mr-2" /> Distribuir Propinas del Turno
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Coins className="w-5 h-5 text-amber-600" /> Registro de Pozo de Propinas
          </DialogTitle>
          <DialogDescription className="text-xs">
            Registra el pozo en efectivo recibido durante el turno. Se distribuirá proporcionalmente al personal en turno de acuerdo a la LFT (Art. 346).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="propina-branch">Sucursal</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="propina-branch">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="propina-date">Fecha</Label>
              <Input
                id="propina-date"
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="propina-shift">Turno</Label>
              <Select value={shift} onValueChange={(val) => setShift(val as any)}>
                <SelectTrigger id="propina-shift">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MATUTINO">Matutino</SelectItem>
                  <SelectItem value="VESPERTINO">Vespertino</SelectItem>
                  <SelectItem value="COMPLETO">Completo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="propina-pool">Pozo Total de Propinas ($ MXN)</Label>
            <Input
              id="propina-pool"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={totalPool}
              onChange={(e) => setTotalPool(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Calcular Distribución
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
