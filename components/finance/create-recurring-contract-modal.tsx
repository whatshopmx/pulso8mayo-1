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
import { Loader2, Plus, Building2, Store, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/lib/branch-context";

/**
 * Porcentaje escrito por el usuario → entero, o `null` si el campo está vacío.
 *
 * `null` NO es lo mismo que 0: vacío significa "no alertes por este lado" y un
 * cero escrito significa "alértame ante cualquier desviación". `parseInt` de
 * una cadena vacía da `NaN`, que enviado como JSON se vuelve `null` por
 * accidente en vez de por decisión — de ahí el guard explícito.
 */
function parseTolerancia(raw: string): number | null {
  const limpio = raw.trim().replace(/[%\s]/g, "");
  if (limpio === "") return null;
  if (!/^\d{1,4}$/.test(limpio)) return null;
  return Number(limpio);
}

/**
 * Qué tolerancia tiene sentido según lo que se está contratando. Es una pista en
 * el texto, no un valor que se imponga: quien captura conoce su recibo.
 */
const SUGERENCIA_TOLERANCIA: Record<string, string> = {
  RENTA: "Una renta es fija: 5% arriba basta y no necesita alerta por debajo.",
  SERVICIO_BASICO:
    "Luz y agua varían por temporada: suele ir 30-40% arriba y 30% abajo, o la alerta se vuelve ruido.",
  MANTENIMIENTO: "El mantenimiento varía con lo que se rompa: considera 25% o más.",
  SOFTWARE: "Una licencia es fija salvo cambio de plan: 5% arriba.",
};

interface CreateRecurringContractModalProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

interface SupplierOption {
  id: string;
  name: string;
  taxId?: string;
  source?: "supplier" | "payee";
}

export function CreateRecurringContractModal({ onSuccess, trigger }: CreateRecurringContractModalProps) {
  const { branches, selectedBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  
  const [title, setTitle] = useState("");
  const [contractType, setContractType] = useState("RENTA");
  const [baseAmount, setBaseAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [branchId, setBranchId] = useState<string>(selectedBranchId || "ALL");
  const [paymentFrequency, setPaymentFrequency] = useState<string>("MONTHLY");
  // Tolerancias de desviación. Se capturan como texto para poder distinguir
  // "sin alerta por debajo" (vacío) de "alerta al 0%" (un cero escrito).
  const [tolAbove, setTolAbove] = useState<string>("10");
  const [tolBelow, setTolBelow] = useState<string>("");

  // Sub-modal: Quick Supplier Creation
  const [showQuickSupplier, setShowQuickSupplier] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickTaxId, setQuickTaxId] = useState("");
  const [quickEmail, setQuickEmail] = useState("");
  const [creatingQuickSupplier, setCreatingQuickSupplier] = useState(false);

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
      const [suppRes, payeeRes] = await Promise.all([
        fetch("/api/inventory/suppliers"),
        fetch("/api/finance/payees"),
      ]);

      const suppJson = await suppRes.json().catch(() => ({}));
      const payeeJson = await payeeRes.json().catch(() => ({}));

      const combined: SupplierOption[] = [];
      const seenIds = new Set<string>();

      if (suppRes.ok && Array.isArray(suppJson.suppliers)) {
        suppJson.suppliers.forEach((s: any) => {
          if (s.id && !seenIds.has(s.id)) {
            seenIds.add(s.id);
            combined.push({ id: s.id, name: s.name, taxId: s.taxId, source: "supplier" });
          }
        });
      }

      if (payeeRes.ok && Array.isArray(payeeJson.data)) {
        payeeJson.data.forEach((p: any) => {
          if (p.id && !seenIds.has(p.id)) {
            seenIds.add(p.id);
            combined.push({ id: p.id, name: p.name, taxId: p.taxId, source: "payee" });
          }
        });
      }

      setSuppliers(combined);

      if (combined.length > 0 && !supplierId) {
        setSupplierId(combined[0].id);
      }
    } catch (e) {
      console.error("Error al cargar proveedores:", e);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const handleCreateQuickSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickName.trim()) {
      toast.error("El nombre del proveedor es obligatorio");
      return;
    }

    setCreatingQuickSupplier(true);
    try {
      const res = await fetch("/api/inventory/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: quickName.trim(),
          taxId: quickTaxId.trim() || undefined,
          email: quickEmail.trim() || undefined,
          active: true,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success && json.supplier) {
        const newSupp: SupplierOption = {
          id: json.supplier.id,
          name: json.supplier.name,
          taxId: json.supplier.taxId,
          source: "supplier",
        };

        setSuppliers((prev) => [newSupp, ...prev]);
        setSupplierId(newSupp.id);
        setShowQuickSupplier(false);
        setQuickName("");
        setQuickTaxId("");
        setQuickEmail("");

        toast.success("Proveedor registrado", {
          description: `"${newSupp.name}" ha sido creado y seleccionado.`,
        });
      } else {
        toast.error("Error al crear proveedor", {
          description: json.error || "No se pudo dar de alta el proveedor.",
        });
      }
    } catch (err) {
      toast.error("Error de red", { description: "No se pudo conectar al servidor." });
    } finally {
      setCreatingQuickSupplier(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !baseAmount || !startDate) {
      toast.error("Campos incompletos", { description: "Por favor llena todos los campos obligatorios." });
      return;
    }

    if (!supplierId && suppliers.length === 0) {
      toast.error("Proveedor requerido", {
        description: "Por favor crea o selecciona un proveedor para este gasto recurrente.",
      });
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
            supplierId: supplierId || suppliers[0]?.id,
            branchId: branchId === "ALL" ? null : branchId,
            paymentFrequency,
            varianceTolerancePercent: parseTolerancia(tolAbove) ?? 10,
            // `null` explícito y no `undefined`: significa "no alertes por
            // debajo", que es distinto de "usa el valor por omisión".
            varianceToleranceBelowPercent: parseTolerancia(tolBelow),
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
        setTolAbove("10");
        setTolBelow("");
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
    <>
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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="supplierId" className="truncate">Proveedor / Contraparte</Label>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline font-medium flex items-center gap-0.5"
                      onClick={() => setShowQuickSupplier(true)}
                    >
                      <UserPlus className="h-3 w-3" /> + Nuevo
                    </button>
                  </div>
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
                            Sin proveedores. Da clic en "+ Nuevo"
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

              {/* Tolerancias de desviación.
                  Hasta ahora no se podían capturar: la columna existía pero el
                  alta no la recibía, así que todo contrato quedaba en 10% y un
                  recibo de CFE de temporada alta salía como excepción de control
                  interno mes con mes. Son dos campos y no uno porque las dos
                  desviaciones no significan lo mismo: en agua un consumo
                  disparado es una fuga; en luz un recibo muy bajo suele ser
                  lectura estimada, y el ajuste llega al doble después. */}
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
                <Label className="text-sm">Tolerancia de desviación</Label>
                <p className="text-xs text-muted-foreground">
                  Cuánto puede alejarse el recibo del monto base antes de que Control Interno lo
                  marque como excepción. {SUGERENCIA_TOLERANCIA[contractType] ?? ""}
                </p>
                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div className="grid gap-1.5 min-w-0">
                    <Label htmlFor="tolAbove" className="text-xs truncate">
                      Alerta si sube más de (%)
                    </Label>
                    <Input
                      id="tolAbove"
                      type="number"
                      min="0"
                      max="1000"
                      step="1"
                      placeholder="10"
                      className="text-sm"
                      value={tolAbove}
                      onChange={(e) => setTolAbove(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 min-w-0">
                    <Label htmlFor="tolBelow" className="text-xs truncate">
                      Alerta si baja más de (%)
                    </Label>
                    <Input
                      id="tolBelow"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      placeholder="sin alerta"
                      className="text-sm"
                      value={tolBelow}
                      onChange={(e) => setTolBelow(e.target.value)}
                      aria-describedby="tolBelow-help"
                    />
                  </div>
                </div>
                <p id="tolBelow-help" className="text-xs text-muted-foreground">
                  Déjalo vacío para no alertar nunca por debajo — es lo correcto en una renta, que
                  no baja sola.
                </p>
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

      {/* Sub-modal: Alta Rápida de Proveedor / Contraparte */}
      <Dialog open={showQuickSupplier} onOpenChange={setShowQuickSupplier}>
        <DialogContent className="sm:max-w-[400px]">
          <form onSubmit={handleCreateQuickSupplier}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4 text-primary" /> Crear Nuevo Proveedor / Contraparte
              </DialogTitle>
              <DialogDescription className="text-xs">
                Registra la razón social o prestador de servicio (ej. CFE, Telmex, Arrendador).
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-3">
              <div className="grid gap-1.5">
                <Label htmlFor="quickName" className="text-xs">Nombre o Razón Social</Label>
                <Input
                  id="quickName"
                  placeholder="Ej. CFE Suministrador ó Inmobiliaria MTY"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="text-xs h-9"
                  required
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="quickTaxId" className="text-xs">RFC (Opcional)</Label>
                <Input
                  id="quickTaxId"
                  placeholder="Ej. CSS160330CP7"
                  value={quickTaxId}
                  onChange={(e) => setQuickTaxId(e.target.value.toUpperCase())}
                  className="text-xs h-9 font-mono"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="quickEmail" className="text-xs">Email de contacto (Opcional)</Label>
                <Input
                  id="quickEmail"
                  type="email"
                  placeholder="contacto@proveedor.com"
                  value={quickEmail}
                  onChange={(e) => setQuickEmail(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowQuickSupplier(false)}
                disabled={creatingQuickSupplier}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={creatingQuickSupplier}>
                {creatingQuickSupplier && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Guardar y Seleccionar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
