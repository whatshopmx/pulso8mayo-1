"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Package,
  CookingPot,
  Trash2,
  ArrowRightLeft,
  Calendar,
} from "lucide-react";
import type { InventoryBatch } from "@/hooks/queries/use-lots";

interface ProductionTrace {
  id: string;
  actualQuantity: number;
  unit: string;
  recipeName: string | null;
  producedQuantity: number;
  producedAt: string;
}

interface WasteTrace {
  id: string;
  quantity: number;
  unit: string;
  reason: string;
  totalLoss: number | null;
  createdAt: string;
}

interface MovementTrace {
  id: string;
  type: string;
  quantityChange: number;
  reason: string | null;
  timestamp: string;
}

interface TraceData {
  productions: ProductionTrace[];
  waste: WasteTrace[];
  movements: MovementTrace[];
}

export function BatchTraceDialog({
  batch,
  open,
  onOpenChange,
}: {
  batch: InventoryBatch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceData | null>(null);

  useEffect(() => {
    if (!open || !batch?.id) {
      setTrace(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    fetch(`/api/inventory/batches?id=${batch.id}&trace=true`)
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.success) {
          setTrace(data.trace);
        }
      })
      .catch((err) => console.error("Error fetching batch trace:", err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, batch?.id]);

  if (!batch) return null;

  const remainingPct =
    batch.initialQuantity > 0
      ? Math.min(100, Math.max(0, Math.round((batch.currentQuantity / batch.initialQuantity) * 100)))
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Trazabilidad de Lote: <span className="font-mono">{batch.lotNumber || "Sin folio"}</span>
            </DialogTitle>
            <Badge variant="outline">{batch.status}</Badge>
          </div>
          <DialogDescription>
            {batch.itemName} {batch.itemSku && `(${batch.itemSku})`} · Sucursal: {batch.branchName}
          </DialogDescription>
        </DialogHeader>

        {/* Resumen del Lote */}
        <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Caducidad</span>
              <span className="font-semibold">
                {batch.expirationDate
                  ? new Date(batch.expirationDate).toLocaleDateString("es-MX")
                  : "Sin fecha"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Recibido</span>
              <span className="font-semibold">
                {batch.receivedAt
                  ? new Date(batch.receivedAt).toLocaleDateString("es-MX")
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Costo unitario</span>
              <span className="font-semibold">
                {batch.unitCost != null ? `$${(batch.unitCost / 100).toFixed(2)}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Saldo actual</span>
              <span className="font-semibold tabular-nums">
                {batch.currentQuantity.toLocaleString("es-MX")} / {batch.initialQuantity.toLocaleString("es-MX")} {batch.itemUnit}
              </span>
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Consumo del lote</span>
              <span>{remainingPct}% restante</span>
            </div>
            <Progress value={remainingPct} className="h-1.5" />
          </div>
        </div>

        {/* Detalle de Trazabilidad */}
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>Consultando historial y consumos del lote...</span>
          </div>
        ) : (
          <Tabs defaultValue="productions" className="space-y-3">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="productions" className="gap-1.5 text-xs">
                <CookingPot className="h-3.5 w-3.5" />
                Producción ({trace?.productions.length || 0})
              </TabsTrigger>
              <TabsTrigger value="waste" className="gap-1.5 text-xs">
                <Trash2 className="h-3.5 w-3.5" />
                Mermas ({trace?.waste.length || 0})
              </TabsTrigger>
              <TabsTrigger value="movements" className="gap-1.5 text-xs">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Kardex ({trace?.movements.length || 0})
              </TabsTrigger>
            </TabsList>

            {/* Producciones */}
            <TabsContent value="productions" className="space-y-2">
              {!trace?.productions || trace.productions.length === 0 ? (
                <div className="p-6 text-center border rounded-lg bg-card text-muted-foreground text-xs">
                  Este lote no ha sido consumido en ninguna orden de producción de cocina.
                </div>
              ) : (
                <div className="border rounded-lg divide-y bg-card">
                  {trace.productions.map((p) => (
                    <div key={p.id} className="p-3 flex items-center justify-between text-xs gap-3">
                      <div>
                        <p className="font-semibold">{p.recipeName || "Receta"}</p>
                        <p className="text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Calendar className="h-3 w-3" />
                          {new Date(p.producedAt).toLocaleString("es-MX")}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-medium text-destructive">
                          -{p.actualQuantity.toFixed(2)} {p.unit}
                        </span>
                        <span className="text-muted-foreground block text-[11px]">
                          para {p.producedQuantity} porciones
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Mermas */}
            <TabsContent value="waste" className="space-y-2">
              {!trace?.waste || trace.waste.length === 0 ? (
                <div className="p-6 text-center border rounded-lg bg-card text-muted-foreground text-xs">
                  No se han registrado mermas o descartes de este lote.
                </div>
              ) : (
                <div className="border rounded-lg divide-y bg-card">
                  {trace.waste.map((w) => (
                    <div key={w.id} className="p-3 flex items-center justify-between text-xs gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="destructive" className="text-[10px] uppercase">
                            {w.reason}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground flex items-center gap-1 mt-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(w.createdAt).toLocaleString("es-MX")}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-medium text-destructive">
                          -{w.quantity.toFixed(2)} {w.unit}
                        </span>
                        {w.totalLoss != null && (
                          <span className="text-muted-foreground block text-[11px]">
                            Pérdida: ${(w.totalLoss / 100).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Movimientos Kardex */}
            <TabsContent value="movements" className="space-y-2">
              {!trace?.movements || trace.movements.length === 0 ? (
                <div className="p-6 text-center border rounded-lg bg-card text-muted-foreground text-xs">
                  Sin movimientos registrados en kardex para este lote.
                </div>
              ) : (
                <div className="border rounded-lg divide-y bg-card">
                  {trace.movements.map((m) => (
                    <div key={m.id} className="p-3 flex items-center justify-between text-xs gap-3">
                      <div>
                        <Badge variant="secondary" className="text-[10px]">
                          {m.type}
                        </Badge>
                        {m.reason && <p className="text-muted-foreground mt-0.5">{m.reason}</p>}
                        <p className="text-muted-foreground text-[11px] mt-0.5">
                          {new Date(m.timestamp).toLocaleString("es-MX")}
                        </p>
                      </div>
                      <span
                        className={`font-mono font-medium ${
                          m.quantityChange >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {m.quantityChange >= 0 ? `+${m.quantityChange}` : m.quantityChange}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
