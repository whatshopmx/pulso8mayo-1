"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Receipt, Loader2, ImagePlus, X, Check, UserPlus, Building2 } from "lucide-react";

interface ExpenseFormProps {
  branches: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

interface Payee {
  id: string;
  name: string;
  taxId: string | null;
}

/** Valor centinela del Select para "sin contraparte" (el gasto casual). */
const NO_PAYEE = "__none__";

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

  // Contrapartes (Fase 1 — tasks/plan-payees-contrapartes.md). El campo es
  // OPCIONAL: un gasto casual (taxi, hielo) no debe forzar el catálogo.
  const [payees, setPayees] = useState<Payee[]>([]);
  const [payeeId, setPayeeId] = useState<string>(NO_PAYEE);
  const [payeesLoading, setPayeesLoading] = useState(false);
  // Creación al vuelo: un mini-form dentro del mismo diálogo, no otra página.
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newPayeeName, setNewPayeeName] = useState("");
  const [newPayeeTaxId, setNewPayeeTaxId] = useState("");
  const [creatingPayee, setCreatingPayee] = useState(false);

  const loadPayees = async () => {
    setPayeesLoading(true);
    try {
      const res = await fetch("/api/finance/payees");
      const data = await res.json();
      if (res.ok && data.success) {
        setPayees(data.data || []);
      }
      // Sin toast: el catálogo es apoyo, no debe romper la captura si cae.
    } catch (err) {
      console.error("Error fetching payees:", err);
    } finally {
      setPayeesLoading(false);
    }
  };

  useEffect(() => {
    loadPayees();
  }, []);

  const handleCreatePayee = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPayeeName.trim();
    if (!name) {
      toast({ title: "Error", description: "El nombre de la contraparte es obligatorio.", variant: "destructive" });
      return;
    }
    setCreatingPayee(true);
    try {
      const res = await fetch("/api/finance/payees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, taxId: newPayeeTaxId.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "No se pudo crear la contraparte.");
      }
      const created = data.data;
      setPayees((prev) => [...prev, created]);
      setPayeeId(created.id);
      setShowQuickCreate(false);
      setNewPayeeName("");
      setNewPayeeTaxId("");
      toast({ title: "Contraparte creada", description: `"${created.name}" quedó seleccionada en este gasto.` });
    } catch (err: any) {
      toast({
        title: "No se pudo crear la contraparte",
        description: err.message || "Revisa e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setCreatingPayee(false);
    }
  };

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
          payeeId: payeeId !== NO_PAYEE ? payeeId : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Error al registrar gasto.");
      }

      // A16 — la rama "auto-aprobado" era código muerto desde que el servicio
      // dejó de aprobar al crear: todo gasto entra a la cola y lo resuelve
      // alguien distinto de quien lo registró.
      toast({
        title: "Gasto Registrado",
        description: "El gasto se ha registrado y requiere aprobación de gerencia.",
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

  const resetPayeeState = () => {
    setPayeeId(NO_PAYEE);
    setShowQuickCreate(false);
    setNewPayeeName("");
    setNewPayeeTaxId("");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) {
        // Reabrir limpio: no arrastrar foto/montos/contraparte de un intento cancelado.
        setAmount("");
        setDescription("");
        setDueDate("");
        setEvidenceUrl("");
        resetPayeeState();
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
            <Label htmlFor="expense-payee">A quién le pagas (opcional)</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select
                  value={payeeId}
                  onValueChange={(v) => {
                    // Radix sintetiza onChange("") cuando el value apunta a un
                    // item recién agregado (la option nativa se registra un
                    // layout-effect después del commit; el navegador reencauza
                    // el select oculto a "" y React lo reporta). No existe item
                    // con valor vacío, así que "" nunca es una selección real:
                    // se ignora para no pisar la contraparte elegida.
                    if (v === "") return;
                    setPayeeId(v);
                  }}
                  disabled={payeesLoading}
                >
                  <SelectTrigger id="expense-payee">
                    <SelectValue placeholder="Sin contraparte" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PAYEE}>Sin contraparte (gasto casual)</SelectItem>
                    {payees.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1"
                onClick={() => setShowQuickCreate((v) => !v)}
              >
                <UserPlus className="w-3.5 h-3.5" /> Nueva
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              La renta, la luz y el contador tienen contraparte fija; el taxi o el hielo de hoy, no.
            </p>
          </div>

          {showQuickCreate && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Building2 className="w-3.5 h-3.5 text-primary" /> Nueva contraparte
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-payee-name" className="text-xs">Nombre</Label>
                <Input
                  id="quick-payee-name"
                  placeholder="ej. Inmobiliaria Condesa, CFE, Contador Alanís"
                  value={newPayeeName}
                  onChange={(e) => setNewPayeeName(e.target.value)}
                  disabled={creatingPayee}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-payee-taxid" className="text-xs">RFC (opcional)</Label>
                <Input
                  id="quick-payee-taxid"
                  placeholder="ej. XXXX000000XXX — solo si emite CFDI"
                  value={newPayeeTaxId}
                  onChange={(e) => setNewPayeeTaxId(e.target.value)}
                  disabled={creatingPayee}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={creatingPayee}
                  onClick={() => {
                    setShowQuickCreate(false);
                    setNewPayeeName("");
                    setNewPayeeTaxId("");
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreatePayee}
                  disabled={creatingPayee}
                >
                  {creatingPayee && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Crear y seleccionar
                </Button>
              </div>
            </div>
          )}

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
            <p className="text-xs text-muted-foreground">
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