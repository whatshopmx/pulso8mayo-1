"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { useMovements } from "@/hooks/queries";
import { ChevronLeft, Download, Loader2, Package, Search } from "lucide-react";
import { useExportCsv } from "@/components/shared/use-export-csv";

const TYPE_OPTIONS = [
  { value: "RECEIVING", label: "Entrada" },
  { value: "USAGE", label: "Salida" },
  { value: "ADJUSTMENT", label: "Ajuste" },
  { value: "TRANSFER", label: "Transferencia" },
  { value: "WASTE", label: "Merma" },
  { value: "RETURN", label: "Devolución" },
];

const TYPE_BADGE: Record<string, { variant: "default" | "destructive" | "secondary" | "outline" | "warning"; className?: string }> = {
  RECEIVING: { variant: "default", className: "bg-green-100 text-green-800 hover:bg-green-100" },
  USAGE: { variant: "destructive" },
  ADJUSTMENT: { variant: "secondary" },
  TRANSFER: { variant: "outline" },
  WASTE: { variant: "warning" },
  RETURN: { variant: "outline", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
};

function formatCurrency(cents: number | null | undefined) {
  if (!cents) return "$0.00";
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function MovementsClient() {
  const { selectedBranchId, selectedBranch } = useBranch();
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchItem, setSearchItem] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const { exportToCsv } = useExportCsv();

  const params = useMemo(() => ({
    branchId: selectedBranchId || undefined,
    type: selectedTypes.length > 0 ? selectedTypes : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: pageSize,
    offset: page * pageSize,
  }), [selectedBranchId, selectedTypes, dateFrom, dateTo, page]);

  const { data, isLoading } = useMovements(params);
  const movements = data?.movements || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
    setPage(0);
  };

  const handleExportCSV = () => {
    exportToCsv({
      headers: ["Fecha", "Tipo", "Producto", "SKU", "Lote", "Cantidad", "Valor", "Razón"],
      rows: movements.map((m: any) => [
        m.timestamp ? new Date(m.timestamp).toLocaleString() : "",
        TYPE_OPTIONS.find((t) => t.value === m.type)?.label || m.type,
        m.itemName || "",
        m.itemSku || "",
        m.batchNumber || "",
        String(m.quantityChange),
        formatCurrency(m.unitCost ? m.unitCost * Math.abs(m.quantityChange) : null),
        m.reason || "",
      ]),
      filename: "movimientos",
      useBom: true,
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Movimientos de Inventario"
        description="Historial completo de entradas, salidas y ajustes"
        icon={Package}
        branchName={selectedBranch?.name}
        actions={
          <Link href="/dashboard/inventory">
            <Button variant="ghost" size="icon">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Filtros</CardTitle>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={movements.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <div className="flex flex-wrap gap-1.5">
                {TYPE_OPTIONS.map((opt) => {
                  const active = selectedTypes.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleType(opt.value)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="h-8 w-36" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="h-8 w-36" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Buscar Producto</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchItem}
                  onChange={(e) => setSearchItem(e.target.value)}
                  placeholder="Nombre o SKU..."
                  className="h-8 pl-7 w-44"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
          ) : movements.length === 0 ? (
            <div className="py-16">
              <EmptyState
                icon={Package}
                title="Sin movimientos"
                description="No se encontraron movimientos con los filtros seleccionados."
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Razón</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m: any) => {
                    const badge = TYPE_BADGE[m.type] || { variant: "outline" as const };
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {m.timestamp ? new Date(m.timestamp).toLocaleString() : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} className={badge.className}>
                            {TYPE_OPTIONS.find((t) => t.value === m.type)?.label || m.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link href={`/dashboard/inventory/${m.itemId}`} className="font-medium hover:underline">
                            {m.itemName || "N/A"}
                          </Link>
                          {m.itemSku && <span className="text-xs text-muted-foreground ml-1">({m.itemSku})</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.batchNumber || "-"}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${m.quantityChange > 0 ? "text-green-600" : "text-red-600"}`}>
                          {m.quantityChange > 0 ? "+" : ""}{m.quantityChange}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {formatCurrency(m.unitCost ? m.unitCost * Math.abs(m.quantityChange) : null)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{m.reason || "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    {total} movimientos (pág. {page + 1} de {totalPages})
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                      Anterior
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
