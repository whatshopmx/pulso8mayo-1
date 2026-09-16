"use client";

import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Loader2,
  Send,
  CheckCircle,
  CheckCircle2,
  FileText,
  Ban,
  Play,
  AlertTriangle,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddPaymentRunItemModal } from "./add-invoice-modal";
import {
  SettlePaymentRunItemDialog,
  type SettleableRunItem,
} from "./settle-payment-run-item-dialog";

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
    className?: string;
  }
> = {
  DRAFT: {
    label: "Borrador",
    variant: "outline",
    className: "bg-muted text-muted-foreground border-border font-medium",
  },
  PENDING_APPROVAL: {
    label: "Pendiente Aprobación",
    variant: "outline",
    className:
      "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25 font-medium",
  },
  APPROVED: {
    label: "Aprobada",
    variant: "default",
    className:
      "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/25 font-medium",
  },
  PROCESSING: {
    label: "En Dispersión",
    variant: "outline",
    className:
      "bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/25 font-medium",
  },
  COMPLETED: {
    label: "Liquidada / Cerrada",
    variant: "secondary",
    className:
      "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 border-emerald-600/25 font-medium",
  },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
};

export function PaymentRunDetail({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();

  // Estado para modal de liquidación individual
  const [settleItem, setSettleItem] = useState<SettleableRunItem | null>(null);
  const [settleMode, setSettleMode] = useState<"CONFIRM" | "REJECT" | null>(null);
  const [settleDialogOpen, setSettleDialogOpen] = useState(false);

  useEffect(() => {
    fetchData();
  }, [runId]);

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}`);
      if (!res.ok) throw new Error("Error al obtener la corrida");
      const json = await res.json();
      setData(json.data);
    } catch (error: any) {
      toast.error("Error", {
        description:
          error.message || "No se pudo cargar la información de la corrida.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(
          json.error || json.message || "No autorizado para cambiar el estado."
        );
      }

      toast.success("Estado actualizado", {
        description: `La corrida ahora está en: ${
          STATUS_CONFIG[newStatus]?.label || newStatus
        }`,
      });
      fetchData();
    } catch (error: any) {
      toast.error("Error al actualizar corrida", {
        description: error.message,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const openSettleDialog = (
    item: SettleableRunItem,
    mode: "CONFIRM" | "REJECT"
  ) => {
    setSettleItem(item);
    setSettleMode(mode);
    setSettleDialogOpen(true);
  };

  const items = data?.items || [];
  const run = data?.run;

  const summary = useMemo(() => {
    if (!items || items.length === 0) {
      return {
        total: 0,
        confirmed: 0,
        failed: 0,
        pending: 0,
        confirmedCents: 0,
        failedCents: 0,
        pendingCents: 0,
      };
    }
    let confirmed = 0;
    let failed = 0;
    let pending = 0;
    let confirmedCents = 0;
    let failedCents = 0;
    let pendingCents = 0;

    for (const it of items) {
      const st = it.settlementStatus ?? "PENDING";
      const amt = it.amountCents || 0;
      if (st === "CONFIRMED") {
        confirmed++;
        confirmedCents += amt;
      } else if (st === "FAILED") {
        failed++;
        failedCents += amt;
      } else {
        pending++;
        pendingCents += amt;
      }
    }

    return {
      total: items.length,
      confirmed,
      failed,
      pending,
      confirmedCents,
      failedCents,
      pendingCents,
    };
  }, [items]);

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  if (!data || !run) {
    return (
      <div className="text-center py-12 bg-muted/30 rounded-lg border border-border">
        <p className="text-muted-foreground">No se encontró la corrida de pago.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => router.push("/dashboard/finance/treasury")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Tesorería
        </Button>
      </div>
    );
  }

  const statusInfo = STATUS_CONFIG[run.status] || {
    label: run.status,
    variant: "secondary" as const,
    className: undefined,
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: run.currency || "MXN",
    }).format(cents / 100);
  };

  const isSettlementEligible =
    run.status === "APPROVED" || run.status === "PROCESSING";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/dashboard/finance/treasury")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Tesorería
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CardTitle className="text-2xl font-bold tracking-tight">
                {run.title}
              </CardTitle>
              {run.branchName && (
                <Badge variant="secondary" className="text-xs">
                  {run.branchName}
                </Badge>
              )}
            </div>
            <CardDescription>
              Programado para: {format(new Date(run.runDate), "PPP", { locale: es })}
            </CardDescription>
          </div>
          <div>
            <Badge variant={statusInfo.variant} className={statusInfo.className}>
              {statusInfo.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-col md:flex-row gap-4 items-center justify-between bg-muted/60 p-4 rounded-lg border border-border/50">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Monto Total Programado
              </p>
              <p className="text-3xl font-bold tracking-tight mt-0.5">
                {formatCurrency(run.totalAmountCents)}
              </p>
            </div>

            {/* Action Buttons based on status */}
            <div className="flex flex-wrap gap-2 items-center">
              {run.status === "DRAFT" && (
                <Button
                  size="sm"
                  onClick={() => updateStatus("PENDING_APPROVAL")}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Solicitar Aprobación
                </Button>
              )}
              {run.status === "PENDING_APPROVAL" && (
                <Button
                  size="sm"
                  onClick={() => updateStatus("APPROVED")}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  )}
                  Aprobar Corrida (Firma)
                </Button>
              )}
              {run.status === "APPROVED" && (
                <Button
                  size="sm"
                  onClick={() => updateStatus("PROCESSING")}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Iniciar Dispersión
                </Button>
              )}
              {run.status === "PROCESSING" && (
                <Button
                  size="sm"
                  onClick={() => updateStatus("COMPLETED")}
                  disabled={isUpdating || summary.pending > 0}
                  className={
                    summary.pending === 0
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : ""
                  }
                  title={
                    summary.pending > 0
                      ? `Faltan ${summary.pending} partidas por liquidar`
                      : "Cerrar la corrida"
                  }
                >
                  {isUpdating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  )}
                  {summary.pending === 0
                    ? "Cerrar y Liquidar Corrida"
                    : `Cerrar Corrida (${summary.pending} pendientes)`}
                </Button>
              )}

              {run.status !== "COMPLETED" && run.status !== "CANCELLED" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 border-destructive/30"
                      disabled={isUpdating}
                    >
                      <Ban className="mr-2 h-4 w-4" />
                      Cancelar Corrida
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        ¿Confirmas cancelar esta corrida de pago?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción marcará la corrida como cancelada y liberará
                        las facturas o ítems adjuntos para que puedan incluirse en
                        una nueva corrida.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Volver</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => updateStatus("CANCELLED")}
                      >
                        Sí, cancelar corrida
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {/* Desglose de liquidación por partida (cuando esté autorizada, en dispersión o completada) */}
          {(run.status === "APPROVED" ||
            run.status === "PROCESSING" ||
            run.status === "COMPLETED") &&
            summary.total > 0 && (
              <div className="mb-6 p-4 rounded-lg bg-card border border-border space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Seguimiento de Liquidación por Partida</span>
                  <span>
                    {summary.confirmed + summary.failed} de {summary.total} resueltas
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs">
                    <span className="text-emerald-800 dark:text-emerald-300 font-medium block">
                      Confirmadas ({summary.confirmed})
                    </span>
                    <span className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                      {formatCurrency(summary.confirmedCents)}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs">
                    <span className="text-amber-800 dark:text-amber-300 font-medium block">
                      Pendientes de dispersión ({summary.pending})
                    </span>
                    <span className="text-sm font-bold text-amber-900 dark:text-amber-200">
                      {formatCurrency(summary.pendingCents)}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs">
                    <span className="text-destructive font-medium block">
                      Rechazadas por banco ({summary.failed})
                    </span>
                    <span className="text-sm font-bold text-destructive">
                      {formatCurrency(summary.failedCents)}
                    </span>
                    {summary.failed > 0 && (
                      <span className="text-[10px] text-muted-foreground block mt-0.5">
                        Deuda viva para reprogramar
                      </span>
                    )}
                  </div>
                </div>

                {run.status === "PROCESSING" && summary.pending > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 pt-1">
                    Nota: Para cerrar la corrida es necesario asentar el comprobante
                    de pago o el rechazo bancario de cada partida individual.
                  </p>
                )}
              </div>
            )}

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">
                Ítems de la Corrida ({items.length})
              </h3>
              {run.status === "DRAFT" && (
                <AddPaymentRunItemModal
                  runId={runId}
                  branchId={run.branchId}
                  onInvoiceAdded={fetchData}
                />
              )}
            </div>

            {items.length === 0 ? (
              <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed border-border">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">
                  No hay ítems agregados a esta corrida
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Agrega facturas conciliadas (3-way match), gastos operativos
                  autorizados o corridas de nómina para autorizar su pago.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto w-full -mx-2 px-2 sm:mx-0 sm:px-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Tipo</TableHead>
                      <TableHead>Concepto / Referencia</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-center">Liquidación</TableHead>
                      {isSettlementEligible && (
                        <TableHead className="text-right">Acciones</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item: any) => {
                      const settlementStatus = item.settlementStatus ?? "PENDING";
                      return (
                        <TableRow
                          key={item.id}
                          className="hover:bg-muted/50 transition-colors"
                        >
                          <TableCell className="font-medium text-xs whitespace-nowrap">
                            {item.itemType === "INVOICE" ? (
                              <Badge
                                variant="outline"
                                className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-normal"
                              >
                                Factura
                              </Badge>
                            ) : item.itemType === "PAYROLL" ? (
                              <Badge
                                variant="outline"
                                className="bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/20 font-normal"
                              >
                                Nómina
                              </Badge>
                            ) : item.itemType === "OPERATING_EXPENSE" ? (
                              <Badge
                                variant="outline"
                                className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20 font-normal"
                              >
                                Gasto Operativo
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="font-normal">
                                {item.itemType}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-foreground">
                            {item.invoiceDetails?.folio
                              ? `FAC-${item.invoiceDetails.folio}`
                              : item.expenseDetails?.description
                                ? item.expenseDetails.description
                                : item.referenceId.slice(0, 8)}
                            {item.invoiceDetails?.nombreEmisor && (
                              <span className="block text-[11px] font-sans text-muted-foreground truncate max-w-[200px]">
                                {item.invoiceDetails.nombreEmisor}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                            {item.notes || "-"}
                          </TableCell>
                          <TableCell className="text-right font-medium text-sm whitespace-nowrap">
                            {formatCurrency(item.amountCents)}
                          </TableCell>
                          <TableCell className="text-center whitespace-nowrap">
                            {settlementStatus === "CONFIRMED" ? (
                              <div className="inline-flex flex-col items-center">
                                <Badge
                                  variant="outline"
                                  className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 text-[11px] gap-1 font-medium"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Confirmado
                                </Badge>
                                {item.settlementReference && (
                                  <span className="text-[10px] font-mono text-muted-foreground mt-0.5">
                                    Ref: {item.settlementReference}
                                  </span>
                                )}
                              </div>
                            ) : settlementStatus === "FAILED" ? (
                              <div className="inline-flex flex-col items-center">
                                <Badge
                                  variant="destructive"
                                  className="text-[11px] gap-1 font-medium"
                                >
                                  <XCircle className="h-3 w-3" />
                                  Rechazado
                                </Badge>
                                {item.failureReason && (
                                  <span className="text-[10px] text-destructive mt-0.5 max-w-[140px] truncate" title={item.failureReason}>
                                    {item.failureReason}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25 text-[11px] font-normal"
                              >
                                Pendiente
                              </Badge>
                            )}
                          </TableCell>
                          {isSettlementEligible && (
                            <TableCell className="text-right whitespace-nowrap">
                              <div className="inline-flex gap-1.5 justify-end">
                                {settlementStatus === "PENDING" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs border-emerald-600/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                                      onClick={() => openSettleDialog(item, "CONFIRM")}
                                    >
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Confirmar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                      onClick={() => openSettleDialog(item, "REJECT")}
                                    >
                                      <XCircle className="h-3 w-3 mr-1" />
                                      Rechazar
                                    </Button>
                                  </>
                                )}
                                {settlementStatus === "FAILED" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-amber-600/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                                    onClick={() => openSettleDialog(item, "CONFIRM")}
                                    title="Corregir a pago confirmado con comprobante"
                                  >
                                    <RotateCcw className="h-3 w-3 mr-1" />
                                    Corregir
                                  </Button>
                                )}
                                {settlementStatus === "CONFIRMED" && (
                                  <span className="text-[11px] text-muted-foreground italic flex items-center gap-1 justify-end">
                                    <CheckCircle className="h-3 w-3 text-emerald-600" />
                                    Saldado
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Modal de Liquidación Individual */}
      <SettlePaymentRunItemDialog
        runId={runId}
        item={settleItem}
        mode={settleMode}
        open={settleDialogOpen}
        onOpenChange={setSettleDialogOpen}
        onSettled={fetchData}
      />
    </div>
  );
}
