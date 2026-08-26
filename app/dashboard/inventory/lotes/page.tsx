"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { useBatches, type BatchStatus, type InventoryBatch } from "@/hooks/queries/use-lots";
import { useBranches } from "@/hooks/queries/use-branches";
import {
  CalendarClock,
  Loader2,
  RefreshCw,
  AlertCircle,
  Search,
  Boxes,
} from "lucide-react";

// ── Configuración de estados y fechas ──

const STATUS_META: Record<BatchStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" }> = {
  AVAILABLE: { label: "Disponible", variant: "secondary" },
  RESERVED: { label: "Reservado", variant: "outline" },
  EXPIRED: { label: "Vencido", variant: "destructive" },
  QUARANTINED: { label: "Cuarentena", variant: "warning" },
  DEPLETED: { label: "Agotado", variant: "outline" },
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Días (calendario) hasta la fecha de vencimiento; null si el lote no la tiene. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - startOfToday().getTime()) / 86_400_000);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

/**
 * Insignia relativa de vencimiento; color por sí solo no es el estado (texto incluido).
 * Código de colores del manual (loteprod §5.3): rojo = caduca hoy o vencido,
 * amarillo = 1–2 días (usar primero), verde/sin marca = más de 3 días. El aviso
 * neutro de 3–7 días es informativo, no parte del semáforo.
 */
function ExpiryBadge({ days }: { days: number | null }) {
  if (days === null) {
    return <span className="text-xs text-muted-foreground">sin fecha</span>;
  }
  if (days < 0) {
    return <Badge variant="destructive">Vencido{days === -1 ? "" : ` hace ${-days} d`}</Badge>;
  }
  if (days === 0) {
    return <Badge variant="destructive">Vence hoy</Badge>;
  }
  if (days <= 2) {
    return <Badge variant="warning">Vence en {days} d · usar primero</Badge>;
  }
  if (days <= 7) {
    return <Badge variant="outline">Vence en {days} d</Badge>;
  }
  return null;
}

/**
 * Vista operativa de lotes en orden FEFO (primero el que vence primero).
 * El API entrega las filas ya ordenadas por expirationDate ASC; esta página
 * agrega filtros de sucursal/estado/texto y resumen de riesgo de caducidad.
 */
