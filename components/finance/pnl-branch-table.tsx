"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, Info, Loader2, AlertTriangle, AlertCircle } from "lucide-react";
import type { BranchPnL, LineSource, PnLLine } from "@/lib/services/pnl-types";

export type BranchPnLItem = BranchPnL;

/**
 * Regla de presentación (docs/plan-pnl-real.md §3.2):
 *
 *  - MEASURED       → se muestra normal.
 *  - DERIVED        → marcado con † y la nota del método.
 *  - SECTOR_DEFAULT → marcado con * : NO son datos del cliente.
 *  - NO_DATA        → guion, NUNCA cero. Un cero se lee como "no gastamos nada".
 */
const MARKER: Record<LineSource, string> = {
  MEASURED: "",
  DERIVED: "†",
  SECTOR_DEFAULT: "*",
  NO_DATA: "",
};

const SOURCE_CLASS: Record<LineSource, string> = {
  MEASURED: "",
  DERIVED: "text-warning-text",
  SECTOR_DEFAULT: "text-warning-text italic",
  NO_DATA: "text-muted-foreground",
};

const formatMXN = (cents: number) =>
  (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Nota de celda accesible: Tooltip Radix (foco de teclado + táctil) en vez de `title`. */
function NoteTip({ note, children }: { note?: string | null; children: ReactNode }) {
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

/** Celda de dinero o porcentaje que respeta la procedencia del renglón. */
function LineCell({
  value,
  mode,
  className = "",
}: {
  value: PnLLine;
  mode: "money" | "percent";
  className?: string;
}) {
  const isNoData = value.source === "NO_DATA";
  const percentUnavailable = mode === "percent" && value.percentOfSales === null;

  // Sin datos (o sin ventas contra las que calcular un %) → guion, no cero.
  if (isNoData || percentUnavailable) {
    return (
      <TableCell className={`text-right text-muted-foreground ${className}`}>
        <NoteTip note={value.note}>
          <span aria-label="Sin datos">—</span>
        </NoteTip>
      </TableCell>
    );
  }

  return (
    <TableCell className={`text-right ${SOURCE_CLASS[value.source]} ${className}`}>
      <NoteTip note={value.note}>
        <span>
          {mode === "money" ? formatMXN(value.cents) : `${value.percentOfSales}%`}
          {MARKER[value.source] && (
            <sup className="ml-0.5 font-semibold" aria-hidden="true">
              {MARKER[value.source]}
            </sup>
          )}
        </span>
      </NoteTip>
    </TableCell>
  );
}

export function PnlBranchTable() {
  const [pnlData, setPnlData] = useState<BranchPnLItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyRed, setOnlyRed] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const loadPnL = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/finance/pnl");
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFailed(true);
        return;
      }
      setPnlData(json.data?.branches ?? []);
    } catch (err) {
      console.error("Failed to load P&L data:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPnL();
  }, [loadPnL]);

  // Totales del grupo. Solo se suman los renglones que tienen datos: un NO_DATA
  // no aporta cero, deja el total marcado como incompleto.
  const totals = useMemo(() => {
    const acc = {
      sales: 0,
      foodCost: 0,
      waste: 0,
      labor: 0,
      operatingExpenses: 0,
      operatingProfit: 0,
      salesHasData: false,
      incompleteLines: 0,
    };
    const lineHasData = {
      foodCost: false,
      waste: false,
      labor: false,
      operatingExpenses: false,
    };
    for (const b of pnlData) {
      if (b.sales.source !== "NO_DATA") {
        acc.sales += b.sales.cents;
        acc.salesHasData = true;
      }
      for (const key of ["foodCost", "waste", "labor", "operatingExpenses"] as const) {
        if (b[key].source === "NO_DATA") acc.incompleteLines += 1;
        else {
          acc[key] += b[key].cents;
          lineHasData[key] = true;
        }
      }
      if (b.operatingProfit.source !== "NO_DATA") acc.operatingProfit += b.operatingProfit.cents;
    }
    return { ...acc, lineHasData };
  }, [pnlData]);

  const groupCount = pnlData.length;
  const pct = (cents: number) =>
    totals.sales > 0 ? `${Number(((cents / totals.sales) * 100).toFixed(1))}%` : "—";

  /** Sucursales cuyo margen no es confiable porque algún insumo no es MEASURED. */
  const approximateCount = pnlData.filter((b) => b.weakestLine !== "MEASURED").length;

  /** Notas al pie: solo los métodos que realmente aparecen en la tabla. */
  const footnotes = useMemo(() => {
    const lines: string[] = [];
    const all = pnlData.flatMap((b) => [b.sales, b.foodCost, b.waste, b.labor, b.operatingExpenses]);
    if (all.some((l) => l.source === "SECTOR_DEFAULT")) {
      lines.push(
        "* Estimación sectorial HORECA: ese renglón NO se calcula con tus datos todavía. " +
          "Llega en cuanto tengas 2-4 semanas de captura.",
      );
    }
    if (all.some((l) => l.source === "DERIVED")) {
      lines.push(
        "† Calculado con tus datos pero por vía indirecta (compras en lugar de consumo, " +
          "o plantilla contratada en lugar de asistencia real). Pasa el cursor sobre la celda para ver el método.",
      );
    }
    if (all.some((l) => l.source === "NO_DATA")) {
      lines.push('"—" = sin datos capturados en el período. No es un cero: es un renglón que falta.');
    }
    lines.push(
      "La nómina es sueldo bruto: no incluye IMSS, INFONAVIT ni provisiones (aguinaldo, vacaciones, prima). " +
        "El número de tu contador será mayor.",
    );
    return lines;
  }, [pnlData]);

  const filtered = pnlData.filter((b) => {
    const matchesSearch = b.branchName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRed = onlyRed
      ? b.operatingProfit.source !== "NO_DATA" && b.operatingProfit.cents < 0
      : true;
    return matchesSearch && matchesRed;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> P&L Operativo por Sucursal (Neto sin IVA)
          </CardTitle>
          <CardDescription className="text-xs mt-0.5 max-w-[70ch]">
            Utilidad Operativa = Ventas − Alimentos − Merma − Nómina − Gastos Operativos.
          </CardDescription>
        </div>

        {groupCount > 3 && (
          <div className="flex items-center gap-2 self-start md:self-auto">
            <Input
              type="text"
              placeholder="Buscar sucursal..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="h-8 w-36 md:w-44 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              aria-pressed={onlyRed}
              onClick={() => {
                setOnlyRed(!onlyRed);
                setPage(1);
              }}
              className={`h-8 px-2.5 text-xs font-medium ${
                onlyRed ? "bg-destructive/10 text-destructive border-destructive/40" : "text-muted-foreground"
              }`}
            >
              {onlyRed ? "Ver Todas" : "En Rojo"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculando P&L por sucursal...
          </div>
        ) : failed ? (
          <EmptyState
            icon={AlertCircle}
            title="No se pudo cargar el P&L por sucursal"
            description="Error al conectar con el servicio de finanzas. Revisa tu conexión e intenta de nuevo."
            action={
              <Button variant="outline" size="sm" onClick={loadPnL}>
                Reintentar
              </Button>
            }
          />
        ) : pnlData.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Sin suficientes datos para consolidar el P&L de las sucursales.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Aviso de confiabilidad: si el margen se apoya en algo que no se
                midió, se dice antes de que el dueño lea el número. */}
            {approximateCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning-text">
                <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
                <span>
                  {approximateCount === groupCount
                    ? "El margen operativo es aproximado en todas las sucursales"
                    : `El margen operativo es aproximado en ${approximateCount} de ${groupCount} sucursales`}
                  : algún renglón todavía no se calcula con tus datos. Las celdas marcadas indican cuál.
                </span>
              </div>
            )}

            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-xs">
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Venta Neta</TableHead>
                    <TableHead className="text-right">Food Cost %</TableHead>
                    <TableHead className="text-right">Merma</TableHead>
                    <TableHead className="text-right">Nómina %</TableHead>
                    <TableHead className="text-right">Gastos Operativos</TableHead>
                    <TableHead className="text-right bg-success/5">Utilidad ($)</TableHead>
                    <TableHead className="text-right bg-success/5">Margen %</TableHead>
                    <TableHead className="text-center">Confianza</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Consolidado del grupo */}
                  <TableRow className="bg-primary/5 hover:bg-primary/10 font-bold text-xs border-b-2 border-primary/20">
                    <TableCell className="font-bold text-foreground flex items-center gap-1.5">
                      <span>TOTAL GRUPO</span>
                      <Badge variant="outline" className="text-xs py-0 font-normal">
                        {groupCount} sucursales
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {totals.salesHasData ? formatMXN(totals.sales) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {totals.lineHasData.foodCost ? pct(totals.foodCost) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {totals.lineHasData.waste ? formatMXN(totals.waste) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {totals.lineHasData.labor ? pct(totals.labor) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {totals.lineHasData.operatingExpenses
                        ? formatMXN(totals.operatingExpenses)
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-bold bg-success/10 ${
                        totals.operatingProfit >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {totals.salesHasData ? formatMXN(totals.operatingProfit) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-bold bg-success/10">
                      {pct(totals.operatingProfit)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={totals.incompleteLines > 0 ? "outline" : "secondary"}
                        className="text-xs gap-1 font-semibold"
                        title={
                          totals.incompleteLines > 0
                            ? `${totals.incompleteLines} renglón(es) sin datos entre todas las sucursales`
                            : "Todos los renglones tienen datos capturados"
                        }
                      >
                        <Info className="w-3 h-3" />
                        {totals.incompleteLines > 0 ? `${totals.incompleteLines} sin datos` : "Completo"}
                      </Badge>
                    </TableCell>
                  </TableRow>

                  {/* Sucursales */}
                  {paginated.map((item) => {
                    const approximate = item.weakestLine !== "MEASURED";
                    return (
                      <TableRow key={item.branchId} className="hover:bg-muted/40 transition text-xs">
                        <TableCell className="font-medium">
                          <Link
                            href={`/dashboard/branches?branchId=${item.branchId}`}
                            className="hover:underline text-foreground"
                          >
                            {item.branchName}
                          </Link>
                        </TableCell>
                        <LineCell value={item.sales} mode="money" className="font-medium" />
                        <LineCell value={item.foodCost} mode="percent" />
                        <LineCell value={item.waste} mode="money" />
                        <LineCell value={item.labor} mode="percent" />
                        <LineCell
                          value={item.operatingExpenses}
                          mode="money"
                          className="font-medium"
                        />
                        <TableCell
                          className={`text-right font-bold bg-success/5 ${
                            item.operatingProfit.source === "NO_DATA"
                              ? "text-muted-foreground"
                              : item.operatingProfit.cents >= 0
                                ? "text-success"
                                : "text-destructive"
                          }`}
                        >
                          <NoteTip note={item.operatingProfit.note}>
                            <span>
                              {item.operatingProfit.source === "NO_DATA"
                                ? "—"
                                : formatMXN(item.operatingProfit.cents)}
                              {approximate && item.operatingProfit.source !== "NO_DATA" && (
                                <sup className="ml-0.5" aria-hidden="true">
                                  ≈
                                </sup>
                              )}
                            </span>
                          </NoteTip>
                        </TableCell>
                        <LineCell
                          value={item.operatingProfit}
                          mode="percent"
                          className="font-bold bg-success/5"
                        />
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={`text-xs gap-1 ${
                              approximate
                                ? "border-warning/40 text-warning-text"
                                : "bg-muted/30"
                            }`}
                            title={
                              approximate
                                ? `Renglón más débil: ${item.weakestLine}. ${item.operatingProfit.note}`
                                : "Los cuatro renglones se calcularon con tus datos"
                            }
                          >
                            {approximate ? (
                              <>
                                <AlertTriangle className="w-3 h-3" /> Aproximado
                              </>
                            ) : (
                              <>
                                <Info className="w-3 h-3 text-muted-foreground" /> Medido
                              </>
                            )}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {paginated.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-6 text-xs text-muted-foreground">
                        No se encontraron sucursales con el filtro actual.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Notas al pie: la parte que hace que este P&L sea seguro de mostrar. */}
            <div className="space-y-1 pt-1 text-xs leading-relaxed text-muted-foreground max-w-[70ch]">
              {footnotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                <span>
                  Mostrando {((currentPage - 1) * pageSize) + 1}–
                  {Math.min(currentPage * pageSize, filtered.length)} de {filtered.length} sucursales
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-md border border-input bg-background hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    Anterior
                  </button>
                  <span className="font-medium text-foreground">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 rounded-md border border-input bg-background hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
