"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PettyCashHistoryTable, PettyCashTransactionItem } from "@/components/finance/petty-cash-history-table";
import { PettyCashRegister } from "@/components/finance/petty-cash-register";
import { Wallet, AlertTriangle, CheckCircle2, ShieldCheck, Coins, Loader2 } from "lucide-react";

interface Branch {
  id: string;
  name: string;
}

export default function PettyCashPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [fund, setFund] = useState<any>(null);
  const [transactions, setTransactions] = useState<PettyCashTransactionItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch branches
  useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches");
        const data = await res.json();
        const list = data.data || data.branches || (Array.isArray(data) ? data : []);
        setBranches(list);
        if (list.length > 0) {
          setSelectedBranch(list[0].id);
        }
      } catch (err) {
        console.error("Error fetching branches:", err);
      }
    }
    fetchBranches();
  }, []);

  // Fetch fund & transaction audit history
  const fetchData = useCallback(async () => {
    if (!selectedBranch) return;
    setLoading(true);
    try {
      const [fundRes, txRes] = await Promise.all([
        fetch(`/api/petty-cash?branchId=${selectedBranch}`),
        fetch(`/api/petty-cash/transactions?branchId=${selectedBranch}`),
      ]);

      const [fundJson, txJson] = await Promise.all([fundRes.json(), txRes.json()]);

      if (fundRes.ok && fundJson.success) {
        setFund(fundJson.data);
      }
      if (txRes.ok && txJson.success) {
        setTransactions(txJson.data || []);
      }
    } catch (err) {
      console.error("Error loading petty cash data:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  const isLowBalance = fund && fund.currentBalance <= fund.lowThreshold;
  const balancePercentage = fund ? Math.round((fund.currentBalance / fund.fundAmount) * 100) : 100;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" /> Control y Auditoría de Caja Chica
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitoreo en tiempo real de retiros, reposiciones, autorizaciones por rol y bitácora de comprobantes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-48">
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona sucursal" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {branches.length > 0 && (
            <PettyCashRegister branches={branches} onSuccess={fetchData} />
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando estado de caja chica...
        </div>
      ) : fund ? (
        <>
          {/* Balance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-medium">Saldo Disponible</CardDescription>
                <CardTitle className="text-2xl font-bold text-foreground">
                  {formatMXN(fund.currentBalance)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-muted-foreground">
                    Fondo Total: {formatMXN(fund.fundAmount)}
                  </span>
                  {isLowBalance ? (
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 text-xs">
                      <AlertTriangle className="w-3 h-3" /> Reposición Requerida (&lt;20%)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 text-xs">
                      <CheckCircle2 className="w-3 h-3" /> Suficiente ({balancePercentage}%)
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-medium">Umbral Mínimo de Alerta</CardDescription>
                <CardTitle className="text-2xl font-bold text-muted-foreground">
                  {formatMXN(fund.lowThreshold)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground mt-1">
                Dispara alerta de Inngest al bajar del 20%
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-medium">Total de Movimientos</CardDescription>
                <CardTitle className="text-2xl font-bold text-foreground">
                  {transactions.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> Auditado con firma y foto
              </CardContent>
            </Card>
          </div>

          {/* Audit History Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Coins className="w-5 h-5 text-primary" /> Bitácora Auditable de Transacciones
              </CardTitle>
              <CardDescription className="text-xs">
                Historial completo de retiros e ingresos mostrando quién solicitó, quién autorizó, motivo registrado y comprobante adjunto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PettyCashHistoryTable transactions={transactions} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
