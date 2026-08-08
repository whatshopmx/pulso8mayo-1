"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCents } from "@/lib/utils";
import { Plus, RefreshCw, Loader2, DollarSign, ImagePlus, Check, X, AlertTriangle } from "lucide-react";

interface PettyCashRegisterProps {
  branches: Array<{ id: string; name: string }>;
  /** Sucursal en scope; el diálogo abre en ella pero permite cambiarla. */
  defaultBranchId?: string | null;
  onSuccess?: () => void;
}

type Mode = "OUT" | "REPLENISHMENT";

export function PettyCashRegister({ branches, defaultBranchId, onSuccess }: PettyCashRegisterProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("OUT");
  const [branchId, setBranchId] = useState<string>(defaultBranchId || branches[0]?.id || "");
  const [amount, setAmount] = useState<string>("");
  const [concept, setConcept] = useState<string>("");
  const [category, setCategory] = useState<string>("OTROS");
  const [notes, setNotes] = useState<string>("");
  const [evidenceUrl, setEvidenceUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  /** Saldo actual del fondo de la sucursal elegida; `null` mientras no se conoce. */
  const [fundBalance, setFundBalance] = useState<number | null>(null);

  const parsedAmount = parseFloat(amount);
  const amountCents =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? Math.round(parsedAmount * 100) : null;

  // Saldo resultante: lo que quedará en la caja después del movimiento. Es el dato
  // que decide si el retiro es sensato, así que se muestra antes de confirmarlo.
  const resultingBalance =
    fundBalance !== null && amountCents !== null
      ? mode === "OUT"
        ? fundBalance - amountCents
        : fundBalance + amountCents
      : null;

  const resetForm = useCallback(() => {
    setAmount("");
    setConcept("");
    setCategory("OTROS");
    setNotes("");
    setEvidenceUrl("");
  }, []);

  const openWithMode = (next: Mode) => {
    setMode(next);
    resetForm();
    setBranchId(defaultBranchId || branches[0]?.id || "");
    setOpen(true);
  };

  // El saldo se relee al abrir y al cambiar de sucursal: mostrar el de otra caja
  // convertiría el resumen de confirmación en una cifra falsa.
  useEffect(() => {
    if (!open || !branchId) {
      setFundBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/petty-cash?branchId=${branchId}`);
        const json = await res.json();
        if (cancelled) return;
        setFundBalance(res.ok && json.success ? (json.data?.currentBalance ?? null) : null);
      } catch {
        if (!cancelled) setFundBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, branchId]);

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
        throw new Error(data.error?.message || data.error || "Error al subir el comprobante.");
      }
      setEvidenceUrl(data.data.url);
      toast({ title: "Comprobante adjunto", description: "Foto del ticket subida correctamente." });
    } catch (err: unknown) {
      toast({
        title: "No se pudo subir el comprobante",
        description:
          err instanceof Error ? err.message : "Revisa tu conexión e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  /** Motivo por el que aún no se puede enviar, o `null` si el formulario está completo. */
  const blockingReason = (): string | null => {
    if (!branchId) return "Selecciona una sucursal.";
    if (amountCents === null) return "Ingresa un monto válido mayor a $0.";
    if (mode === "OUT" && concept.trim() === "") return "Describe el concepto del retiro.";
    // La caja chica promete "comprobante fotográfico": sin él, el retiro no puede
    // auditarse y la columna Comprobante de la bitácora queda vacía para siempre.
    if (mode === "OUT" && !evidenceUrl) return "Adjunta la foto del ticket o comprobante.";
    return null;
  };

  const handleRequestConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const reason = blockingReason();
    if (reason) {
      toast({ title: "Falta información", description: reason, variant: "destructive" });
      return;
    }
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    if (amountCents === null) return;
    setLoading(true);
    try {
      const body =
        mode === "REPLENISHMENT"
          ? { type: "REPLENISHMENT", branchId, amountCents, notes }
          : {
              type: "OUT",
              branchId,
              amountCents,
              concept,
              category,
              evidenceUrl,
              authorizationNotes: notes,
            };

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
        title: mode === "REPLENISHMENT" ? "Fondo repuesto" : "Retiro registrado",
        description: `Movimiento por ${formatCents(amountCents)} registrado en la bitácora.`,
      });

      setConfirmOpen(false);
      setOpen(false);
      resetForm();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Error al registrar movimiento.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const branchName = branches.find((b) => b.id === branchId)?.name ?? "—";

  return (
    <>
      {/* Dos disparadores independientes: envolverlos en un `div` con
          `DialogTrigger asChild` movía el rol y el `aria-expanded` al div, así que
          ninguno de los dos botones anunciaba lo que hacía. */}
      <div className="flex gap-2">
        <Button onClick={() => openWithMode("OUT")}>
          <Plus className="w-4 h-4 mr-2" /> Registrar Retiro
        </Button>
        <Button variant="outline" onClick={() => openWithMode("REPLENISHMENT")}>
          <RefreshCw className="w-4 h-4 mr-2" /> Reponer Fondo
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <DollarSign className="w-5 h-5 text-primary" />
              {mode === "REPLENISHMENT" ? "Reposición de Fondo de Caja Chica" : "Registrar Retiro de Caja Chica"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {mode === "REPLENISHMENT"
                ? "Agrega saldo al fondo de caja chica de la sucursal."
                : "Saca efectivo de la caja chica. Queda en la bitácora con tu nombre y el comprobante fotográfico."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRequestConfirm} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="petty-branch">Sucursal</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="petty-branch">
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
              {fundBalance !== null && (
                <p className="text-xs text-muted-foreground">
                  Saldo actual en caja:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCents(fundBalance)}
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="petty-amount">Monto ($ MXN)</Label>
              <Input
                id="petty-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {resultingBalance !== null && (
                <p
                  className={`text-xs ${
                    resultingBalance < 0 ? "text-destructive font-medium" : "text-muted-foreground"
                  }`}
                >
                  Saldo después del movimiento:{" "}
                  <span className="font-semibold tabular-nums">{formatCents(resultingBalance)}</span>
                  {resultingBalance < 0 && " — el retiro excede el efectivo disponible."}
                </p>
              )}
            </div>

            {mode === "OUT" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="petty-concept">Concepto / Motivo</Label>
                  <Input
                    id="petty-concept"
                    placeholder="ej. Insumos de emergencia, taxi, repuesto de gas"
                    value={concept}
                    onChange={(e) => setConcept(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="petty-category">Categoría</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="petty-category">
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

                <div className="space-y-2">
                  <Label htmlFor="petty-evidence">Comprobante fotográfico (obligatorio)</Label>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="petty-evidence"
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
                      id="petty-evidence"
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
                        className="h-8 w-8 p-0"
                        aria-label="Quitar el comprobante adjunto"
                        onClick={() => setEvidenceUrl("")}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sin comprobante el movimiento no es auditable y la bitácora quedaría con la
                    columna vacía.
                  </p>
                </div>
              </>
            )}

            <div className="space-y-2">
              {/* Antes decía "Justificación de Autorización" con placeholder "Autorizado
                  por gerente de turno": la autorización la escribía quien saca el
                  dinero. Es una nota, y así se nombra. */}
              <Label htmlFor="petty-notes">Nota del movimiento (opcional)</Label>
              <Input
                id="petty-notes"
                placeholder="ej. Se acabó el gas a media comida"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading || uploading}>
                {mode === "REPLENISHMENT" ? "Reponer Fondo" : "Continuar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sacar efectivo físico es irreversible: se restata el hecho concreto antes de
          cometerlo, igual que la aprobación de gastos. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "REPLENISHMENT" ? "¿Reponer el fondo?" : "¿Registrar este retiro de efectivo?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "REPLENISHMENT"
                ? "El saldo del fondo aumentará y el movimiento quedará en la bitácora auditable."
                : "El movimiento descuenta efectivo real de la caja y queda en la bitácora a tu nombre. Corregirlo exige un ajuste registrado."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <dl className="rounded-md bg-muted/50 px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Sucursal</dt>
              <dd className="font-medium text-right">{branchName}</dd>
            </div>
            {mode === "OUT" && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Concepto</dt>
                <dd className="font-medium text-right">{concept}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Monto</dt>
              <dd className="font-semibold tabular-nums">
                {amountCents !== null ? formatCents(amountCents) : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Saldo resultante</dt>
              <dd
                className={`font-semibold tabular-nums ${
                  resultingBalance !== null && resultingBalance < 0 ? "text-destructive" : ""
                }`}
              >
                {resultingBalance !== null ? formatCents(resultingBalance) : "No disponible"}
              </dd>
            </div>
          </dl>

          {mode === "OUT" && resultingBalance !== null && resultingBalance < 0 && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              El monto supera el efectivo disponible en la caja. Verifica el conteo antes de
              continuar.
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => {
                // No cerrar el diálogo antes de conocer la respuesta del servidor.
                e.preventDefault();
                handleSubmit();
              }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {mode === "REPLENISHMENT" ? "Sí, reponer" : "Sí, registrar el retiro"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
