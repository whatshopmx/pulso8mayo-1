"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useBranch } from "@/lib/branch-context";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import {
  AGING_BUCKET_LABELS,
  type AccountsPayableResult,
  type AgingBucket,
  type PayableItem,
} from "@/lib/services/accounts-payable-types";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";

/**
 * Cuentas por Pagar.
 *
 * El diseño (M15) define la CxP como consecuencia de conciliar una factura:
 * "entra al calendario de pagos con fecha de vencimiento". Antes de la
 * migración 0040 eso no podía existir — `invoices` no tenía vencimiento ni
 * estatus de pago — así que el módulo de finanzas podía decir cuánto se gastó
 * pero no cuánto se debe.
 *
 * La pregunta que contesta esta pantalla es la del lunes: qué pago esta semana,
 * a quién le debo más, y qué ya se me pasó.
 */

const BUCKET_TONE: Record<AgingBucket, Parameters<typeof statusBadgeClasses>[0]> = {
  OVERDUE: "destructive",
  DUE_7: "warning",
  DUE_15: "info",
  DUE_30: "neutral",
  DUE_LATER: "neutral",
  NO_DUE_DATE: "neutral",
};

const SOURCE_LABEL: Record<PayableItem["source"], string> = {
  INVOICE: "Factura CFDI",
  OPERATING_EXPENSE: "Gasto operativo",
};

