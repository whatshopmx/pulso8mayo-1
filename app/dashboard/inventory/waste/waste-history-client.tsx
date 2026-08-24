"use client";

// Historial de Mermas (plan-mermas-historial Task 2). Patrón de
// movements-client.tsx: filtros locales → useWasteHistory paginado.
//
// El resumen lo calcula la API en SQL con los MISMOS filtros de la lista, así
// que los totales no cambian al paginar. Pérdida real excluye STAFF/COURTESY
// (consumo interno, OQ-1) — mismo criterio que el reporte operacional.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared";
import { DataTableSkeleton } from "@/components/shared/skeletons";
import { useExportCsv } from "@/components/shared/use-export-csv";
import { useWasteHistory } from "@/hooks/queries";
import { formatQty } from "@/lib/utils";
import {
  REASON_FILTER_OPTIONS,
  REASON_LABELS,
  isInternalConsumption,
  originLabel,
} from "@/lib/inventory/waste-labels";
import { Download, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { WasteDetailSheet, type WasteRecordRow } from "./waste-detail-sheet";

const PAGE_SIZE = 50;

const formatMXN = (cents: number | null) =>
  cents == null
    ? "—"
    : (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** YYYY-MM-DD local (los date inputs y el GET trabajan en días sueltos). */
function dayISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Primer día del mes en curso — default decidido para el filtro de periodo. */
function startOfMonthISO(): string {
  const now = new Date();
  return dayISO(new Date(now.getFullYear(), now.getMonth(), 1));
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: "alert" | "muted" }) {
  return (
    <div className="rounded-lg border bg-sidebar p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "alert" ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}

export function WasteHistoryClient({ branchId }: { branchId: string }) {
  // Periodo default: mes en curso (decisión del plan).
  const [dateFrom, setDateFrom] = useState(startOfMonthISO);
  const [dateTo, setDateTo] = useState(dayISO(new Date()));
  const [reason, setReason] = useState<string>("");
  const [origin, setOrigin] = useState<string>("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<WasteRecordRow | null>(null);
  const { exportToCsv } = useExportCsv();

  const params = useMemo(
    () => ({
      branchId,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      reason: reason || undefined,
      origin: origin || undefined,
      category: category.trim() || undefined,
      q: search.trim() || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [branchId, dateFrom, dateTo, reason, origin, category, search, page]
  );

  const { data, isLoading, isError } = useWasteHistory(params);
  const rows: WasteRecordRow[] = data?.waste ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const summary = data?.summary;
  const topReason = summary?.byReason?.find((r: { reason: string }) => !isInternalConsumption(r.reason));
  const internalCents = (summary?.totalLossCents ?? 0) - (summary?.trueWasteLossCents ?? 0);

  const hasActiveFilters =
    Boolean(reason || origin || category.trim() || search.trim()) ||
    dateFrom !== startOfMonthISO() ||
    dateTo !== dayISO(new Date());

  const resetFilters = () => {
    setDateFrom(startOfMonthISO());
    setDateTo(dayISO(new Date()));
    setReason("");
    setOrigin("");
    setCategory("");
    setSearch("");
    setPage(0);
  };

  const handleExportCSV = () => {
    exportToCsv({
      headers: ["Fecha", "Producto", "SKU", "Categoría", "Cantidad", "Unidad", "Motivo", "Origen", "Pérdida", "Lote", "Registró"],
      rows: rows.map((r) => [
        r.waste.recordedAt ? new Date(r.waste.recordedAt).toLocaleString("es-MX") : "",
        r.item.name ?? "",
        r.item.sku ?? "",
        r.item.category ?? "",
        String(formatQty(r.waste.quantity)),
        r.waste.unit,
        REASON_LABELS[r.waste.reason as keyof typeof REASON_LABELS]?.label ?? r.waste.reason,
        originLabel(r.waste.origin).label,
        r.waste.totalLoss != null ? formatMXN(r.waste.totalLoss) : "",
        r.batch.lotNumber ?? "",
        r.recordedByUser?.name ?? r.waste.recordedBy,
      ]),
      filename: "mermas",
      useBom: true,
    });
  };

  return (
    <div className="space-y-4">
      {/* Resumen del periodo filtrado — números estables aunque se pagine */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <SummaryStat label="Registros" value={String(summary?.count ?? 0)} />
        <SummaryStat label="Pérdida real por merma" value={formatMXN(summary?.trueWasteLossCents ?? 0)} tone="alert" />
        <SummaryStat label="Consumo interno (personal/cortesía)" value={formatMXN(internalCents)} tone="muted" />
        <SummaryStat
          label="Top motivo"
          value={topReason ? REASON_LABELS[topReason.reason as keyof typeof REASON_LABELS]?.label ?? topReason.reason : "—"}
          tone="muted"
        />
      </div>

      {/* Filtros */}
      <div className="bg-sidebar border border-border rounded-lg p-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="h-8 w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="h-8 w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <Select value={reason || "all"} onValueChange={(v) => { setReason(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {REASON_FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Origen</Label>
            <Select value={origin || "all"} onValueChange={(v) => { setOrigin(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="manual">Captura manual</SelectItem>
                {Object.entries({
                  workflow_merma: "Workflow WhatsApp",
                  diferencia_conteo: "Varianza de conteo",
                  lote_insuficiente: "Producción",
                }).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Categoría</Label>
            <Input
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(0); }}
              placeholder="Ej. CARNES"
              className="h-8 w-32"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Buscar producto</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Nombre o SKU..."
                className="h-8 pl-7 w-44"
              />
            </div>
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 shadow-none">
              <X className="h-3.5 w-3.5 mr-1" /> Limpiar
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={rows.length === 0} className="shadow-none bg-background">
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/inventory/waste?registrar=1">
              <Plus className="h-4 w-4 mr-2" />
              Registrar merma
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <DataTableSkeleton columns={7} rows={8} />
      ) : isError ? (
        <EmptyState
          icon={Trash2}
          title="No se pudo cargar el historial"
          description="Ocurrió un error consultando las mermas."
        />
      ) : rows.length === 0 ? (
        <div className="py-16">
          <EmptyState
            icon={Trash2}
            title="Sin mermas en este periodo"
            description="No hay registros con los filtros seleccionados. Ajusta las fechas o registra una nueva merma."
          />
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead className="text-right">Pérdida</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Registró</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const rl = REASON_LABELS[r.waste.reason as keyof typeof REASON_LABELS] ?? { label: r.waste.reason, variant: "outline" as const };
                const ol = originLabel(r.waste.origin);
                const interno = isInternalConsumption(r.waste.reason);
                return (
                  <TableRow
                    key={r.waste.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.waste.recordedAt).toLocaleString("es-MX", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/inventory/${r.item.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium hover:underline"
                      >
                        {r.item.name ?? "N/A"}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {[r.item.sku, r.item.category].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatQty(r.waste.quantity)} {r.waste.unit}
                    </TableCell>
                    <TableCell>
                      <Badge variant={interno ? "secondary" : rl.variant}>{rl.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ol.variant}>{ol.label}</Badge>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${interno ? "text-muted-foreground" : "text-destructive"}`}>
                      {formatMXN(r.waste.totalLoss)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.batch.lotNumber ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                      {r.recordedByUser?.name ?? r.waste.recordedBy}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border rounded-lg bg-sidebar">
              <p className="text-sm text-muted-foreground">
                {total} registros (pág. {page + 1} de {totalPages})
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <WasteDetailSheet record={selected} open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}
