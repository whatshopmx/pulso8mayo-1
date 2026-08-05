"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Receipt, Loader2, ImagePlus, X, Check } from "lucide-react";

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
  const [evidenceUrl, setEvidenceUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/expenses/evidence", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Error al subir la evidencia.");
      }
      setEvidenceUrl(data.data.url);
      toast({ title: "Evidencia adjunta", description: "Foto del ticket subida correctamente." });
    } catch (err: any) {
      toast({
        title: "No se pudo subir la evidencia",
        description: err.message || "Revisa tu conexión e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

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
          evidenceUrl: evidenceUrl || undefined,
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
      setEvidenceUrl("");
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
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) {
        // Reabrir limpio: no arrastrar foto/montos de un intento cancelado.
        setAmount("");
        setDescription("");
        setDueDate("");
        setEvidenceUrl("");
      }
    }}>
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

          <div className="space-y-2">
            <Label>Evidencia / Ticket (opcional)</Label>
            <div className="flex items-center gap-2">
              <label
                htmlFor="expense-evidence"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-dashed text-xs cursor-pointer hover:bg-muted/60 transition"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : evidenceUrl ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
                {uploading ? "Subiendo…" : evidenceUrl ? "Foto adjunta" : "Subir foto del ticket"}
              </label>
              <input
                id="expense-evidence"
                type="file"
                accept="image/*,.pdf"
                className="sr-only"
                onChange={handleFileSelect}
                disabled={uploading || loading}
              />
              {evidenceUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setEvidenceUrl("")}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Foto del comprobante (hielo, ferretería, taxi, plomero) que sustituye la libreta.
            </p>
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
