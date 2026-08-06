"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PettyCashHistoryTable, PettyCashTransactionItem } from "@/components/finance/petty-cash-history-table";
import { PettyCashRegister } from "@/components/finance/petty-cash-register";
import { useBranches } from "@/hooks/use-branches";
import { formatCents } from "@/lib/utils";
import {
  Wallet,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Coins,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface PettyFund {
  branchId?: string;
  branchName?: string;
  currentBalance: number;
  fundAmount: number;
  lowThreshold: number;
  /**
   * Solo en vista consolidada. El umbral NO es aditivo: sumarlo permitiría que
   * la cadena luzca sana mientras una sucursal está en cero, así que se reporta
   * cuántas sucursales están bajo su propio umbral.
   */
  consolidated?: { branchesBelowThreshold: number; branchesWithFund: number };
}

export default function PettyCashPage() {
  const {
    branches,
    loading: branchesLoading,
    error: branchesError,
    refetch: refetchBranches,
  } = useBranches();
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [fund, setFund] = useState<PettyFund | null>(null);
  const [transactions, setTransactions] = useState<PettyCashTransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fundError, setFundError] = useState<string | null>(null);

  // El fallo al cargar sucursales tiene prioridad: sin ellas no hay fondo que pedir.
  const error = branchesError ?? fundError;

  // Fetch fund & transaction audit history (single branch, or aggregated "ALL")
  const fetchData = useCallback(async () => {
    // Aún no se sabe qué sucursales existen; el efecto vuelve a correr al resolverse.
    if (branchesLoading) return;
    // Sin sucursales no hay nada que pedir, pero el spinner debe apagarse:
    // dejarlo encendido hacía inalcanzable el estado de error que lo provocó.
    if (branches.length === 0) {
      setFund(null);
      setTransactions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFundError(null);
    try {
      const targetBranches =
        selectedBranch === "ALL" ? branches : branches.filter((b) => b.id === selectedBranch);

      const results = await Promise.all(
        targetBranches.map(async (b) => {
          const [fundRes, txRes] = await Promise.all([
            fetch(`/api/petty-cash?branchId=${b.id}`),
            fetch(`/api/petty-cash/transactions?branchId=${b.id}`),
          ]);
          const [fundJson, txJson] = await Promise.all([fundRes.json(), txRes.json()]);
          return {
            branchId: b.id,
            branchName: b.name,
            fund: fundRes.ok && fundJson.success ? (fundJson.data as PettyFund | null) : null,
            tx: txRes.ok && txJson.success ? (txJson.data as PettyCashTransactionItem[]) : [],
          };
        })
      );

      const fundsFound = results.filter((r) => r.fund);
      const allTx = results.flatMap((r) => r.tx);

      if (fundsFound.length === 0) {
        setFund(null);
        setTransactions([]);
        return;
      }

      if (selectedBranch === "ALL" && fundsFound.length > 1) {
        // Aggregated consolidated view for the chain owner
        setFund({
          branchName: "Vista consolidada",
          currentBalance: fundsFound.reduce((s, r) => s + (r.fund?.currentBalance || 0), 0),
          fundAmount: fundsFound.reduce((s, r) => s + (r.fund?.fundAmount || 0), 0),
          lowThreshold: 0, // no aplica en consolidado; ver `consolidated`
          consolidated: {
            branchesBelowThreshold: fundsFound.filter(
              (r) => r.fund!.currentBalance <= r.fund!.lowThreshold
            ).length,
            branchesWithFund: fundsFound.length,
          },
        });
      } else {
        const f = fundsFound[0].fund!;
        setFund({ ...f, branchName: fundsFound[0].branchName });
      }
      setTransactions(allTx);
    } catch (err) {
      console.error("Error loading petty cash data:", err);
      setFundError("No se pudo cargar el estado de caja chica. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, branches, branchesLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Un fondo de $0 no admite porcentaje: sin esta guarda el badge imprime "NaN%"
  // (el clamp de la barra ocultaba el síntoma, no la causa).
  const hasFundAmount = fund !== null && fund.fundAmount > 0;
  const balancePercentage = hasFundAmount
    ? Math.round((fund.currentBalance / fund.fundAmount) * 100)
    : null;
  const thresholdPercentage = hasFundAmount
    ? Math.round((fund.lowThreshold / fund.fundAmount) * 100)
    : null;

  const consolidated = fund?.consolidated;
  const isLowBalance = consolidated
    ? consolidated.branchesBelowThreshold > 0
    : fund
      ? fund.currentBalance <= fund.lowThreshold
      : false;

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
          <div className="w-56">
            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={branchesLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Vista consolidada (todas)</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {branches.length > 0 && selectedBranch !== "ALL" && (
            <PettyCashRegister branches={branches} onSuccess={fetchData} />
          )}
        </div>
      </div>

      {branchesLoading || loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando estado de caja chica...
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudo cargar la caja chica"
          description={error}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Reintenta ambas cargas: al reponerse las sucursales, el efecto
                // vuelve a disparar la del fondo.
                refetchBranches();
                fetchData();
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : branches.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No hay sucursales registradas"
          description="La caja chica se administra por sucursal. Registra al menos una sucursal para poder abrir un fondo."
        />
      ) : fund ? (
        <>
          {/* Distilled status surface — one prominent figure + inline threshold bar + movements line */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardDescription className="text-xs font-medium">
                  Saldo Disponible{fund.branchName ? ` · ${fund.branchName}` : ""}
                </CardDescription>
                {isLowBalance ? (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 text-xs">
                    <AlertTriangle className="w-3 h-3" /> Reposición requerida
                    {consolidated
                      ? ` (${consolidated.branchesBelowThreshold} de ${consolidated.branchesWithFund} sucursales)`
                      : thresholdPercentage !== null
                        ? ` (<${thresholdPercentage}%)`
                        : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-success/10 text-success border-success/20 gap-1 text-xs">
                    <CheckCircle2 className="w-3 h-3" /> Suficiente
                    {balancePercentage !== null ? ` (${balancePercentage}%)` : ""}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-3xl font-bold text-foreground pt-1">
                {formatCents(fund.currentBalance)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Inline threshold bar: currentBalance as % of fundAmount, mark at threshold */}
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Fondo total: {formatCents(fund.fundAmount)}</span>
                  <span>
                    {consolidated
                      ? `${consolidated.branchesBelowThreshold} de ${consolidated.branchesWithFund} sucursales bajo umbral`
                      : `Umbral de alerta: ${formatCents(fund.lowThreshold)}`}
                  </span>
                </div>
                <div className="relative w-full h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                      isLowBalance ? "bg-destructive" : "bg-success"
                    }`}
                    style={{ width: `${Math.min(Math.max(balancePercentage ?? 0, 0), 100)}%` }}
                  />
                  {/* Threshold mark — el umbral por sucursal no aplica al consolidado */}
                  {!consolidated && thresholdPercentage !== null && (
                    <div
                      className="absolute inset-y-0 w-px bg-foreground/40"
                      style={{ left: `${Math.min(Math.max(thresholdPercentage, 0), 100)}%` }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>

              {/* Movements as a demoted secondary line, not its own card */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t">
                <ShieldCheck className="w-4 h-4 text-success" />
                <span className="font-medium text-foreground">{transactions.length}</span>
                movimientos auditados con firma y comprobante fotográfico.
              </div>
            </CardContent>
          </Card>

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
      ) : (
        <EmptyState
          icon={Wallet}
          title="Sin caja chica en esta sucursal"
          description={
            selectedBranch === "ALL"
              ? "Ninguna sucursal tiene un fondo de caja chica registrado. Crea el primero desde una sucursal específica."
              : "Esta sucursal aún no tiene fondo de caja chica. Registra el primer movimiento para inicializar el fondo."
          }
          action={
            selectedBranch !== "ALL" && branches.length > 0 ? (
              <PettyCashRegister branches={branches} onSuccess={fetchData} />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
