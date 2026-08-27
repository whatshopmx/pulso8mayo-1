"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function AddInvoiceModal({ 
  runId, 
  onInvoiceAdded 
}: { 
  runId: string;
  onInvoiceAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const { toast } = useToast();

  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/finance/treasury/invoices/unpaid");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar las facturas");
      setInvoices(json.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      fetchInvoices();
    }
  };

  const formatCurrency = (cents: number, currency: string = "MXN") => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency,
    }).format(cents / 100);
  };

  const addInvoice = async (invoice: any) => {
    setIsAdding(true);
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "INVOICE",
          referenceId: invoice.id,
          amountCents: invoice.total,
          notes: `Folio: ${invoice.folio || 'S/F'}`
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al agregar factura");

      toast({
        title: "Factura agregada",
        description: "La factura se ha agregado a la corrida de pago exitosamente.",
      });
      
      // Remove the invoice from the local list
      setInvoices(prev => prev.filter(inv => inv.id !== invoice.id));
      onInvoiceAdded();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> Agregar Factura
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Facturas Pendientes (3-Way Matched)</DialogTitle>
          <DialogDescription>
            Selecciona facturas que ya han sido conciliadas exitosamente contra su orden de compra y reporte de recepción.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay facturas pendientes conciliadas.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Folio</TableHead>
                  <TableHead>Emisor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.fecha}</TableCell>
                    <TableCell>{inv.folio}</TableCell>
                    <TableCell>{inv.nombreEmisor || inv.rfcEmisor}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        {inv.matchStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(inv.total, inv.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        disabled={isAdding}
                        onClick={() => addInvoice(inv)}
                      >
                        Añadir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
