"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Image as ImageIcon, ArrowUpRight, ArrowDownLeft, ShieldCheck, UserCheck, FileText } from "lucide-react";

export interface PettyCashTransactionItem {
  id: string;
  fundId: string;
  branchId: string;
  branchName: string;
  type: "OUT" | "REPLENISHMENT" | "ADJUSTMENT";
  amountCents: number;
  concept: string;
  category: string | null;
  evidenceUrl: string | null;
  workflowInstanceId: string | null;
  registeredByName: string | null;
  approvedByName: string | null;
  authorizationNotes: string | null;
  createdAt: string;
}

interface PettyCashHistoryTableProps {
  transactions: PettyCashTransactionItem[];
}

export function PettyCashHistoryTable({ transactions }: PettyCashHistoryTableProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  const getTypeBadge = (type: PettyCashTransactionItem["type"]) => {
    switch (type) {
      case "OUT":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
            <ArrowUpRight className="w-3 h-3 text-amber-600" /> Retiro
          </Badge>
        );
      case "REPLENISHMENT":
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
            <ArrowDownLeft className="w-3 h-3 text-emerald-600" /> Reposición
          </Badge>
        );
      case "ADJUSTMENT":
        return (
          <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
            Ajuste
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Fecha / Hora</TableHead>
              <TableHead>Sucursal</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Monto ($)</TableHead>
              <TableHead>Concepto / Categoría</TableHead>
              <TableHead>Solicitante</TableHead>
              <TableHead>Autorizado por</TableHead>
              <TableHead className="text-center">Comprobante</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-xs">
                  Sin movimientos de caja chica registrados.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => (
                <TableRow key={tx.id} className="hover:bg-muted/40 transition">
                  <TableCell className="font-medium whitespace-nowrap text-xs">
                    {new Date(tx.createdAt).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="font-medium text-xs">{tx.branchName}</TableCell>
                  <TableCell>{getTypeBadge(tx.type)}</TableCell>
                  <TableCell
                    className={`text-right font-bold text-xs ${
                      tx.type === "OUT" ? "text-amber-700" : "text-emerald-700"
                    }`}
                  >
                    {tx.type === "OUT" ? `- ${formatMXN(tx.amountCents)}` : `+ ${formatMXN(tx.amountCents)}`}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">{tx.concept}</span>
                      {tx.category && (
                        <span className="text-[10px] text-muted-foreground uppercase">{tx.category}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium text-muted-foreground">{tx.registeredByName || "Cajero"}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-col">
                      <span className="font-medium flex items-center gap-1 text-emerald-700">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        {tx.approvedByName || tx.registeredByName || "Gerente"}
                      </span>
                      {tx.authorizationNotes && (
                        <span className="text-[10px] text-muted-foreground/80 leading-tight">
                          "{tx.authorizationNotes}"
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {tx.evidenceUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-primary"
                        onClick={() => setSelectedPhoto(tx.evidenceUrl)}
                      >
                        <ImageIcon className="w-3.5 h-3.5 mr-1" /> Ticket
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Ticket Evidence Image Viewer Modal */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Evidencia del Ticket / Comprobante
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 flex justify-center bg-muted/20 rounded-lg">
            {selectedPhoto && (
              <img
                src={selectedPhoto}
                alt="Ticket Evidence"
                className="max-h-96 object-contain rounded border shadow-sm"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
