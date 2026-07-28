"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, PageContainer } from "@/components/shared";
import { usePurchaseOrder, useUpdatePurchaseOrder } from "@/hooks/queries";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" }> = {
  DRAFT: { label: "Borrador", variant: "secondary" },
  PENDING_APPROVAL: { label: "Por Aprobar", variant: "warning" },
  APPROVED: { label: "Aprobada", variant: "default" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
  SENT: { label: "Enviada", variant: "default" },
  PARTIALLY_RECEIVED: { label: "Recibida Parcial", variant: "warning" },
  CLOSED: { label: "Cerrada", variant: "outline" },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
};

function formatCurrency(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
}

const ACTIONS_BY_STATUS: Record<string, Array<{ action: string; label: string; variant: "default" | "destructive" | "outline"; requiresReason?: boolean }>> = {
  DRAFT: [
    { action: "submit", label: "Enviar a Aprobación", variant: "default" },
    { action: "cancel", label: "Cancelar", variant: "destructive", requiresReason: true },
  ],
  PENDING_APPROVAL: [
    { action: "approve", label: "Aprobar", variant: "default" },
    { action: "reject", label: "Rechazar", variant: "destructive", requiresReason: true },
  ],
  APPROVED: [
    { action: "send", label: "Marcar como Enviada", variant: "default" },
  ],
  SENT: [
    { action: "close", label: "Cerrar", variant: "default" },
    { action: "cancel", label: "Cancelar", variant: "destructive", requiresReason: true },
  ],
  PARTIALLY_RECEIVED: [
    { action: "close", label: "Cerrar", variant: "default" },
  ],
};

