"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useControlReport } from "@/hooks/queries/use-control-report";
import { useBranch } from "@/lib/branch-context";
import type { BudgetExecutionRow, SemaphoreStatus } from "@/lib/services/control-kpi-types";
import {
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Loader2,
  RefreshCw,
  Siren,
  Store,
  Tags,
  Truck,
  Wallet,
} from "lucide-react";

// ── Utilidades de mes y dinero ──

/** Mes corriente en zona horaria local (no UTC: evita corrimiento de mes). */
function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

/** Porcentaje o guion: un "0.0%" donde no hay base se lee como un dato real. */
function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

// ── Semáforo ──

const STATUS_BADGE: Record<
  SemaphoreStatus,
  { variant: "success" | "warning" | "destructive"; label: string }
> = {
  OK: { variant: "success", label: "En meta" },
  WARNING: { variant: "warning", label: "Atención" },
  CRITICAL: { variant: "destructive", label: "Fuera de meta" },
};

function StatusBadge({ status, label }: { status: SemaphoreStatus | null; label?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const cfg = STATUS_BADGE[status];
  return <Badge variant={cfg.variant}>{label ?? cfg.label}</Badge>;
}

/** Desviación: sobregiro en rojo, ahorro en neutro. */
function DeviationCell({ row }: { row: BudgetExecutionRow }) {
  if (row.unbudgeted) {
    return (
      <span className="text-destructive font-medium">
        {formatCurrency(row.deviationCents)}
        <span className="sr-only"> comprometido sin presupuesto capturado</span>
      </span>
    );
  }
  if (row.deviationCents > 0) {
    return (
      <span className="text-destructive font-medium">+{formatCurrency(row.deviationCents)}</span>
    );
  }
  return <span className="text-muted-foreground">{formatCurrency(row.deviationCents)}</span>;
}

/**
 * KPIs gerenciales de control OC/OS (Task 10, finzasordenes.md §7).
 * Fase 1: ejecución presupuestal por sucursal×centro y % de compras de emergencia.
 */
export default function ControlReportPage() {
  const { selectedBranchId } = useBranch();
  const [month, setMonth] = useState(currentMonthValue);

  const report = useControlReport(month, selectedBranchId ?? undefined);

  // Solo las celdas con presupuesto o gasto: el grid completo sucursal×centro
  // vive en /dashboard/budgets; aquí interesa lo que se movió.
  const activeRows = useMemo(
    () =>
      (report.data?.budgetExecution.rows ?? []).filter(
        (r) => r.budgetedCents > 0 || r.committedCents > 0,
      ),
    [report.data],
  );

  const totals = report.data?.budgetExecution.totals;
  const emergency = report.data?.emergencyShare;
  const targets = report.data?.targets;
  const priceComparison = report.data?.priceComparison ?? [];
  const supplierRanking = report.data?.supplierRanking ?? [];
  const branchCount = report.data?.branchCount ?? 0;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gauge className="h-7 w-7 text-primary" /> Control gerencial
          </h1>
          <p className="text-sm text-muted-foreground">
            Ejecución presupuestal y disciplina de compra del mes, sobre OC/OS que comprometen
            presupuesto.
          </p>
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Selector de mes">
          <Button
            variant="outline"
            size="icon"
            aria-label="Mes anterior"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label="Mes del reporte"
            className="w-44"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Mes siguiente"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {report.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando KPIs de {monthLabel(month)}…
        </div>
      ) : report.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudieron cargar los KPIs"
          description={report.error instanceof Error ? report.error.message : "Intenta de nuevo."}
          action={
            <Button variant="outline" size="sm" onClick={() => report.refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Ejecución presupuestal del mes */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-muted-foreground" /> Ejecución presupuestal
                    </CardTitle>
                    <CardDescription className="capitalize">{monthLabel(month)}</CardDescription>
                  </div>
                  <StatusBadge status={totals?.status ?? null} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">
                    {formatPercent(totals?.consumedPercent)}
                  </span>
                  <span className="text-sm text-muted-foreground">consumido</span>
                </div>
                <Progress value={Math.min(100, totals?.consumedPercent ?? 0)} />
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Presupuestado</dt>
                    <dd className="font-medium tabular-nums">
                      {formatCurrency(totals?.budgetedCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Comprometido</dt>
                    <dd className="font-medium tabular-nums">
                      {formatCurrency(totals?.committedCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Disponible</dt>
                    <dd
                      className={`font-medium tabular-nums ${
                        (totals?.availableCents ?? 0) < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatCurrency(totals?.availableCents)}
                    </dd>
                  </div>
                </dl>
                {totals?.unbudgeted && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Hay gasto comprometido contra centros de costo sin presupuesto capturado.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* % de compras de emergencia */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Siren className="h-4 w-4 text-muted-foreground" /> Compras de emergencia
                    </CardTitle>
                    <CardDescription>
                      Meta: menos de {targets?.emergencyTargetPercent ?? 5}% del gasto comprometido
                    </CardDescription>
                  </div>
                  <StatusBadge status={emergency?.status ?? null} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">
                    {formatPercent(emergency?.percent)}
                  </span>
                  <span className="text-sm text-muted-foreground">del gasto del mes</span>
                </div>
                <Progress value={Math.min(100, emergency?.percent ?? 0)} />
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">En emergencias</dt>
                    <dd className="font-medium tabular-nums">
                      {formatCurrency(emergency?.emergencyCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Gasto total</dt>
                    <dd className="font-medium tabular-nums">
                      {formatCurrency(emergency?.totalCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Documentos</dt>
                    <dd className="font-medium tabular-nums">
                      {emergency?.emergencyCount ?? 0} de {emergency?.totalCount ?? 0}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Cuenta OC con tipo EMERGENCIA y OS con urgencia EMERGENCIA, en estados que
                  comprometen presupuesto.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Desviación por sucursal × centro de costo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Desviación por partida</CardTitle>
              <CardDescription>
                Sucursal × centro de costo con presupuesto capturado o gasto comprometido en el mes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeRows.length === 0 ? (
                <EmptyState
                  icon={Wallet}
                  bare
                  title="Sin movimiento presupuestal en el mes"
                  description="No hay presupuesto capturado ni OC/OS aprobadas que comprometan partidas en este período."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sucursal</TableHead>
                        <TableHead>Centro de costo</TableHead>
                        <TableHead className="text-right">Presupuestado</TableHead>
                        <TableHead className="text-right">Comprometido</TableHead>
                        <TableHead className="text-right">Desviación</TableHead>
                        <TableHead className="text-right">Consumo</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeRows.map((row) => (
                        <TableRow key={`${row.branchId}:${row.costCenterId}`}>
                          <TableCell className="font-medium">
                            {row.branchCode ?? row.branchName}
                          </TableCell>
                          <TableCell>
                            {row.costCenterCode}
                            <span className="text-muted-foreground"> · {row.costCenterName}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.unbudgeted ? (
                              <span className="text-muted-foreground">Sin capturar</span>
                            ) : (
                              formatCurrency(row.budgetedCents)
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(row.committedCents)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <DeviationCell row={row} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(row.consumedPercent)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              status={row.status}
                              label={row.unbudgeted ? "Sin presupuesto" : undefined}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comparativo de precios del mismo insumo entre sucursales */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tags className="h-4 w-4 text-muted-foreground" /> Comparativo de precios entre
                sucursales
              </CardTitle>
              <CardDescription>
                Precio unitario promedio ponderado por sucursal, sobre OC del mes en estados que
                comprometen. La dispersión se mide contra la sucursal que mejor compró.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {branchCount < 2 ? (
                <EmptyState
                  icon={Store}
                  bare
                  title="El comparativo necesita al menos dos sucursales"
                  description="El alcance actual es de una sola sucursal. Quita el filtro de sucursal para comparar precios entre ellas."
                />
              ) : priceComparison.length === 0 ? (
                <EmptyState
                  icon={Tags}
                  bare
                  title="Sin insumos comparables este mes"
                  description="Ningún insumo se compró en más de una sucursal con órdenes que comprometan presupuesto."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Insumo</TableHead>
                        <TableHead>Sucursales</TableHead>
                        <TableHead className="text-right">Mejor precio</TableHead>
                        <TableHead className="text-right">Peor precio</TableHead>
                        <TableHead className="text-right">Dispersión</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {priceComparison.map((item) => (
                        <TableRow key={item.itemId}>
                          <TableCell className="font-medium">
                            {item.itemName}
                            <span className="text-muted-foreground text-xs"> / {item.unit}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {item.branches
                              .map(
                                (b) =>
                                  `${b.branchCode ?? b.branchName} ${formatCurrency(b.unitCostCents)}`,
                              )
                              .join(" · ")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.minCents)}
                            <span className="text-muted-foreground text-xs">
                              {" "}
                              {item.cheapestBranch}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.maxCents)}
                            <span className="text-muted-foreground text-xs">
                              {" "}
                              {item.dearestBranch}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(item.spreadPercent)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={item.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ranking de proveedores por monto */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" /> Ranking de proveedores
              </CardTitle>
              <CardDescription>
                Gasto comprometido del mes por proveedor (OC + OS). Los documentos sin proveedor
                asignado quedan fuera porque no son atribuibles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {supplierRanking.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  bare
                  title="Sin gasto atribuido a proveedores este mes"
                  description="No hay OC ni OS con proveedor asignado en estados que comprometan presupuesto."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Proveedor</TableHead>
                        <TableHead className="text-right">Documentos</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead>Participación</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {supplierRanking.map((s) => (
                        <TableRow key={s.supplierId}>
                          <TableCell className="font-medium">{s.supplierName}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {s.purchaseOrders > 0 && `${s.purchaseOrders} OC`}
                            {s.purchaseOrders > 0 && s.serviceOrders > 0 && " · "}
                            {s.serviceOrders > 0 && `${s.serviceOrders} OS`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(s.totalCents)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={s.sharePercent} className="h-1.5 w-24" />
                              <span className="tabular-nums text-xs text-muted-foreground w-12">
                                {s.sharePercent.toFixed(1)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
