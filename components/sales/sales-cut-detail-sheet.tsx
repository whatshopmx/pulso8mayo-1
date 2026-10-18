"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CreditCard } from "lucide-react";
import { formatCents } from "@/lib/utils";
import {
  cashVarianceToneClass,
  computeCashVariance,
  computeTpvVariance,
  tpvVarianceNote,
} from "@/lib/sales/cash-variance";
import { cutStatus, cutStatusChipClass } from "@/lib/sales/cut-status";
import { CHANNEL_LABELS, type SalesCut } from "@/lib/sales/sales-cut-types";

/**
 * Detalle de un corte de ventas.
 *
 * El registro diario apilaba formas de pago, arqueo y terminal dentro de la
 * celda de la tabla. A escala de cadena eso convierte la lista en un muro de
 * 8 líneas por fila. El detalle vive aquí, y la fila conserva sólo el estado.
 */
interface SalesCutDetailSheetProps {
  cut: SalesCut | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre la captura de lotes TPV del corte (el modal ya existe en la página). */
  onOpenBatches: (cutId: string) => void;
}

function EstadoBadge({ cut }: { cut: SalesCut }) {
  const estado = cutStatus(cut);
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant="outline" className={cutStatusChipClass(estado.tone)}>
        {estado.label}
      </Badge>
      {estado.detail && (
        <span className="text-xs text-muted-foreground">{estado.detail}</span>
      )}
    </div>
  );
}

function Dato({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-right">{value}</span>
    </div>
  );
}

export function SalesCutDetailSheet({
  cut,
  open,
  onOpenChange,
  onOpenBatches,
}: SalesCutDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {cut && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                Corte · {cut.branchName}
              </SheetTitle>
              <SheetDescription>
                {new Date(cut.businessDate + "T00:00:00").toLocaleDateString("es-MX", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {cut.shift.toLowerCase()} · {CHANNEL_LABELS[cut.channel]}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              <EstadoBadge cut={cut} />

              <div>
                <Dato label="Venta total" value={formatCents(cut.totalSales)} />
              </div>

              <Separator />

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Formas de pago
                </h3>
                <Dato
                  label="Efectivo"
                  value={cut.cashSales !== null ? formatCents(cut.cashSales) : "—"}
                />
                <Dato
                  label="Tarjeta"
                  value={cut.cardSales !== null ? formatCents(cut.cardSales) : "—"}
                />
                <Dato
                  label="Otros"
                  value={cut.otherPayments !== null ? formatCents(cut.otherPayments) : "—"}
                />
              </section>

              <Separator />

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Arqueo de caja
                </h3>
                {cut.cashCountedCents === null ? (
                  <p className="text-sm text-muted-foreground">Sin arqueo capturado.</p>
                ) : (
                  <>
                    <Dato label="Efectivo contado" value={formatCents(cut.cashCountedCents)} />
                    {(() => {
                      const arqueo = computeCashVariance(cut);
                      if (arqueo === null) {
                        return (
                          <Dato
                            label="Diferencia"
                            value={<span className="text-muted-foreground">— sin efectivo declarado</span>}
                          />
                        );
                      }
                      return (
                        <Dato
                          label="Diferencia"
                          value={
                            <span className={cashVarianceToneClass(arqueo.direction)}>
                              {arqueo.direction === "cuadrado"
                                ? "✓ cuadrado"
                                : `${arqueo.varianceCents > 0 ? "+" : ""}${formatCents(arqueo.varianceCents)} (${arqueo.direction})`}
                            </span>
                          }
                        />
                      );
                    })()}
                  </>
                )}
              </section>

              <Separator />

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Terminal (TPV)
                </h3>
                {cut.tpvDepositCents === null ? (
                  <p className="text-sm text-muted-foreground">
                    {cut.cardSales !== null && cut.cardSales > 0
                      ? "Sin conciliar: falta el depósito de la terminal."
                      : "Sin venta con tarjeta."}
                  </p>
                ) : (
                  <>
                    <Dato label="Depósito" value={formatCents(cut.tpvDepositCents)} />
                    {cut.commissionCents !== null && (
                      <Dato label="Comisión" value={formatCents(cut.commissionCents)} />
                    )}
                    {(() => {
                      const tpv = computeTpvVariance(cut);
                      if (tpv === null) {
                        return (
                          <Dato
                            label="Diferencia"
                            value={<span className="text-muted-foreground">— sin venta con tarjeta</span>}
                          />
                        );
                      }
                      return (
                        <div className="py-1.5">
                          <Dato
                            label="Diferencia"
                            value={
                              <span
                                className={
                                  tpv.direction === "cuadrado"
                                    ? "text-muted-foreground"
                                    : "text-warning-text"
                                }
                              >
                                {tpv.direction === "cuadrado"
                                  ? "conciliada"
                                  : `${tpv.varianceCents > 0 ? "+" : ""}${formatCents(tpv.varianceCents)} (${tpv.direction})`}
                              </span>
                            }
                          />
                          <p className="text-xs text-muted-foreground mt-1">{tpvVarianceNote(tpv)}</p>
                        </div>
                      );
                    })()}
                  </>
                )}
              </section>

              <Separator />

              <section>
                <Dato
                  label="Tickets"
                  value={cut.ticketCount !== null ? cut.ticketCount : "—"}
                />
                <Dato
                  label="Origen"
                  value={cut.source === "MANUAL_FORM" ? "Manual" : cut.source === "UPLOAD" ? "Archivo POS" : "WhatsApp"}
                />
                <Dato
                  label="Recibido por"
                  value={
                    cut.receivedByName ? (
                      <span className="flex flex-col items-end">
                        <span>{cut.receivedByName}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(cut.receivedAt).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                    ) : (
                      "Sin registrar"
                    )
                  }
                />
              </section>

              {cut.validationNotes && (
                <>
                  <Separator />
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Validación
                    </h3>
                    <p className="text-sm text-muted-foreground">{cut.validationNotes}</p>
                  </section>
                </>
              )}

              {cut.cardSales !== null && cut.cardSales > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    onOpenBatches(cut.id);
                    onOpenChange(false);
                  }}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Lotes TPV
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
