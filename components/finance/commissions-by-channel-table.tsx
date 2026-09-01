"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, AlertTriangle, Loader2, TrendingDown } from "lucide-react";
import { formatCents } from "@/lib/utils";
import { useBranch } from "@/lib/branch-context";
import { commissionChannelLabel, formatRateBps } from "@/lib/services/commission-types";
import type { ChannelCommission } from "@/lib/services/commission-types";

interface BranchRow {
  branchId: string;
  branchName: string;
  channels: ChannelCommission[];
  totalCommissionCents: number;
  coveredSalesCents: number;
  uncoveredSalesCents: number;
  source: "MEASURED" | "ESTIMATED" | "NO_DATA";
  coveragePercent: number;
  note: string;
}

/** Nota accesible: Tooltip Radix, no `title` (inalcanzable por teclado). */
function NoteTip({ note, children }: { note?: string | null; children: React.ReactNode }) {
  if (!note) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{note}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Comisiones del período por sucursal y canal.
 *
 * La tabla se organiza por canal y no por sucursal porque la pregunta que la
 * justifica —"¿me conviene Rappi?"— se contesta comparando canales entre sí:
 * qué venta entra por cada uno y cuánto de esa venta se queda el intermediario.
 * La comparación entre sucursales ya la da el P&L.
 */
export function CommissionsByChannelTable() {
  const { selectedBranchId } = useBranch();
  const searchParams = useSearchParams();
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";

  const [rows, setRows] = useState<BranchRow[]>([]);
  const [period, setPeriod] = useState<{ startDate: string; endDate: string; days: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (selectedBranchId) qs.set("branchId", selectedBranchId);
      if (startDate) qs.set("from", startDate);
      if (endDate) qs.set("to", endDate);
      const res = await fetch(`/api/finance/commissions${qs.size ? `?${qs}` : ""}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || json.error || "No se pudieron cargar las comisiones.");
      }
      setRows(json.data?.branches ?? []);
      setPeriod(json.data?.period ?? null);
    } catch (err) {
      // Vaciar es parte del arreglo: dejar en pantalla las cifras del alcance
      // anterior bajo la etiqueta del nuevo es peor que no mostrar nada.
      setRows([]);
      setError(err instanceof Error ? err.message : "Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  /** Consolidado por canal a través de las sucursales del alcance. */
  const porCanal = useMemo(() => {
    const acc = new Map<
      string,
      { baseSalesCents: number; commissionCents: number; rates: Set<number>; measured: boolean }
    >();
    for (const row of rows) {
      for (const c of row.channels) {
        const prev = acc.get(c.channel) ?? {
          baseSalesCents: 0,
          commissionCents: 0,
          rates: new Set<number>(),
          measured: true,
        };
        prev.baseSalesCents += c.baseSalesCents;
        prev.commissionCents += c.commissionCents;
        if (c.rateBps !== null) prev.rates.add(c.rateBps);
        if (c.source !== "MEASURED") prev.measured = false;
        acc.set(c.channel, prev);
      }
    }
    return [...acc.entries()]
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.commissionCents - a.commissionCents);
  }, [rows]);

  const totalComision = porCanal.reduce((s, c) => s + c.commissionCents, 0);
  const totalBase = porCanal.reduce((s, c) => s + c.baseSalesCents, 0);
  const sinCubrir = rows.reduce((s, r) => s + r.uncoveredSalesCents, 0);
  const sinTarifa = rows.filter((r) => r.source === "NO_DATA").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <TrendingDown className="h-5 w-5 text-primary" /> Comisiones por Canal
        </CardTitle>
        <CardDescription className="text-xs max-w-[80ch]">
          Cuánto de cada peso vendido se queda el intermediario, canal por canal. Es un{" "}
          <span className="font-medium">cálculo</span> con la tarifa que configuraste, no un importe
          medido: el sistema no tiene el monto neto de ninguna liquidación.
          {period && (
            <>
              {" "}
              <span className="font-medium text-foreground">
                Período: {period.startDate} a {period.endDate} ({period.days} días).
              </span>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculando comisiones...
          </div>
        ) : error ? (
          <EmptyState
            bare
            icon={AlertCircle}
            title="No se pudieron cargar las comisiones"
            description={error}
            action={
              <Button variant="outline" size="sm" onClick={load}>
                Reintentar
              </Button>
            }
          />
        ) : (
          <>
            {/* La venta sin tarifa es el dato que decide si esta pantalla se
                puede creer. Se dice antes de la tabla, no en una nota al pie. */}
            {(sinCubrir > 0 || sinTarifa > 0) && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning-text">
                <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
                <span className="max-w-[85ch]">
                  {sinCubrir > 0 && (
                    <>
                      {formatCents(sinCubrir)} de venta pasó por canales sin tarifa configurada y no
                      se estimó.{" "}
                    </>
                  )}
                  {sinTarifa > 0 && (
                    <>
                      {sinTarifa} sucursal{sinTarifa !== 1 ? "es" : ""} sin ninguna comisión
                      calculable en el período.{" "}
                    </>
                  )}
                  Su renglón del P&amp;L queda en &quot;sin datos&quot;, no en cero: configura la
                  tarifa del canal para que el margen deje de ignorar ese costo.
                </span>
              </div>
            )}

            {porCanal.length === 0 ? (
              <EmptyState
                bare
                icon={TrendingDown}
                title="Sin comisiones calculables en el período"
                description="Hacen falta dos cosas: cortes con venta por tarjeta o agregador, y una tarifa configurada para esos canales."
              />
            ) : (
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableCaption className="sr-only">
                    Comisiones por canal: venta valuada, tarifa aplicada, comisión y venta neta
                    después de comisión.
                  </TableCaption>
                  <TableHeader>
                    <TableRow className="bg-muted/50 text-xs">
                      <TableHead>Canal</TableHead>
                      <TableHead className="text-right">Venta del canal</TableHead>
                      <TableHead className="text-right">Tarifa</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                      <TableHead className="text-right">Te queda</TableHead>
                      <TableHead className="text-right">% de la venta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {porCanal.map((c) => {
                      const neto = c.baseSalesCents - c.commissionCents;
                      const pct =
                        c.baseSalesCents > 0
                          ? ((c.commissionCents / c.baseSalesCents) * 100).toFixed(1)
                          : null;
                      const tarifa =
                        c.rates.size === 1
                          ? formatRateBps([...c.rates][0])
                          : c.rates.size > 1
                            ? "varias"
                            : "conciliada";
                      return (
                        <TableRow key={c.channel} className="hover:bg-muted/40 transition text-sm">
                          <TableCell className="font-medium">
                            {commissionChannelLabel(c.channel)}
                            {c.measured && (
                              <Badge variant="outline" className="ml-2 text-xs py-0">
                                conciliada
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCents(c.baseSalesCents)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            <NoteTip
                              note={
                                c.rates.size > 1
                                  ? "En el período rigieron varias vigencias de tarifa. Cada corte se valuó con la suya; un solo porcentaje no las representa."
                                  : c.rates.size === 0
                                    ? "El importe salió de la comisión conciliada contra el depósito de la terminal, no de una tarifa."
                                    : null
                              }
                            >
                              <span>{tarifa}</span>
                            </NoteTip>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-warning-text">
                            {formatCents(c.commissionCents)}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatCents(neto)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pct !== null ? `${pct}%` : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    <TableRow className="bg-primary/5 font-bold text-sm border-t-2 border-primary/20">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(totalBase)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums">
                        {formatCents(totalComision)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(totalBase - totalComision)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {totalBase > 0
                          ? `${((totalComision / totalBase) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Detalle por sucursal: sólo cuando hay más de una en el alcance,
                para no repetir la tabla de arriba con otro encabezado. */}
            {rows.length > 1 && porCanal.length > 0 && (
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableCaption className="sr-only">
                    Comisión total por sucursal, con la cobertura del cálculo.
                  </TableCaption>
                  <TableHeader>
                    <TableRow className="bg-muted/50 text-xs">
                      <TableHead>Sucursal</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                      <TableHead className="text-right">Venta valuada</TableHead>
                      <TableHead className="text-right">Sin tarifa</TableHead>
                      <TableHead>Canales</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.branchId} className="hover:bg-muted/40 transition text-xs">
                        <TableCell className="font-medium">
                          <NoteTip note={r.note}>
                            <span>{r.branchName}</span>
                          </NoteTip>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {r.source === "NO_DATA" ? (
                            <span className="text-muted-foreground" aria-label="Sin datos">
                              —
                            </span>
                          ) : (
                            formatCents(r.totalCommissionCents)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatCents(r.coveredSalesCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.uncoveredSalesCents > 0 ? (
                            <span className="text-warning-text">
                              {formatCents(r.uncoveredSalesCents)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.channels.length > 0
                            ? r.channels.map((c) => commissionChannelLabel(c.channel)).join(", ")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
