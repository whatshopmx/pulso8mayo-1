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
import { Loader2, Plus, FileCheck } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatCents } from "@/lib/utils";

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
  const [addingId, setAddingId] = useState<string | null>(null);

  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/finance/treasury/invoices/unpaid");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar las facturas");
      setInvoices(json.data || []);
    } catch (error: any) {
      toast.error("Error", {
        description: error.message || "No se pudieron cargar las facturas pendientes.",
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

  const addInvoice = async (invoice: any) => {
    setAddingId(invoice.id);
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "INVOICE",
          referenceId: invoice.id,
          amountCents: invoice.total,
          notes: `Folio: ${invoice.folio || 'S/F'} - ${invoice.nombreEmisor || invoice.rfcEmisor || 'Proveedor'}`
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al agregar factura a la corrida.");

      toast.success("Factura agregada", {
        description: `Folio ${invoice.folio || invoice.uuid?.slice(0, 8)} adjuntado exitosamente.`,
      });
      
      // Remove the invoice from the local list
      setInvoices(prev => prev.filter(inv => inv.id !== invoice.id));
      onInvoiceAdded();
    } catch (error: any) {
      toast.error("Error al agregar", {
        description: error.message,
      });
    } finally {
      setAddingId(null);
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
          <DialogTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-primary" /> Facturas Pendientes (3-Way Matched)
          </DialogTitle>
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
            <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
              <p className="text-sm font-medium text-foreground">No hay facturas pendientes conciliadas</p>
              <p className="text-xs text-muted-foreground mt-1">
                Todas las facturas recibidas ya están liquidadas o asignadas a otras corridas.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Folio</TableHead>
                  <TableHead>Emisor / Proveedor</TableHead>
                  <TableHead>Conciliación</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {inv.fecha ? new Date(inv.fecha).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{inv.folio || "S/F"}</TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium text-foreground">{inv.nombreEmisor || inv.rfcEmisor}</div>
                      {inv.nombreEmisor && <div className="text-xs text-muted-foreground font-mono">{inv.rfcEmisor}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-xs font-normal">
                        {inv.matchStatus === "MATCHED" ? "Conciliada" : inv.matchStatus === "EXCEPTION_APPROVED" ? "Excepción Aprobada" : inv.matchStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm whitespace-nowrap">
                      ${formatCents(inv.total)}{" "}
                      <span className="text-xs text-muted-foreground">{inv.currency || "MXN"}</span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={addingId === inv.id}
                        onClick={() => addInvoice(inv)}
                      >
                        {addingId === inv.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        Adjuntar
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
