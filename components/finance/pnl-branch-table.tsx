"use client";

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

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-success" /> P&L Operativo Estimado por Sucursal (Neto sin IVA)
        </CardTitle>
        <CardDescription className="text-xs">
          Utilidad Operativa = Ventas − Alimentos − Costo Laboral − Gastos Operativos.
        </CardDescription>
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
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-xs">
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Venta Neta</TableHead>
                  <TableHead className="text-right">Food Cost %</TableHead>
                  <TableHead className="text-right">Labor %</TableHead>
                  <TableHead className="text-right">Gastos Operativos</TableHead>
                  <TableHead className="text-right">Utilidad Est. ($)</TableHead>
                  <TableHead className="text-right">Margen %</TableHead>
                  <TableHead className="text-center">Cobertura de Datos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pnlData.map((item) => (
                  <TableRow key={item.branchId} className="hover:bg-muted/40 transition text-xs">
                    <TableCell className="font-bold">{item.branchName}</TableCell>
                    <TableCell className="text-right font-medium">{formatMXN(item.totalSalesCents)}</TableCell>
                    <TableCell className="text-right">{item.foodCostPercent}%</TableCell>
                    <TableCell className="text-right">{item.laborCostPercent}%</TableCell>
                    <TableCell className="text-right font-medium">{formatMXN(item.operatingExpensesCents)}</TableCell>
                    <TableCell
                      className={`text-right font-bold ${
                        item.operatingProfitCents >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {formatMXN(item.operatingProfitCents)}
                    </TableCell>
                    <TableCell className="text-right font-bold">{item.operatingProfitPercent}%</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs bg-muted/30 gap-1">
                        <Info className="w-3 h-3 text-muted-foreground" /> {item.dataCoveragePercent}% Cobertura
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