export default function LotsPage() {
  const branches = useBranches();

  const [branchFilter, setBranchFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [hideDepleted, setHideDepleted] = useState(true);
  const [search, setSearch] = useState("");

  const batches = useBatches({
    branchId: branchFilter !== "ALL" ? branchFilter : undefined,
    status: statusFilter !== "ALL" ? (statusFilter as BatchStatus) : undefined,
  });

  // Filtrado de texto + saldo cero en cliente; el orden FEFO del API se preserva.
  const rows = useMemo(() => {
    const all = batches.data?.batches ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((b) => {
      if (hideDepleted && b.currentQuantity <= 0) return false;
      if (!q) return true;
      return (
        b.itemName?.toLowerCase().includes(q) ||
        b.lotNumber?.toLowerCase().includes(q) ||
        b.itemSku?.toLowerCase().includes(q)
      );
    });
  }, [batches.data, search, hideDepleted]);

  // Resumen sobre los mismos filtros de selects (sin búsqueda, para que no bailen).
  const stats = useMemo(() => {
    let active = 0;
    let expired = 0;
    let soon = 0;
    let valueCents = 0;
    for (const b of batches.data?.batches ?? []) {
      if (hideDepleted && b.currentQuantity <= 0) continue;
      active += 1;
      const d = daysUntil(b.expirationDate);
      if ((d !== null && d < 0) || b.status === "EXPIRED") expired += 1;
      else if (d !== null && d <= 7) soon += 1;
      if (b.unitCost != null) valueCents += Math.round(b.currentQuantity * b.unitCost);
    }
    return { active, expired, soon, valueCents };
  }, [batches.data, hideDepleted]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarClock className="h-7 w-7 text-primary" /> Lotes
        </h1>
        <p className="text-sm text-muted-foreground">
          Stock por lote en orden FEFO: primero el que vence primero. La tabla ya está ordenada por fecha de vencimiento.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="filtro-sucursal" className="text-xs text-muted-foreground">Sucursal</Label>
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger id="filtro-sucursal" className="w-44 h-8">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas</SelectItem>
              {(branches.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="filtro-estado" className="text-xs text-muted-foreground">Estado</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="filtro-estado" className="w-40 h-8">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              {(Object.keys(STATUS_META) as BatchStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto, lote o SKU…"
            aria-label="Buscar por producto, lote o SKU"
            className="w-64 h-8 pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="ocultar-agotados" checked={hideDepleted} onCheckedChange={(v) => setHideDepleted(v === true)} />
          <Label htmlFor="ocultar-agotados" className="text-xs text-muted-foreground">Ocultar saldo en cero</Label>
        </div>
      </div>

      {/* Resumen de riesgo (color + texto accesible) */}
      {!batches.isLoading && !batches.isError && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span><span className="font-medium text-foreground tabular-nums">{stats.active}</span> lote(s) con saldo</span>
          <span className={stats.expired > 0 ? "text-destructive font-medium" : undefined}>
            {stats.expired} vencido(s)
          </span>
          <span className={stats.soon > 0 ? "text-amber-700 dark:text-amber-400 font-medium" : undefined}>
            {stats.soon} por vencer ≤7 días
          </span>
          <span>Valor aprox. del stock en lotes {formatCurrency(stats.valueCents)}</span>
        </div>
      )}

      {batches.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando lotes…
        </div>
      ) : batches.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudieron cargar los lotes"
          description={batches.error instanceof Error ? batches.error.message : "Intenta de nuevo."}
          action={
            <Button variant="outline" size="sm" onClick={() => batches.refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Sin lotes para los filtros actuales"
          description="Ajusta sucursal, estado o búsqueda. Los lotes nacen al recibir mercancía o producir."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-bold">Cola de consumo FEFO</CardTitle>
            <CardDescription className="text-xs">
              De arriba hacia abajo: lo que debe usarse primero. El saldo restante se muestra contra la cantidad inicial del lote.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className="py-2 pr-4 font-medium">Vencimiento</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Lote</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Producto</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Sucursal</th>
                    <th scope="col" className="py-2 px-3 font-medium text-right">Saldo</th>
                    <th scope="col" className="py-2 px-3 font-medium text-right">Costo unit.</th>
                    <th scope="col" className="py-2 px-3 font-medium text-right">Valor línea</th>
                    <th scope="col" className="py-2 pl-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((batch) => (
                    <LotRow key={batch.id} batch={batch} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LotRow({ batch }: { batch: InventoryBatch }) {
  const remainingPct =
    batch.initialQuantity > 0
      ? Math.min(100, Math.max(0, Math.round((batch.currentQuantity / batch.initialQuantity) * 100)))
      : 0;
  const lineValueCents =
    batch.unitCost != null ? Math.round(batch.currentQuantity * batch.unitCost) : null;
  const statusMeta = STATUS_META[batch.status] ?? { label: batch.status, variant: "outline" as const };
  const days = daysUntil(batch.expirationDate);

  return (
    <tr className={`border-b last:border-b-0 ${days !== null && days < 0 ? "bg-destructive/5" : ""}`}>
      <td className="py-3 pr-4 align-top">
        <p className="tabular-nums leading-tight">{formatDate(batch.expirationDate)}</p>
        <div className="mt-1"><ExpiryBadge days={days} /></div>
      </td>
      <td className="py-3 pr-4 align-top">
        {batch.lotNumber ? (
          <span className="font-mono text-xs">{batch.lotNumber}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-3 pr-4 align-top max-w-56">
        <p className="leading-tight truncate" title={batch.itemName}>{batch.itemName}</p>
        {batch.itemSku && <p className="text-xs text-muted-foreground">{batch.itemSku}</p>}
      </td>
      <td className="py-3 pr-4 align-top">{batch.branchName}</td>
      <td className="py-3 px-3 align-top text-right">
        <span className="tabular-nums font-medium">
          {batch.currentQuantity.toLocaleString("es-MX")}
        </span>{" "}
        <span className="text-xs text-muted-foreground">
          / {batch.initialQuantity.toLocaleString("es-MX")} {batch.itemUnit}
        </span>
        <Progress value={remainingPct} className="h-1 mt-1" aria-label={`${remainingPct}% restante`} />
      </td>
      <td className="py-3 px-3 align-top text-right tabular-nums">{formatCurrency(batch.unitCost)}</td>
      <td className="py-3 px-3 align-top text-right tabular-nums">{formatCurrency(lineValueCents)}</td>
      <td className="py-3 pl-3 align-top">
        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
      </td>
    </tr>
  );
}
