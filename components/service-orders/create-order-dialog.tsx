"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  useCreateServiceOrder,
  useCostCenters,
} from "@/hooks/queries";
import { useSession } from "@/hooks/use-session";
import { useBranch } from "@/lib/branch-context";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const TYPE_LABELS: Record<string, string> = {
  CORRECTIVO: "Correctivo",
  PREVENTIVO: "Preventivo",
  CONTRACTUAL: "Contractual",
  EXTRAORDINARIO: "Extraordinario",
};

/** Valores con los que el diálogo puede venir pre-llenado (p. ej. desde Servicios Normativos). */
export interface CreateOrderPrefill {
  complianceServiceId?: string;
  branchId?: string;
  type?: string;
  scope?: string;
}

interface CreateOrderDialogProps {
  open: boolean;
  onClose: () => void;
  prefill?: CreateOrderPrefill;
  /** Se llama tras crear el borrador; si no se pasa, navega al detalle. */
  onCreated?: (order: { id: string }) => void;
}

/**
 * Diálogo de creación de Órdenes de Servicio compartido entre
 * la lista de OS y la acción "Generar OS" de Servicios Normativos.
 * El borrador usa folio temporal; el folio definitivo se emite al enviar a aprobación.
 */
export function CreateOrderDialog({ open, onClose, prefill, onCreated }: CreateOrderDialogProps) {
  // El router solo lo usa el flujo por defecto (navegar al detalle creado).
  return (
    <DialogRoot
      open={open}
      onClose={onClose}
      prefill={prefill}
      onCreated={onCreated}
    />
  );
}

function DialogRoot({ open, onClose, prefill, onCreated }: Required<Pick<CreateOrderDialogProps, "open" | "onClose">> & CreateOrderDialogProps) {
  const router = useRouter();
  const createMutation = useCreateServiceOrder();
  const { data: ccData } = useCostCenters();
  const { session } = useSession();
  const { selectedBranchId, branches } = useBranch();

  // Overrides de usuario; null = usar el prefill/valor por defecto (estado derivado,
  // sin useEffect: el valor efectivo se calcula en cada render según el prefill activo).
  const [typeOverride, setTypeOverride] = useState<string | null>(null);
  const [scopeOverride, setScopeOverride] = useState<string | null>(null);
  const [branchOverride, setBranchOverride] = useState<string | null>(null);
  const [urgency, setUrgency] = useState("NORMAL");
  const [justification, setJustification] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [costCenterId, setCostCenterId] = useState("");

  const type = typeOverride ?? (prefill?.type && TYPE_LABELS[prefill.type] ? prefill.type : "CORRECTIVO");
  const scope = scopeOverride ?? prefill?.scope ?? "";
  // GERENTE/SUPERVISOR tienen sucursal fija por sesión; el servidor la impone igual.
  const branchFixed = !!session?.user?.role && ["GERENTE", "SUPERVISOR"].includes(session.user.role);
  const branchId = branchOverride ?? prefill?.branchId ?? selectedBranchId ?? branches[0]?.id ?? "";

  const cents = Math.round(parseFloat(amountStr || "0") * 100);

  const submit = async () => {
    if (!branchId || !type || !cents) {
      toast.error("Indica sucursal, tipo y un monto mayor a cero");
      return;
    }
    try {
      const result = await createMutation.mutateAsync({
        branchId,
        type,
        urgency,
        scope: scope || undefined,
        justification: justification || undefined,
        amount: cents,
        costCenterId: costCenterId || undefined,
        complianceServiceId: prefill?.complianceServiceId || undefined,
      });
      toast.success("Borrador creado");
      onClose();
      const id = result?.order?.id;
      if (onCreated && id) onCreated({ id });
      else if (id) router.push(`/dashboard/equipment/compliance/service-orders/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear la orden");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva Orden de Servicio</DialogTitle>
          <DialogDescription>
            El borrador usa folio temporal; el folio definitivo se emite al enviar a aprobación.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="so-type">Tipo</Label>
              <Select value={type} onValueChange={setTypeOverride}>
                <SelectTrigger id="so-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-urgency">Urgencia</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger id="so-urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="URGENTE">Urgente</SelectItem>
                  <SelectItem value="EMERGENCIA">Emergencia</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-branch">Sucursal</Label>
            <Select value={branchId || undefined} onValueChange={setBranchOverride} disabled={branchFixed}>
              <SelectTrigger id="so-branch"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="so-amount">Monto (MXN)</Label>
              <Input
                id="so-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-cc">Centro de costo</Label>
              <Select value={costCenterId || undefined} onValueChange={setCostCenterId}>
                <SelectTrigger id="so-cc"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {(ccData?.costCenters ?? []).map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} · {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-scope">Alcance del servicio</Label>
            <Input id="so-scope" value={scope} onChange={(e) => setScopeOverride(e.target.value)} placeholder="¿Qué trabajo se realizará?" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-just">Justificación</Label>
            <Textarea id="so-just" value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Motivo del servicio" />
          </div>

          {urgency !== "EMERGENCIA" && !costCenterId && (
            <p className="text-xs text-muted-foreground">
              Sin centro de costo no se podrá validar presupuesto al enviar (las emergencias lo omiten).
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Crear borrador
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
