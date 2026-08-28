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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Building2, Store } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/lib/branch-context";

interface CreateRecurringContractModalProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

interface Supplier {
  id: string;
  name: string;
  taxId?: string;
}

export function CreateRecurringContractModal({ onSuccess, trigger }: CreateRecurringContractModalProps) {
  const { branches, selectedBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  
  const [title, setTitle] = useState("");
  const [contractType, setContractType] = useState("RENTA");
  const [baseAmount, setBaseAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [branchId, setBranchId] = useState<string>(selectedBranchId || "ALL");
  const [paymentFrequency, setPaymentFrequency] = useState<string>("MONTHLY");

  useEffect(() => {
    if (open) {
      loadSuppliers();
      if (selectedBranchId) {
        setBranchId(selectedBranchId);
      }
    }
  }, [open, selectedBranchId]);

  const loadSuppliers = async () => {
    setLoadingSuppliers(true);
    try {
      const res = await fetch("/api/inventory/suppliers");
      const json = await res.json();
      if (res.ok && json.suppliers) {
        setSuppliers(json.suppliers);
        if (json.suppliers.length > 0 && !supplierId) {
          setSupplierId(json.suppliers[0].id);
        }
      }
    } catch (e) {
      console.error("Error al cargar proveedores:", e);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !baseAmount || !startDate) {
      toast.error("Campos incompletos", { description: "Por favor llena todos los campos obligatorios." });
      return;
    }

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
            supplierId: supplierId || (suppliers[0]?.id ?? "00000000-0000-0000-0000-000000000000"),
            branchId: branchId === "ALL" ? null : branchId,
            paymentFrequency,
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
        setPaymentFrequency("MONTHLY");
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
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Registrar Gasto Recurrente</DialogTitle>
            <DialogDescription>
              Da de alta un contrato para monitorear varianzas de cobro mensual, quincenal o anual contra CFDI recibidos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Concepto / Nombre del Contrato</Label>
              <Input
                id="title"
                placeholder="Ej. Renta Local Roma Norte"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="supplierId" className="truncate">Proveedor / Contraparte</Label>
                {loadingSuppliers ? (
                  <div className="flex items-center h-9 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Cargando...
                  </div>
                ) : (
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger id="supplierId" className="text-xs w-full min-w-0">
                      <SelectValue placeholder="Selecciona proveedor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.length === 0 ? (
                        <SelectItem value="none" disabled>
                          Sin proveedores registrados
                        </SelectItem>
                      ) : (
                        suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} {s.taxId ? `(${s.taxId})` : ""}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="grid gap-2 min-w-0">
                <Label htmlFor="branchId" className="truncate">Sucursal Asignada</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger id="branchId" className="text-xs w-full min-w-0">
                    <SelectValue placeholder="Todas las sucursales" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3 w-3 text-muted-foreground" /> Todas / Corporativo
                      </span>
                    </SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="flex items-center gap-1.5">
                          <Store className="h-3 w-3 text-muted-foreground" /> {b.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="contractType" className="truncate">Tipo de Gasto</Label>
                <Select value={contractType} onValueChange={setContractType}>
                  <SelectTrigger id="contractType" className="text-xs w-full min-w-0">
                    <SelectValue placeholder="Selecciona..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RENTA">Renta de Local</SelectItem>
                    <SelectItem value="SERVICIO_BASICO">Servicios Básicos (CFE/Agua)</SelectItem>
                    <SelectItem value="MANTENIMIENTO">Mantenimiento</SelectItem>
                    <SelectItem value="SOFTWARE">Licencias / SaaS</SelectItem>
                    <SelectItem value="OTHER">Otro / Varios</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2 min-w-0">
                <Label htmlFor="paymentFrequency" className="truncate">Periodicidad de Pago</Label>
                <Select value={paymentFrequency} onValueChange={setPaymentFrequency}>
                  <SelectTrigger id="paymentFrequency" className="text-xs w-full min-w-0">
                    <SelectValue placeholder="Periodicidad..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Mensual</SelectItem>
                    <SelectItem value="BIWEEKLY">Quincenal</SelectItem>
                    <SelectItem value="QUARTERLY">Trimestral</SelectItem>
                    <SelectItem value="ANNUAL">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="baseAmount" className="truncate">Monto Base ({paymentFrequency === "ANNUAL" ? "Anual" : "Mensual"})</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-muted-foreground">$</span>
                  <Input
                    id="baseAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="pl-6 text-sm"
                    value={baseAmount}
                    onChange={(e) => setBaseAmount(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-2 min-w-0">
                <Label htmlFor="startDate" className="truncate">Fecha Próximo Vencimiento</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar Contrato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
