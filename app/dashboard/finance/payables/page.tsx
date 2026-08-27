"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useBranch } from "@/lib/branch-context";
import { useFocusedRow } from "@/hooks/use-focused-row";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import {
  AGING_BUCKET_LABELS,
  type AccountsPayableResult,
  type AgingBucket,
  type PayableItem,
} from "@/lib/services/accounts-payable-types";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Loader2,
  Receipt,
  RefreshCw,
  ShieldAlert,
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
  // `useFocusedRow` usa `useSearchParams`, que exige límite de Suspense.
  return (
    <Suspense>
      <PayablesContent />
    </Suspense>
  );
}

function PayablesContent() {
  const { selectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";
  // `?focus=<id>` llega desde el panel de flujo de efectivo.
  const { focusProps } = useFocusedRow();

  const [data, setData] = useState<AccountsPayableResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros interactivos y autorización de excepción 3-way match (Módulo 5.2)
  const [filterMode, setFilterMode] = useState<"ALL" | "DISCREPANCIES" | "OVERDUE">("ALL");
  const [selectedInvoiceForException, setSelectedInvoiceForException] = useState<PayableItem | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const handleApproveException = async () => {
    if (!selectedInvoiceForException || !exceptionReason.trim()) return;
    setIsApproving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/inventory/invoices/${selectedInvoiceForException.id}/approve-exception`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: exceptionReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo autorizar la excepción.");
      }
      setSelectedInvoiceForException(null);
      setExceptionReason("");
      await load(true);
    } catch (err: any) {
      console.error("Error approving match exception:", err);
      setActionError(err.message || "Error al procesar la autorización.");
    } finally {
      setIsApproving(false);
    }
  };

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
                {/* A19 — `itemsTotal`, no `items.length`: desde que el detalle
                    se acota, `items` describe la página y no la deuda. Los tres
                    números de aquí arriba se calculan sobre todas las partidas,
                    antes del corte. */}
                <p className="text-xs text-muted-foreground">{data.itemsTotal} partidas</p>
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
              <CardTitle className="text-base font-bold">Por contraparte</CardTitle>
              <CardDescription className="text-xs">
                Ordenado por lo vencido primero. Los gastos operativos se agrupan por contraparte
                (&quot;Inmobiliaria X&quot;); los gastos casuales sin contraparte, por categoría.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableCaption className="sr-only">
                    Deuda agrupada por contraparte (proveedor de mercancía, arrendador o servicio,
                    o categoría del gasto casual): total, monto vencido y número de partidas.
                  </TableCaption>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Contraparte</TableHead>
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
            <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-bold">Detalle de partidas</CardTitle>
                <CardDescription className="text-xs">
                  {filterMode === "DISCREPANCIES"
                    ? "Facturas bloqueadas para pago por discrepancia 3-Way (precio o cantidad). Requieren autorización de excepción."
                    : filterMode === "OVERDUE"
                      ? "Partidas cuyo plazo de crédito ya expiró."
                      : "Lo vencido primero."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={filterMode === "ALL" ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => setFilterMode("ALL")}
                >
                  Todas ({data.items.length})
                </Button>
                <Button
                  variant={filterMode === "DISCREPANCIES" ? "default" : "outline"}
                  size="sm"
                  className={`text-xs h-8 ${data.items.some(i => i.hasDiscrepancy || i.matchStatus === "DISCREPANCY") ? "border-warning/50 text-warning-text" : ""}`}
                  onClick={() => setFilterMode("DISCREPANCIES")}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Discrepancias ({data.items.filter(i => i.hasDiscrepancy || i.matchStatus === "DISCREPANCY").length})
                </Button>
                <Button
                  variant={filterMode === "OVERDUE" ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => setFilterMode("OVERDUE")}
                >
                  Vencidas ({data.overdueCount})
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableCaption className="sr-only">
                    Partidas por pagar: referencia, contraparte, sucursal, origen, fecha de vencimiento, monto y estado de conciliación.
                  </TableCaption>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Referencia</TableHead>
                      <TableHead>Contraparte</TableHead>
                      <TableHead>Sucursal</TableHead>
                      <TableHead>Origen</TableHead>
                      <TableHead>Vence</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right">3-Way Match / Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items
                      .filter((item) => {
                        if (filterMode === "DISCREPANCIES") return item.hasDiscrepancy || item.matchStatus === "DISCREPANCY";
                        if (filterMode === "OVERDUE") return item.bucket === "OVERDUE";
                        return true;
                      })
                      .map((item) => (
                        <TableRow
                          key={`${item.source}-${item.id}`}
                          {...focusProps(item.id, "hover:bg-muted/40")}
                        >
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
                              <span className="text-xs text-warning-text block mt-0.5 font-medium">
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
                          <TableCell className="text-right">
                            {item.source === "INVOICE" ? (
                              item.matchStatus === "EXCEPTION_APPROVED" ? (
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs">
                                  Excepción Autorizada
                                </Badge>
                              ) : item.hasDiscrepancy || item.matchStatus === "DISCREPANCY" ? (
                                <div className="flex items-center justify-end gap-2">
                                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">
                                    Bloqueada
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-primary/30 hover:bg-primary/10"
                                    onClick={() => {
                                      setSelectedInvoiceForException(item);
                                      setExceptionReason("");
                                      setActionError(null);
                                    }}
                                  >
                                    Autorizar Excepción
                                  </Button>
                                </div>
                              ) : (
                                <Badge variant="outline" className="bg-muted text-muted-foreground text-xs">
                                  {item.matchStatus || "Conciliada"}
                                </Badge>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
              {data.itemsTotal > data.items.length && (
                <p className="text-xs text-muted-foreground mt-2">
                  Mostrando las {data.items.length} partidas más urgentes de {data.itemsTotal}.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Modal de Autorización de Excepción (Módulo 5.2) */}
          <Dialog
            open={!!selectedInvoiceForException}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedInvoiceForException(null);
                setExceptionReason("");
                setActionError(null);
              }
            }}
          >
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-warning-text" />
                  Autorizar Excepción en 3-Way Match
                </DialogTitle>
                <DialogDescription>
                  Esta factura presenta discrepancias de precio o cantidad respecto a la Orden de Compra o Recepción física. Autorizar la excepción desbloqueará la factura para su pago en Tesorería.
                </DialogDescription>
              </DialogHeader>

              {selectedInvoiceForException && (
                <div className="space-y-4 py-2 text-sm">
                  <div className="rounded-md bg-muted/50 p-3 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Factura:</span>
                      <span className="font-semibold">{selectedInvoiceForException.reference}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Proveedor:</span>
                      <span className="font-medium">{selectedInvoiceForException.counterparty}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Monto:</span>
                      <span className="font-semibold">{formatCents(selectedInvoiceForException.amountCents)}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Justificación / Motivo de Auditoría <span className="text-destructive">*</span>
                    </label>
                    <Textarea
                      placeholder="Ej. Se acordó incremento de precio con proveedor por flete urgente autorizado por Dirección General..."
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      rows={3}
                      className="text-sm"
                    />
                  </div>

                  {actionError && (
                    <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{actionError}</span>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSelectedInvoiceForException(null)}
                  disabled={isApproving}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleApproveException}
                  disabled={isApproving || exceptionReason.trim().length < 5}
                  className="bg-primary text-primary-foreground"
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Autorizando...
                    </>
                  ) : (
                    "Autorizar y Desbloquear"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
