"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowDownLeft, ArrowUpRight, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PnlBridgeReport } from "@/lib/services/accounting/pnl-bridge-service";

function formatMxn(cents: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function currentMonthBounds() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const lastDay = String(new Date(Date.UTC(y, now.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0");
  return { fromDate: `${y}-${m}-01`, toDate: `${y}-${m}-${lastDay}` };
}

const CATEGORY_LABELS: Record<"FUENTE" | "FECHA" | "ESTIMACION", string> = {
  FUENTE: "Fuente",
  FECHA: "Fecha / Temporal",
  ESTIMACION: "Estimación",
};

export function AccountingCashFlow({ branchId }: { branchId?: string | null }) {
  const initial = currentMonthBounds();
  const [fromDate, setFromDate] = useState(initial.fromDate);
  const [toDate, setToDate] = useState(initial.toDate);
  const [report, setReport] = useState<PnlBridgeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ fromDate, toDate });
      if (branchId && branchId !== "ALL") qs.set("branchId", branchId);
      const res = await fetch(`/api/finance/accounting/cash-flow?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message ?? "No se pudo consultar el flujo realizado.");
        setReport(null);
        return;
      }
      setReport(json.data as PnlBridgeReport);
    } catch {
      setError("Error de red al consultar el flujo contable.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, branchId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc18-from">
            Desde
          </label>
          <input
            id="fc18-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc18-to">
            Hasta
          </label>
          <input
            id="fc18-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadReport()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar flujo realizado
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {report && (
        <>
          {/* Conciliación apertura / cierre */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Efectivo inicial</p>
              <p className="text-lg font-bold tabular-nums">{formatMxn(report.cashFlow.openingCashCents)}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Flujo neto del periodo</p>
              <p className="text-lg font-bold tabular-nums">{formatMxn(report.cashFlow.netCashFlowCents)}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Efectivo final</p>
              <p className="text-lg font-bold tabular-nums">{formatMxn(report.cashFlow.closingCashCents)}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Cuadre apertura + flujo = cierre</p>
              <p
                className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold ${
                  report.cashFlow.reconcilesWithCashBalances
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                {report.cashFlow.reconcilesWithCashBalances ? "Conciliado" : "Con diferencia"}
              </p>
            </div>
          </div>

          {/* Clasificación Operación / Inversión / Financiamiento */}
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                { title: "Operación", bucket: report.cashFlow.operating },
                { title: "Inversión", bucket: report.cashFlow.investing },
                { title: "Financiamiento", bucket: report.cashFlow.financing },
              ] as const
            ).map(({ title, bucket }) => (
              <div key={title} className="rounded-lg border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <span className="text-sm font-bold tabular-nums">{formatMxn(bucket.netCents)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <ArrowDownLeft className="h-3.5 w-3.5" /> Entradas: {formatMxn(bucket.inflowsCents)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-rose-600">
                    <ArrowUpRight className="h-3.5 w-3.5" /> Salidas: {formatMxn(bucket.outflowsCents)}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y border-t pt-1 text-xs">
                  {bucket.items.length === 0 ? (
                    <p className="py-2 text-muted-foreground">Sin movimientos.</p>
                  ) : (
                    bucket.items.map((item) => (
                      <div key={item.journalId} className="flex items-center justify-between gap-2 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.description}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {item.accountingDate} · {item.counterpartSummary}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono tabular-nums">{formatMxn(item.signedCashCents)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Transferencias internas excluidas */}
          <div className="rounded-lg border bg-muted/40 p-3 text-xs">
            <p className="font-medium">
              Transferencias internas excluidas: {report.cashFlow.excludedTransfers.count} póliza(s) por{" "}
              {formatMxn(report.cashFlow.excludedTransfers.totalAmountCents)} (no alteran el efectivo neto).
            </p>
          </div>

          {/* Puente P&L Operativo vs Flujo Realizado */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Puente: P&L operativo vs Flujo operativo realizado</h3>
                <p className="text-xs text-muted-foreground">
                  P&L operativo: {formatMxn(report.operationalOperatingProfitCents)} · Resultado contable:{" "}
                  {formatMxn(report.accountingNetIncomeCents)} · Flujo operativo:{" "}
                  {formatMxn(report.operatingCashFlowCents)}
                </p>
              </div>
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                Sin explicar contable→caja: {formatMxn(report.unexplainedAccountingToCashCents)}
              </span>
            </div>

            <div className="divide-y rounded border">
              {report.items.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Sin diferencias entre P&L y flujo operativo en el periodo.
                </p>
              ) : (
                report.items.map((item, idx) => (
                  <div key={`${item.code}-${idx}`} className="flex items-start justify-between gap-3 p-3 text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                          {CATEGORY_LABELS[item.category]}
                        </span>
                        <span className="font-medium text-sm">{item.label}</span>
                      </div>
                      <p className="text-muted-foreground">{item.explanation}</p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                      {formatMxn(item.amountCents)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
