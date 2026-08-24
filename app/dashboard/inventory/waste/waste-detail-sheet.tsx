"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { REASON_LABELS, originLabel, isInternalConsumption } from "@/lib/inventory/waste-labels";
import { formatQty } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { EvidenceImage } from "./evidence-image";

/**
 * Fila del historial de mermas tal como la devuelve GET /api/inventory/waste
 * (plan-mermas-historial Task 2). `evidenceUrl` llega cuando el registro viene
 * de un workflow con foto (Task 4); hoy casi siempre es undefined.
 */
export interface WasteRecordRow {
  waste: {
    id: string;
    itemId: string;
    batchId: string | null;
    quantity: number;
    unit: string;
    reason: string;
    costPerUnit: number | null; // centavos
    totalLoss: number | null; // centavos
    workflowInstanceId: string | null;
    origin: string | null;
    recordedBy: string;
    recordedAt: string;
    notes: string | null;
    evidenceUrl?: string | null;
  };
  item: {
    id: string;
    name: string | null;
    sku: string | null;
    unit: string | null;
    category?: string | null;
  };
  batch: {
    id: string | null;
    lotNumber: string | null;
    expirationDate: string | null;
  };
  recordedByUser?: { id: string | null; name: string | null };
}

const formatMXN = (cents: number | null) =>
  cents == null
    ? "—"
    : (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium mt-0.5">{children}</dd>
    </div>
  );
}

export function WasteDetailSheet({
  record,
  open,
  onOpenChange,
}: {
  record: WasteRecordRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const w = record?.waste;
  const reason = w ? REASON_LABELS[w.reason as keyof typeof REASON_LABELS] ?? { label: w.reason, variant: "outline" as const } : null;
  const origin = originLabel(w?.origin);
  const interno = w ? isInternalConsumption(w.reason) : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {record && w && reason ? (
          <>
            <SheetHeader className="pb-2">
              <SheetTitle className="text-base flex items-center gap-2">
                {record.item.name ?? "Producto"}
                {interno && (
                  <Badge variant="secondary">Consumo interno</Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                Merma registrada el{" "}
                {new Date(w.recordedAt).toLocaleString("es-MX", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-6 space-y-5">
              {/* Impacto */}
              <dl className="grid grid-cols-3 gap-3 rounded-lg border bg-sidebar p-3">
                <DetailField label="Cantidad">
                  {formatQty(w.quantity)} {w.unit}
                </DetailField>
                <DetailField label="Pérdida">
                  <span className={interno ? "" : "text-destructive"}>{formatMXN(w.totalLoss)}</span>
                </DetailField>
                <DetailField label="Costo unit.">{formatMXN(w.costPerUnit)}</DetailField>
              </dl>

              {/* Clasificación */}
              <dl className="space-y-3">
                <DetailField label="Motivo">
                  <Badge variant={reason.variant}>{reason.label}</Badge>
                </DetailField>
                <DetailField label="Origen">
                  <Badge variant={origin.variant}>{origin.label}</Badge>
                </DetailField>
              </dl>

              <Separator />

              {/* Trazabilidad de producto y lote */}
              <dl className="grid grid-cols-2 gap-3">
                <DetailField label="SKU">{record.item.sku ?? "—"}</DetailField>
                <DetailField label="Categoría">{record.item.category ?? "—"}</DetailField>
                <DetailField label="Lote">{record.batch.lotNumber ?? "—"}</DetailField>
                <DetailField label="Caducidad del lote">
                  {record.batch.expirationDate
                    ? new Date(record.batch.expirationDate).toLocaleDateString("es-MX")
                    : "—"}
                </DetailField>
                <DetailField label="Registró">{record.recordedByUser?.name ?? w.recordedBy}</DetailField>
                <DetailField label="ID del registro">
                  <span className="font-mono text-xs break-all">{w.id.slice(0, 8)}…</span>
                </DetailField>
              </dl>

              {w.notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Notas</p>
                  <p className="text-sm whitespace-pre-wrap rounded-lg border p-3 bg-background">
                    {w.notes}
                  </p>
                </div>
              )}

              {/* Evidencia fotográfica (Task 4): la URL se pide al endpoint
                  scopeado — en BD vive la key R2, no una URL pública. */}
              {(w.evidenceUrl || w.origin === "workflow_merma") && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Evidencia fotográfica</p>
                  <EvidenceImage
                    wasteId={w.id}
                    alt={`Evidencia de merma de ${record.item.name ?? "producto"}`}
                  />
                </div>
              )}

              {w.workflowInstanceId && (
                <Button variant="outline" size="sm" asChild className="w-full shadow-none bg-background">
                  <Link href={`/dashboard/workflows/${w.workflowInstanceId}`}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Ver flujo de origen
                  </Link>
                </Button>
              )}
            </div>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>Detalle de merma</SheetTitle>
            <SheetDescription>Sin registro seleccionado.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