export default function PODetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; label: string; reason?: string } | null>(null);
  const [reasonInput, setReasonInput] = useState("");

  const { data: po, isLoading } = usePurchaseOrder(id);
  const updatePO = useUpdatePurchaseOrder();

  if (isLoading) {
    return (
      <div className="flex justify-center p-12"><Loader2 className="animate-spin h-8 w-8" /></div>
    );
  }

  if (!po) {
    return (
      <PageContainer>
        <Card><CardContent className="py-12 text-center text-muted-foreground">Orden de compra no encontrada</CardContent></Card>
      </PageContainer>
    );
  }

  const statusConfig = STATUS_CONFIG[po.status as string] || { label: po.status as string, variant: "outline" as const };
  const availableActions = ACTIONS_BY_STATUS[po.status as string] || [];

  const handleAction = (action: string, label: string, requiresReason?: boolean) => {
    if (requiresReason) {
      setConfirmDialog({ action, label });
      setReasonInput("");
    } else {
      executeAction(action, label);
    }
  };

  const executeAction = (action: string, label: string, reason?: string) => {
    const body: Record<string, unknown> = { action };
    if (action === 'reject' && reason) body.rejectionReason = reason;
    if (action === 'cancel' && reason) body.cancellationReason = reason;

    updatePO.mutate({ id, ...body }, {
      onSuccess: () => {
        toast.success(`Orden ${label.toLowerCase()}`);
        setConfirmDialog(null);
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Error al actualizar");
      },
    });
  };

  const handleShareWhatsApp = () => {
    const poLink = window.location.href;
    const text = `Hola, te comparto la Orden de Compra *${po.poNumber}* de *${po.branchName || 'Pulso Horeca'}*.\n\n*Detalles:*\n• Proveedor: ${po.supplierName || '—'}\n• Total: ${formatCurrency(po.totalAmount)}\n• Fecha Requerida: ${formatDate(po.dateRequired)}\n\nLink de visualización: ${poLink}`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, "_blank");
  };

  const items = po.items || [];

  return (
    <PageContainer>
      <style>{`
        @media print {
          aside, nav, header, footer, button, .print\\:hidden {
            display: none !important;
          }
          main, .print\\:full-width {
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
        }
      `}</style>
      <PageHeader
        title={po.poNumber}
        description={`Orden de compra • ${formatDate(po.createdAt)}`}
        icon={FileText}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
              <FileText className="h-4 w-4" /> Imprimir / PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleShareWhatsApp} className="gap-2 text-emerald-700 border-emerald-200 bg-emerald-50/30 hover:bg-emerald-50">
              <svg className="h-4 w-4 fill-emerald-600" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.713-1.458L0 24zM6.59 19.842c1.617.959 3.01 1.458 4.887 1.458 5.48 0 9.943-4.444 9.947-9.913.002-2.65-1.02-5.14-2.88-7.006C16.68 2.516 14.19 1.49 11.54 1.49 6.06 1.49 1.597 5.936 1.594 11.405c-.001 1.83.483 3.197 1.42 4.793L2.012 21.8l5.885-1.543a9.88 9.88 0 0 0-1.307-.415z"/>
              </svg>
              Compartir WhatsApp
            </Button>
            <Link href="/dashboard/inventory/purchase-orders">
              <Button variant="ghost" size="icon"><ChevronLeft className="h-5 w-5" /></Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Productos</CardTitle>
              <Badge variant={statusConfig.variant} className="gap-1.5 text-sm px-3 py-1">
                {statusConfig.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">Costo Unit.</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">IEPS</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: Record<string, unknown>) => (
                  <TableRow key={item.id as string}>
                    <TableCell>
                      <div className="font-medium">{item.itemName as string || item.itemId as string}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.orderedQuantity as number}</TableCell>
                    <TableCell className="text-right tabular-nums">{(item.receivedQuantity as number) || 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(item.unitCost as number)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground text-xs">{item.taxRate !== undefined && item.taxRate !== null ? `${item.taxRate}%` : "16%"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground text-xs">{item.iepsRate !== undefined && item.iepsRate !== null ? `${item.iepsRate}%` : "0%"}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatCurrency(item.lineTotal as number)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Separator className="my-4" />

            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(po.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">IVA Detallado</span>
                <span className="tabular-nums">{formatCurrency(po.taxAmount)}</span>
              </div>
              {(po.iepsAmount !== undefined && po.iepsAmount !== null && (po.iepsAmount as number) > 0) && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IEPS Detallado</span>
                  <span className="tabular-nums">{formatCurrency(po.iepsAmount as number)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-base pt-1.5 border-t">
                <span>Total</span>
                <span className="tabular-nums text-emerald-700">{formatCurrency(po.totalAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Detalles</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div>
                <span className="text-muted-foreground">Proveedor</span>
                <p className="font-medium">{po.supplierName || po.supplierId || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Sucursal</span>
                <p className="font-medium">{po.branchName || po.branchId || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Solicitada por</span>
                <p className="font-medium">{po.requestedBy || "—"}</p>
              </div>
              {po.dateRequired && (
                <div>
                  <span className="text-muted-foreground">Fecha Requerida</span>
                  <p className="font-medium">{formatDate(po.dateRequired)}</p>
                </div>
              )}
              {po.expectedDeliveryDate && (
                <div>
                  <span className="text-muted-foreground">Entrega Esperada</span>
                  <p className="font-medium">{formatDate(po.expectedDeliveryDate)}</p>
                </div>
              )}
              {po.sentAt && (
                <div>
                  <span className="text-muted-foreground">Enviada</span>
                  <p className="font-medium">{formatDate(po.sentAt)}</p>
                </div>
              )}
              {po.notes && (
                <div>
                  <span className="text-muted-foreground">Notas</span>
                  <p className="text-sm">{po.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {(availableActions.length > 0 || ['SENT', 'PARTIALLY_RECEIVED'].includes(po.status as string)) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Acciones</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {['SENT', 'PARTIALLY_RECEIVED'].includes(po.status as string) && (
                  <Link href={`/dashboard/inventory/receiving?poId=${po.id}`} className="w-full mb-1">
                    <Button variant="default" size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
                      Registrar Recepción
                    </Button>
                  </Link>
                )}
                {availableActions.map((action) => (
                  <Button
                    key={action.action}
                    variant={action.variant}
                    size="sm"
                    className="w-full"
                    onClick={() => handleAction(action.action, action.label, action.requiresReason)}
                    disabled={updatePO.isPending}
                  >
                    {action.label}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={!!confirmDialog} onOpenChange={(v) => !v && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmDialog?.label}</DialogTitle>
            <DialogDescription>
              {confirmDialog?.action === 'cancel' ? 'Se cancelará la orden de compra.' : 'Se requiere un motivo para esta acción.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="Describe el motivo..."
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button
              variant={confirmDialog?.action === 'approve' ? 'default' : 'destructive'}
              onClick={() => confirmDialog && executeAction(confirmDialog.action, confirmDialog.label, reasonInput)}
              disabled={updatePO.isPending || !reasonInput.trim()}
            >
              {updatePO.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
