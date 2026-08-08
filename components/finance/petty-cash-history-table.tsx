"use client";

import { useState } from "react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { Image as ImageIcon, ArrowUpRight, ArrowDownLeft, ShieldCheck, FileText } from "lucide-react";

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

  const getTypeBadge = (type: PettyCashTransactionItem["type"]) => {
    switch (type) {
      case "OUT":
        return (
          <Badge variant="outline" className={`gap-1 ${statusBadgeClasses("warning")}`}>
            <ArrowUpRight className="w-3 h-3" /> Retiro
          </Badge>
        );
      case "REPLENISHMENT":
        return (
          <Badge variant="outline" className={`gap-1 ${statusBadgeClasses("success")}`}>
            <ArrowDownLeft className="w-3 h-3" /> Reposición
          </Badge>
        );
      case "ADJUSTMENT":
        return (
          <Badge variant="outline" className={statusBadgeClasses("neutral")}>
            Ajuste
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableCaption className="sr-only">
            Bitácora de movimientos de caja chica: fecha, sucursal, tipo, monto, concepto,
            quién lo solicitó, quién lo autorizó y el comprobante adjunto.
          </TableCaption>
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
                    className={`text-right font-bold text-xs tabular-nums ${
                      tx.type === "OUT" ? "text-warning-text" : "text-success"
                    }`}
                  >
                    {tx.type === "OUT"
                      ? `- ${formatCents(tx.amountCents)}`
                      : `+ ${formatCents(tx.amountCents)}`}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">{tx.concept}</span>
                      {tx.category && (
                        <span className="text-xs text-muted-foreground uppercase">{tx.category}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {tx.registeredByName ? (
                      <span className="font-medium text-foreground">{tx.registeredByName}</span>
                    ) : (
                      <span className="text-muted-foreground/70">Sin registrar</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {/* Nunca sustituir un autorizador ausente por el solicitante: esta
                        celda se lee como un hecho de auditoría, y el escudo verde lo
                        firmaba. Sin `approvedByName` no hubo segunda persona. */}
                    <div className="flex flex-col">
                      {tx.approvedByName ? (
                        <span className="font-medium flex items-center gap-1 text-success">
                          <ShieldCheck className="w-3 h-3" />
                          {tx.approvedByName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/70">Sin autorización registrada</span>
                      )}
                      {tx.authorizationNotes && (
                        <span className="text-xs text-muted-foreground/80 leading-tight">
                          Nota: {tx.authorizationNotes}
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
                      <span className="text-xs text-muted-foreground/50">—</span>
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
                className="max-h-96 object-contain rounded border"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