export default function PayablesPage() {
  const { selectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";

  const [data, setData] = useState<AccountsPayableResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const url = new URL("/api/finance/payables", window.location.origin);
        if (selectedBranch !== "ALL") url.searchParams.set("branchId", selectedBranch);

        const res = await fetch(url.toString());
        const json = await res.json();
        if (res.ok && json.success) {
          setData(json.data);
        } else {
          // Una lista de deuda que no cargó no es una lista vacía. Presentarlas
          // igual haría creer que no se debe nada.
          setError(json?.error || "El servidor no devolvió las cuentas por pagar.");
          setData(null);
        }
      } catch (err) {
        console.error("Failed to load payables:", err);
        setError("Error de conexión al cargar las cuentas por pagar.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [selectedBranch],
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" /> Cuentas por Pagar
          </h1>
          <p className="text-sm text-muted-foreground">
            Facturas de proveedores y gastos autorizados que aún no salen de la cuenta, ordenados por
            urgencia.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Calculando lo que se debe...
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudieron cargar las cuentas por pagar"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No hay nada por pagar"
          description="Sin facturas de proveedores pendientes ni gastos autorizados sin liquidar en el alcance seleccionado."
        />
      ) : (
        <>
          {/* Los tres números del lunes. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total por pagar</p>
                <p className="text-2xl font-bold tabular-nums">{formatCents(data.totalCents)}</p>
                <p className="text-xs text-muted-foreground">{data.items.length} partidas</p>
              </CardContent>
            </Card>
            <Card className={data.overdueCents > 0 ? "border-destructive/40" : undefined}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Ya vencido</p>
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    data.overdueCents > 0 ? "text-destructive" : ""
                  }`}
                >
                  {formatCents(data.overdueCents)}
                </p>
                <p className="text-xs text-muted-foreground">{data.overdueCount} partidas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Vence esta semana</p>
                <p className="text-2xl font-bold tabular-nums">
                  {formatCents(data.dueThisWeekCents)}
                </p>
                <p className="text-xs text-muted-foreground">Próximos 7 días, sin lo vencido</p>
              </CardContent>
            </Card>
          </div>

          {/* Se dice explícitamente que esta pantalla no registra pagos. Sin
              esto, una vista de deuda sin acción se lee como una función a
              medias en vez de como una decisión de control. */}
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-px" />
            <span>
              <span className="font-semibold">Esta vista es de consulta.</span> El registro de pagos
              llega con el flujo de tesorería completo: regla de umbral, doble firma cuando aplica,
              lote con la CLABE del proveedor verificada, y conciliación contra el movimiento
              bancario. Mientras tanto los pagos se siguen registrando donde se hagan hoy.
            </span>
          </div>

          {data.missingDueDateCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <Clock className="w-4 h-4 text-warning-text shrink-0 mt-px" />
              <span>
                <span className="font-semibold">{data.missingDueDateCount}</span> factura
                {data.missingDueDateCount === 1 ? "" : "s"} sin fecha de vencimiento utilizable. No
                entran en la proyección de tesorería hasta que se capture. Suele deberse a que el
                proveedor no tiene días de crédito configurados.
              </span>
            </div>
          )}

          {/* Antigüedad */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Antigüedad</CardTitle>
              <CardDescription className="text-xs">
                Cómo se reparte la deuda en el tiempo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.buckets.map((bucket) => {
                  const pct =
                    data.totalCents > 0 ? (bucket.cents / data.totalCents) * 100 : 0;
                  return (
                    <div key={bucket.bucket} className="space-y-1">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-medium">{AGING_BUCKET_LABELS[bucket.bucket]}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatCents(bucket.cents)} · {bucket.count}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${
                            bucket.bucket === "OVERDUE"
                              ? "bg-destructive"
                              : bucket.bucket === "DUE_7"
                                ? "bg-warning"
                                : "bg-primary"
                          }`}
                          style={{ width: `${Math.max(pct, 1)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* A quién le debes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Por proveedor</CardTitle>
              <CardDescription className="text-xs">
                Ordenado por lo vencido primero. Los gastos operativos se agrupan por categoría.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableCaption className="sr-only">
                    Deuda agrupada por proveedor o categoría: total, monto vencido y número de
                    partidas.
                  </TableCaption>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Proveedor / Categoría</TableHead>
                      <TableHead className="text-center">Partidas</TableHead>
                      <TableHead className="text-right">Vencido</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byCounterparty.slice(0, 10).map((row) => (
                      <TableRow key={row.supplierId ?? row.name} className="hover:bg-muted/40">
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-center text-sm">{row.count}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            row.overdueCents > 0 ? "text-destructive font-semibold" : "text-muted-foreground"
                          }`}
                        >
                          {row.overdueCents > 0 ? formatCents(row.overdueCents) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatCents(row.totalCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {data.byCounterparty.length > 10 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Mostrando los 10 con mayor exposición de {data.byCounterparty.length}.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Detalle */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Detalle de partidas</CardTitle>
              <CardDescription className="text-xs">
                Lo vencido primero.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableCaption className="sr-only">
                    Partidas por pagar: referencia, proveedor, sucursal, origen, vencimiento, monto y
                    acción de pago.
                  </TableCaption>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Referencia</TableHead>
                      <TableHead>Proveedor / Categoría</TableHead>
                      <TableHead>Sucursal</TableHead>
                      <TableHead>Origen</TableHead>
                      <TableHead>Vence</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={`${item.source}-${item.id}`} className="hover:bg-muted/40">
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-1.5">
                            {item.source === "INVOICE" ? (
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                              <Receipt className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                            {item.reference}
                          </span>
                          {item.hasDiscrepancy && (
                            <span className="text-xs text-warning-text block mt-0.5">
                              Discrepancia en conciliación
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{item.counterparty}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.branchName ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {SOURCE_LABEL[item.source]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm">{item.dueDate ?? "Sin fecha"}</span>
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded-full border w-fit ${statusBadgeClasses(
                                BUCKET_TONE[item.bucket],
                              )}`}
                            >
                              {item.daysUntilDue === null
                                ? "Sin vencimiento"
                                : item.daysUntilDue < 0
                                  ? `${Math.abs(item.daysUntilDue)} días vencida`
                                  : item.daysUntilDue === 0
                                    ? "Vence hoy"
                                    : `en ${item.daysUntilDue} días`}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatCents(item.amountCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/finance">
            Volver a Finanzas <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </Button>
      </div>

    </div>
  );
}
