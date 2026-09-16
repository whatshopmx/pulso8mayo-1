"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  FileImage,
  Loader2,
  UploadCloud,
  AlertTriangle,
  Receipt,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  GetShiftBatchesResult,
  TpvBatchInput,
} from "@/lib/services/tpv-batch-service";

interface TpvBatchEntryModalProps {
  salesCutId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

interface TerminalBatchFormState {
  terminalId: string;
  batchNumber: string;
  cardAmountPesos: string;
  tipAmountPesos: string;
  voucherPhotoUrl: string | null;
  voucherPreviewUrl?: string | null;
  notes: string;
  isUploadingPhoto?: boolean;
}

export function TpvBatchEntryModal({
  salesCutId,
  open,
  onOpenChange,
  onSaved,
}: TpvBatchEntryModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<GetShiftBatchesResult | null>(null);
  const [formStates, setFormStates] = useState<Record<string, TerminalBatchFormState>>({});

  // Cargar datos del corte y terminales
  useEffect(() => {
    if (!open || !salesCutId) return;

    let cancelled = false;
    setLoading(true);

    fetch(`/api/sales/cuts/${salesCutId}/batches`)
      .then((res) => {
        if (!res.ok) throw new Error("Error al obtener datos del corte");
        return res.json();
      })
      .then((res) => {
        if (cancelled) return;
        const result: GetShiftBatchesResult = res.data;
        setData(result);

        // Inicializar estados de formulario mapeando lotes existentes o vacíos para cada terminal
        const states: Record<string, TerminalBatchFormState> = {};
        const batchesByTerminal = new Map(
          result.batches.map((b) => [b.terminalId, b])
        );

        for (const term of result.terminals) {
          const existing = batchesByTerminal.get(term.id);
          states[term.id] = {
            terminalId: term.id,
            batchNumber: existing?.batchNumber || "",
            cardAmountPesos: existing
              ? (existing.cardAmountCents / 100).toFixed(2)
              : "",
            tipAmountPesos: existing
              ? (existing.tipAmountCents / 100).toFixed(2)
              : "0.00",
            voucherPhotoUrl: existing?.voucherPhotoUrl || null,
            notes: existing?.notes || "",
            isUploadingPhoto: false,
          };
        }

        setFormStates(states);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error loading batches:", err);
        toast.error("No se pudieron cargar los lotes de terminales.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, salesCutId]);

  // Cálculos en vivo de totales
  const { totalCardPesos, totalTipPesos, variancePesos, direction } = useMemo(() => {
    let cardSum = 0;
    let tipSum = 0;

    for (const state of Object.values(formStates)) {
      const card = parseFloat(state.cardAmountPesos) || 0;
      const tip = parseFloat(state.tipAmountPesos) || 0;
      cardSum += card;
      tipSum += tip;
    }

    const posCardPesos = (data?.cut.cardSales ?? 0) / 100;
    const diff = cardSum - posCardPesos;
    const isZero = Math.abs(diff) < 0.01;

    return {
      totalCardPesos: cardSum,
      totalTipPesos: tipSum,
      variancePesos: diff,
      direction: isZero ? "cuadrado" : diff < 0 ? "faltante" : "sobrante",
    };
  }, [formStates, data]);

  const handleFieldChange = (
    terminalId: string,
    field: keyof TerminalBatchFormState,
    value: any
  ) => {
    setFormStates((prev) => ({
      ...prev,
      [terminalId]: {
        ...prev[terminalId],
        [field]: value,
      },
    }));
  };

  // Subir foto de voucher
  const handleUploadVoucher = async (
    terminalId: string,
    file: File | null
  ) => {
    if (!file || !salesCutId) return;

    handleFieldChange(terminalId, "isUploadingPhoto", true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/sales/cuts/${salesCutId}/batches/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error al subir la fotografía");
      }

      const { data: uploadResult } = await res.json();
      setFormStates((prev) => ({
        ...prev,
        [terminalId]: {
          ...prev[terminalId],
          voucherPhotoUrl: uploadResult.storageKey,
          voucherPreviewUrl: uploadResult.previewUrl,
          isUploadingPhoto: false,
        },
      }));
      toast.success("Foto del voucher subida exitosamente.");
    } catch (err: any) {
      console.error("Error uploading voucher:", err);
      toast.error(err.message || "No se pudo subir la foto del voucher.");
      handleFieldChange(terminalId, "isUploadingPhoto", false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!salesCutId || !data) return;

    // Filtrar terminales que tienen datos capturados
    const batchesToSave: TpvBatchInput[] = [];
    for (const [termId, state] of Object.entries(formStates)) {
      if (state.batchNumber.trim() || state.cardAmountPesos.trim()) {
        if (!state.batchNumber.trim()) {
          toast.error("Cada terminal con monto debe incluir su folio de lote físico.");
          return;
        }
        const cardCents = Math.round((parseFloat(state.cardAmountPesos) || 0) * 100);
        const tipCents = Math.round((parseFloat(state.tipAmountPesos) || 0) * 100);

        batchesToSave.push({
          terminalId: termId,
          batchNumber: state.batchNumber.trim(),
          cardAmountCents: cardCents,
          tipAmountCents: tipCents,
          voucherPhotoUrl: state.voucherPhotoUrl,
          notes: state.notes.trim() || null,
        });
      }
    }

    if (batchesToSave.length === 0) {
      toast.error("Ingresa al menos un cierre de lote de terminal física.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/sales/cuts/${salesCutId}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batches: batchesToSave }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error al guardar los lotes");
      }

      toast.success("Lotes de terminales guardados y conciliados exitosamente.");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error("Error saving batches:", err);
      toast.error(err.message || "Error al guardar los lotes de terminales.");
    } finally {
      setSaving(false);
    }
  };

  const posCardPesos = (data?.cut.cardSales ?? 0) / 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <DialogTitle>Cierre de Lotes de Terminales (TPV)</DialogTitle>
          </div>
          <DialogDescription>
            {data ? (
              <span>
                Corte del <strong>{data.cut.businessDate}</strong> · Turno{" "}
                <strong>{data.cut.shift}</strong> · Ingresa los vouchers físicos
                de cada terminal para conciliar contra la venta con tarjeta del
                POS.
              </span>
            ) : (
              "Cargando detalles del corte..."
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Obteniendo terminales y lotes...</p>
          </div>
        ) : !data || data.terminals.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground space-y-3">
            <AlertTriangle className="h-10 w-10 text-warning-text mx-auto" />
            <p className="font-semibold text-foreground">
              No hay terminales autorizadas en esta sucursal
            </p>
            <p className="text-sm max-w-md mx-auto">
              Para registrar cierres de lote, primero da de alta las terminales físicas
              en <strong>Finanzas → Configuración → Terminales TPV</strong>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Barra comparativa de conciliación en vivo */}
            <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-primary" />
                  Cuadre físico vs. POS
                </span>
                {direction === "cuadrado" ? (
                  <Badge variant="outline" className="border-success text-success bg-success/10 font-semibold gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Cuadrado
                  </Badge>
                ) : direction === "faltante" ? (
                  <Badge variant="destructive" className="font-semibold gap-1">
                    <AlertCircle className="h-3 w-3" /> Faltante en vouchers (-${Math.abs(variancePesos).toFixed(2)})
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-warning-text text-warning-text bg-warning-text/10 font-semibold gap-1">
                    <AlertTriangle className="h-3 w-3" /> Sobrante en vouchers (+${variancePesos.toFixed(2)})
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div>
                  <span className="text-xs text-muted-foreground">Tarjeta en POS</span>
                  <p className="text-base font-bold text-foreground">
                    ${posCardPesos.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Total Vouchers</span>
                  <p className="text-base font-bold text-foreground">
                    ${totalCardPesos.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Propinas Vouchers</span>
                  <p className="text-base font-bold text-muted-foreground">
                    ${totalTipPesos.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Diferencia</span>
                  <p
                    className={`text-base font-bold ${
                      direction === "cuadrado"
                        ? "text-success"
                        : direction === "faltante"
                        ? "text-destructive"
                        : "text-warning-text"
                    }`}
                  >
                    {variancePesos > 0 ? "+" : ""}
                    ${variancePesos.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>

            {/* Listado de terminales de la sucursal */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  Terminales físicas autorizadas ({data.terminals.length})
                </Label>
                <span className="text-xs text-muted-foreground">
                  Captura el folio y monto según el ticket de cierre de lote
                </span>
              </div>

              {data.terminals.map((term) => {
                const state = formStates[term.id] || {
                  terminalId: term.id,
                  batchNumber: "",
                  cardAmountPesos: "",
                  tipAmountPesos: "0.00",
                  voucherPhotoUrl: null,
                  notes: "",
                };

                return (
                  <Card key={term.id} className="border shadow-none">
                    <CardContent className="p-4 space-y-4">
                      {/* Cabecera de la terminal */}
                      <div className="flex items-center justify-between flex-wrap gap-2 border-b pb-2">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-primary" />
                          <span className="font-semibold text-sm">
                            {term.alias}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            SN: {term.serialNumber}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {term.acquirer}
                          </Badge>
                          {state.batchNumber && (
                            <Badge variant="outline" className="border-success text-success text-xs">
                              Lote #{state.batchNumber}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Campos de captura */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor={`batch-${term.id}`} className="text-xs">
                            Folio de Lote Físico *
                          </Label>
                          <Input
                            id={`batch-${term.id}`}
                            placeholder="Ej. 000142"
                            value={state.batchNumber}
                            onChange={(e) =>
                              handleFieldChange(term.id, "batchNumber", e.target.value)
                            }
                            className="font-mono text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor={`card-${term.id}`} className="text-xs">
                            Monto Tarjeta (MXN) *
                          </Label>
                          <Input
                            id={`card-${term.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={state.cardAmountPesos}
                            onChange={(e) =>
                              handleFieldChange(term.id, "cardAmountPesos", e.target.value)
                            }
                            className="font-medium text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor={`tip-${term.id}`} className="text-xs">
                            Propinas Acumuladas (MXN)
                          </Label>
                          <Input
                            id={`tip-${term.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={state.tipAmountPesos}
                            onChange={(e) =>
                              handleFieldChange(term.id, "tipAmountPesos", e.target.value)
                            }
                            className="text-xs"
                          />
                        </div>
                      </div>

                      {/* Subida de foto de voucher y observaciones */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end pt-1">
                        <div className="space-y-1">
                          <Label className="text-xs flex items-center justify-between">
                            <span>Foto del Voucher de Lote</span>
                            {state.voucherPhotoUrl && (
                              <span className="text-[11px] text-success font-medium flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Adjunto
                              </span>
                            )}
                          </Label>

                          <div className="flex items-center gap-2">
                            <Input
                              type="file"
                              accept="image/*,application/pdf"
                              disabled={state.isUploadingPhoto}
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null;
                                handleUploadVoucher(term.id, file);
                              }}
                              className="text-xs file:text-xs file:py-1 file:px-2 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground"
                            />
                            {state.isUploadingPhoto && (
                              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                            )}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor={`notes-${term.id}`} className="text-xs">
                            Observaciones (opcional)
                          </Label>
                          <Input
                            id={`notes-${term.id}`}
                            placeholder="Ej. Batería baja, terminal reiniciada..."
                            value={state.notes}
                            onChange={(e) =>
                              handleFieldChange(term.id, "notes", e.target.value)
                            }
                            className="text-xs"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando Lotes...
                  </>
                ) : (
                  "Guardar Cierre de Lotes"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
