"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Info, Loader2 } from "lucide-react";

export interface BranchPnLItem {
  branchId: string;
  branchName: string;
  totalSalesCents: number;
  foodCostCents: number;
  foodCostPercent: number;
  laborCostCents: number;
  laborCostPercent: number;
  operatingExpensesCents: number;
  operatingExpensesPercent: number;
  operatingProfitCents: number;
  operatingProfitPercent: number;
  dataCoveragePercent: number;
  coverageNote: string;
}

export function PnlBranchTable() {
  const [pnlData, setPnlData] = useState<BranchPnLItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyRed, setOnlyRed] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 5;

  useEffect(() => {
    async function fetchPnL() {
      setLoading(true);
      try {
        const res = await fetch("/api/finance/pnl");
        const json = await res.json();
        if (res.ok && json.success) {
          setPnlData(json.data || []);
        }
      } catch (err) {
        console.error("Failed to load P&L data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchPnL();
  }, []);

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  // Calculate Group Totals
  const totals = pnlData.reduce(
    (acc, b) => {
      acc.totalSales += b.totalSalesCents;
      acc.foodCost += b.foodCostCents;
      acc.laborCost += b.laborCostCents;
      acc.operatingExpenses += b.operatingExpensesCents;
      acc.operatingProfit += b.operatingProfitCents;
      acc.coverageSum += b.dataCoveragePercent;
      return acc;
    },
    { totalSales: 0, foodCost: 0, laborCost: 0, operatingExpenses: 0, operatingProfit: 0, coverageSum: 0 },
  );

  const groupCount = pnlData.length;
  const groupFoodPercent = totals.totalSales > 0 ? Math.round((totals.foodCost / totals.totalSales) * 100) : 0;
  const groupLaborPercent = totals.totalSales > 0 ? Math.round((totals.laborCost / totals.totalSales) * 100) : 0;
  const groupProfitPercent = totals.totalSales > 0 ? Math.round((totals.operatingProfit / totals.totalSales) * 100) : 0;
  const groupAvgCoverage = groupCount > 0 ? Math.round(totals.coverageSum / groupCount) : 0;

  // Filtered & Paginated items
  const filtered = pnlData.filter((b) => {
    const matchesSearch = b.branchName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRed = onlyRed ? b.operatingProfitCents < 0 : true;
    return matchesSearch && matchesRed;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> P&L Operativo Estimado por Sucursal (Neto sin IVA)
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">
            Utilidad Operativa = Ventas − Alimentos − Costo Laboral − Gastos Operativos.
          </CardDescription>
        </div>

        {groupCount > 3 && (
          <div className="flex items-center gap-2 self-start md:self-auto">
            <input
              type="text"
              placeholder="Buscar sucursal..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="h-8 w-36 md:w-44 rounded-md border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              onClick={() => {
                setOnlyRed(!onlyRed);
                setPage(1);
              }}
              className={`h-8 px-2.5 text-xs font-medium rounded-md border transition-colors ${
                onlyRed
                  ? "bg-red-50 dark:bg-red-950 text-destructive border-destructive/40"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground border-border"
              }`}
            >
              {onlyRed ? "Ver Todas" : "En Rojo"}
            </button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculando P&L por sucursal...
          </div>
        ) : pnlData.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Sin suficientes datos para consolidar el P&L de las sucursales.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-xs">
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Venta Neta</TableHead>
                    <TableHead className="text-right">Food Cost %</TableHead>
                    <TableHead className="text-right">Labor %</TableHead>
                    <TableHead className="text-right">Gastos Operativos</TableHead>
                    <TableHead className="text-right bg-emerald-500/5">Utilidad Est. ($)</TableHead>
                    <TableHead className="text-right bg-emerald-500/5">Margen %</TableHead>
                    <TableHead className="text-center">Cobertura de Datos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Group Consolidate Summary Row */}
                  <TableRow className="bg-primary/5 hover:bg-primary/10 font-bold text-xs border-b-2 border-primary/20">
                    <TableCell className="font-bold text-foreground flex items-center gap-1.5">
                      <span>TOTAL GRUPO</span>
                      <Badge variant="outline" className="text-xs py-0 font-normal">
                        {groupCount} sucursales
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatMXN(totals.totalSales)}</TableCell>
                    <TableCell className="text-right">{groupFoodPercent}%</TableCell>
                    <TableCell className="text-right">{groupLaborPercent}%</TableCell>
                    <TableCell className="text-right font-bold">{formatMXN(totals.operatingExpenses)}</TableCell>
                    <TableCell
                      className={`text-right font-bold bg-emerald-500/10 ${
                        totals.operatingProfit >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                      }`}
                    >
                      {formatMXN(totals.operatingProfit)}
                    </TableCell>
                    <TableCell className="text-right font-bold bg-emerald-500/10">{groupProfitPercent}%</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="text-xs gap-1 font-semibold">
                        <Info className="w-3 h-3" /> {groupAvgCoverage}% Prom.
                      </Badge>
                    </TableCell>
                  </TableRow>

                  {/* Individual Branches */}
                  {paginated.map((item) => (
                    <TableRow key={item.branchId} className="hover:bg-muted/40 transition text-xs">
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/branches?branchId=${item.branchId}`}
                          className="hover:underline text-foreground"
                        >
                          {item.branchName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatMXN(item.totalSalesCents)}</TableCell>
                      <TableCell className="text-right">{item.foodCostPercent}%</TableCell>
                      <TableCell className="text-right">{item.laborCostPercent}%</TableCell>
                      <TableCell className="text-right font-medium">{formatMXN(item.operatingExpensesCents)}</TableCell>
                      <TableCell
                        className={`text-right font-bold bg-emerald-500/5 ${
                          item.operatingProfitCents >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive"
                        }`}
                      >
                        {formatMXN(item.operatingProfitCents)}
                      </TableCell>
                      <TableCell className="text-right font-bold bg-emerald-500/5">{item.operatingProfitPercent}%</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs bg-muted/30 gap-1">
                          <Info className="w-3 h-3 text-muted-foreground" /> {item.dataCoveragePercent}% Cobertura
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}

                  {paginated.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-6 text-xs text-muted-foreground">
                        No se encontraron sucursales con el filtro actual.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                <span>
                  Mostrando {((currentPage - 1) * pageSize) + 1}–
                  {Math.min(currentPage * pageSize, filtered.length)} de {filtered.length} sucursales
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-md border border-input bg-background hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    Anterior
                  </button>
                  <span className="font-medium text-foreground">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 rounded-md border border-input bg-background hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
