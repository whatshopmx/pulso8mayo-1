"use client";

// Proveedor principal y alterno de un insumo (manual loteprod §4). La gracia no
// es ver quién surte: es tener al sustituto ya aprobado ANTES de que el
// principal falle, y poder promoverlo en un clic el día que falla.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Loader2, Truck, Star, X } from "lucide-react";
import { toast } from "sonner";
import { preferenceRankLabel } from "@/lib/inventory/supplier-preference";
import { paymentConditionsLabel } from "@/lib/inventory/supplier-payment";

interface ItemSupplier {
  supplierId: string;
  supplierName: string;
  supplierActive: boolean;
  preferenceRank: number | null;
  supplierSku: string | null;
  price: number | null;
  presentation: string | null;
  leadTimeDays: number | null;
  paymentTermsDays: number;
  paymentMethod: string | null;
}

const formatMXN = (cents: number | null) =>
  cents == null
    ? "—"
    : (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export function ItemSuppliersManager({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<ItemSupplier[]>([]);
  const [catalogo, setCatalogo] = useState<{ id: string; name: string }[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [porAgregar, setPorAgregar] = useState<string>("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const [res, resSup] = await Promise.all([
          fetch(`/api/inventory/products/${itemId}/suppliers`),
          fetch("/api/inventory/suppliers"),
        ]);
        if (res.ok) {
          const data = await res.json();
          if (!cancelado) setRows(data?.data?.suppliers ?? []);
        }
        if (resSup.ok) {
          const data = await resSup.json();
          const lista = Array.isArray(data) ? data : (data?.suppliers ?? []);
          if (!cancelado) setCatalogo(lista);
        }
      } catch {
        if (!cancelado) toast.error("No se cargaron los proveedores del insumo");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [itemId]);

  const disponibles = useMemo(
    () => catalogo.filter((s) => !rows.some((r) => r.supplierId === s.id)),
    [catalogo, rows]
  );

  async function aplicar(supplierId: string, action: "SET_PRIMARY" | "ADD_ALTERNATE" | "CLEAR") {
    setAplicando(supplierId);
    try {
      const res = await fetch(`/api/inventory/products/${itemId}/suppliers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, action }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        toast.error("No se pudo actualizar", {
          description: payload?.error?.message ?? "Intenta de nuevo",
        });
        return;
      }
      setRows(payload.data.suppliers ?? []);
      setPorAgregar("");
      toast.success(
        action === "SET_PRIMARY"
          ? "Proveedor principal actualizado"
          : action === "ADD_ALTERNATE"
            ? "Proveedor agregado como alterno"
            : "Proveedor fuera del orden de preferencia"
      );
    } finally {
      setAplicando(null);
    }
  }

  const principal = rows.find((r) => r.preferenceRank === 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4 text-muted-foreground" />
          Proveedores del insumo
        </CardTitle>
        <CardDescription>
          El principal es a quien se le compra por default y con quien se agrupan las órdenes
          sugeridas. Los alternos existen para el día que el principal falle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cargando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Sin proveedores asignados"
            description="Agrega al menos uno: sin principal, el sugeridor de compra no puede armar la orden de este insumo."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-2 font-medium">Proveedor</th>
                  <th className="pb-2 font-medium">Rol</th>
                  <th className="pb-2 font-medium">SKU / presentación</th>
                  <th className="pb-2 font-medium">Precio</th>
                  <th className="pb-2 font-medium">Entrega</th>
                  <th className="pb-2 font-medium">Pago</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.supplierId} className="border-b last:border-b-0">
                    <td className="py-2">
                      <div className="font-medium">{r.supplierName}</div>
                      {!r.supplierActive && (
                        <span className="text-xs text-destructive">Proveedor inactivo</span>
                      )}
                    </td>
                    <td className="py-2">
                      {r.preferenceRank === 1 ? (
                        <Badge>Principal</Badge>
                      ) : r.preferenceRank ? (
                        <Badge variant="outline">{preferenceRankLabel(r.preferenceRank)}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin clasificar</span>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {r.supplierSku ?? "—"}
                      {r.presentation ? ` · ${r.presentation}` : ""}
                    </td>
                    <td className="py-2 tabular-nums">{formatMXN(r.price)}</td>
                    <td className="py-2 text-muted-foreground">
                      {r.leadTimeDays != null ? `${r.leadTimeDays} d` : "—"}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {paymentConditionsLabel(r.paymentTermsDays, r.paymentMethod)}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {r.preferenceRank !== 1 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shadow-none"
                          disabled={aplicando !== null}
                          onClick={() => aplicar(r.supplierId, "SET_PRIMARY")}
                        >
                          {aplicando === r.supplierId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Star className="h-3.5 w-3.5" />
                          )}
                          Hacer principal
                        </Button>
                      )}
                      {r.preferenceRank !== null && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-1 shadow-none"
                          disabled={aplicando !== null}
                          onClick={() => aplicar(r.supplierId, "CLEAR")}
                          title="Sacar del orden de preferencia sin borrarlo del catálogo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!cargando && !principal && rows.length > 0 && (
          <p className="text-xs text-destructive">
            Este insumo no tiene proveedor principal: el sugeridor de compra lo va a saltar al
            armar órdenes.
          </p>
        )}

        {!cargando && disponibles.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-56 flex-1 space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="agregar-proveedor">
                Agregar proveedor al insumo
              </label>
              <Select value={porAgregar} onValueChange={setPorAgregar}>
                <SelectTrigger id="agregar-proveedor">
                  <SelectValue placeholder="Selecciona un proveedor…" />
                </SelectTrigger>
                <SelectContent>
                  {disponibles.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="shadow-none"
              disabled={!porAgregar || aplicando !== null}
              onClick={() => aplicar(porAgregar, "ADD_ALTERNATE")}
            >
              {rows.length === 0 ? "Agregar como principal" : "Agregar como alterno"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
