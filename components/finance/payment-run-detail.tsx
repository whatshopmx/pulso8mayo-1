"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { ArrowLeft, Loader2, Send, CheckCircle, FileText, Ban, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddInvoiceModal } from "./add-invoice-modal";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }
> = {
  DRAFT: {
    label: "Borrador",
    variant: "outline",
    className: "bg-muted text-muted-foreground border-border font-medium",
  },
  PENDING_APPROVAL: {
    label: "Pendiente Aprobación",
    variant: "outline",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20 font-medium",
  },
  APPROVED: {
    label: "Aprobada",
    variant: "default",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium",
  },
  PROCESSING: {
    label: "En Proceso",
    variant: "outline",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/20 font-medium",
  },
  COMPLETED: {
    label: "Pagada / Completada",
    variant: "secondary",
    className: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/20 font-medium",
  },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
};

export function PaymentRunDetail({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();

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
        description: error.message || "No se pudo cargar la información de la corrida.",
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
        throw new Error(json.error || "No autorizado para cambiar el estado.");
      }

      toast.success("Estado actualizado", {
        description: `La corrida ahora está en: ${STATUS_CONFIG[newStatus]?.label || newStatus}`,
      });
      fetchData();
    } catch (error: any) {
      toast.error("Error al actualizar", {
        description: error.message,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  if (!data) {
    return (
      <div className="text-center py-12 bg-muted/30 rounded-lg border border-border">
        <p className="text-muted-foreground">No se encontró la corrida de pago.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push("/dashboard/finance/treasury")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Tesorería
        </Button>
      </div>
    );
  }

  const { run, items } = data;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/finance/treasury")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Tesorería
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight">{run.title}</CardTitle>
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Monto Total Programado</p>
              <p className="text-3xl font-bold tracking-tight mt-0.5">{formatCurrency(run.totalAmountCents)}</p>
            </div>
            
            {/* Action Buttons based on status */}
            <div className="flex flex-wrap gap-2 items-center">
              {run.status === "DRAFT" && (
                <Button size="sm" onClick={() => updateStatus("PENDING_APPROVAL")} disabled={isUpdating}>
                  {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Solicitar Aprobación
                </Button>
              )}
              {run.status === "PENDING_APPROVAL" && (
                <Button size="sm" onClick={() => updateStatus("APPROVED")} disabled={isUpdating}>
                  {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  Aprobar Corrida (Firma)
                </Button>
              )}
              {run.status === "APPROVED" && (
                <Button size="sm" onClick={() => updateStatus("PROCESSING")} disabled={isUpdating}>
                  {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Iniciar Dispersión
                </Button>
              )}
              {run.status === "PROCESSING" && (
                <Button size="sm" onClick={() => updateStatus("COMPLETED")} disabled={isUpdating}>
                  {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  Marcar como Pagada
                </Button>
              )}

              {run.status !== "COMPLETED" && run.status !== "CANCELLED" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 border-destructive/30" disabled={isUpdating}>
                      <Ban className="mr-2 h-4 w-4" />
                      Cancelar Corrida
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Confirmas cancelar esta corrida de pago?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción marcará la corrida como cancelada y liberará las facturas o ítems adjuntos para que puedan incluirse en una nueva corrida.
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

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Ítems de la Corrida ({items.length})</h3>
              {run.status === "DRAFT" && (
                <AddInvoiceModal runId={runId} onInvoiceAdded={fetchData} />
              )}
            </div>

            {items.length === 0 ? (
              <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed border-border">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No hay ítems agregados a esta corrida</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Agrega facturas conciliadas (3-way match) para autorizar su pago en esta corrida.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tipo</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => (
                    <TableRow key={item.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium text-xs">
                        <Badge variant="outline" className="font-normal">
                          {item.itemType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{item.referenceId}</TableCell>
                      <TableCell className="text-sm">{item.notes || "-"}</TableCell>
                      <TableCell className="text-right font-medium text-sm">{formatCurrency(item.amountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
