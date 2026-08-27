"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Send, CheckCircle, FileText, Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { AddInvoiceModal } from "./add-invoice-modal";

export function PaymentRunDetail({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, [runId]);

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}`);
      if (!res.ok) throw new Error("Error fetching data");
      const json = await res.json();
      setData(json.data);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo cargar la información de la corrida.",
        variant: "destructive",
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
        throw new Error(json.error || "No autorizado");
      }

      toast({
        title: "Estado actualizado",
        description: `La corrida ahora está en estado ${newStatus}`,
      });
      fetchData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  if (!data) {
    return <div>No se encontró la corrida.</div>;
  }

  const { run, items } = data;

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: run.currency,
    }).format(cents / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/finance/treasury")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-2xl">{run.title}</CardTitle>
            <CardDescription>
              Programado para: {format(new Date(run.runDate), "PPP", { locale: es })}
            </CardDescription>
          </div>
          <div>
            <Badge variant={run.status === "APPROVED" || run.status === "COMPLETED" ? "default" : "secondary"}>
              {run.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-col md:flex-row gap-4 items-center justify-between bg-muted p-4 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Monto Total</p>
              <p className="text-3xl font-bold">{formatCurrency(run.totalAmountCents)}</p>
            </div>
            
            {/* Action Buttons based on status */}
            <div className="flex gap-2">
              {run.status === "DRAFT" && (
                <Button onClick={() => updateStatus("PENDING_APPROVAL")} disabled={isUpdating}>
                  {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Solicitar Aprobación
                </Button>
              )}
              {run.status === "PENDING_APPROVAL" && (
                <Button onClick={() => updateStatus("APPROVED")} disabled={isUpdating} className="bg-green-600 hover:bg-green-700">
                  {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  Aprobar Corrida
                </Button>
              )}
              {run.status === "APPROVED" && (
                <Button onClick={() => updateStatus("PROCESSING")} disabled={isUpdating}>
                  Iniciar Pago
                </Button>
              )}
              {run.status === "PROCESSING" && (
                <Button onClick={() => updateStatus("COMPLETED")} disabled={isUpdating} className="bg-green-600 hover:bg-green-700">
                  Marcar como Completado
                </Button>
              )}
              {run.status !== "COMPLETED" && run.status !== "CANCELLED" && (
                <Button variant="destructive" onClick={() => updateStatus("CANCELLED")} disabled={isUpdating}>
                  <Ban className="mr-2 h-4 w-4" />
                  Cancelar
                </Button>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Ítems de la Corrida</h3>
              {run.status === "DRAFT" && (
                <AddInvoiceModal runId={runId} onInvoiceAdded={fetchData} />
              )}
            </div>

            {items.length === 0 ? (
              <div className="text-center py-12 bg-muted/50 rounded-lg border border-dashed">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No hay ítems agregados a esta corrida.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.itemType}</TableCell>
                      <TableCell className="font-mono text-xs">{item.referenceId}</TableCell>
                      <TableCell>{item.notes || "-"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.amountCents)}</TableCell>
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
