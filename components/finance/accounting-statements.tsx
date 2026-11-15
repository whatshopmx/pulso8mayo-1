"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BookOpen, CheckCircle2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CorporateUnassignedRow,
  LedgerEntryRow,
  StatementAccountRow,
  TrialBalanceRow,
} from "@/lib/services/accounting/report-service";

interface StatementsPayload {
  period: {
    fromDate: string;
    toDate: string;
    fiscalYearStart: string;
    branchId: string | null;
    branchName: string | null;
    openingCount: number;
    latestOpeningDate: string | null;
  };
  branches: { id: string; name: string; code: string }[];
  trialBalance: {
    rows: TrialBalanceRow[];
    totals: {
      openingDebitCents: number;
      openingCreditCents: number;
      periodDebitCents: number;
      periodCreditCents: number;
      closingDebitCents: number;
      closingCreditCents: number;
    };
  };
  incomeStatement: {
    income: StatementAccountRow[];
    expenses: StatementAccountRow[];
    totalIncomeCents: number;
    totalExpenseCents: number;
    netIncomeCents: number;
  };
  balanceSheet: {
    asOfDate: string;
    assets: StatementAccountRow[];
    liabilities: StatementAccountRow[];
    equity: StatementAccountRow[];
    totalAssetsCents: number;
    totalLiabilitiesCents: number;
    recordedEquityCents: number;
    retainedEarningsPriorYearsCents: number;
    currentYearNetIncomeCents: number;
    totalEquityCents: number;
    totalLiabilitiesAndEquityCents: number;
    isBalanced: boolean;
    differenceCents: number;
  };
  unassignedCorporate: {
    declared: boolean;
    journalCount: number;
    totalDebitCents: number;
    totalCreditCents: number;
    netIncomeImpactCents: number;
    declaration: string;
    accounts: CorporateUnassignedRow[];
  };
}

interface LedgerPayload {
  account: {
    id: string;
    code: string;
    name: string;
    kind: string;
    normalBalance: string;
  };
  period: {
    fromDate: string;
    toDate: string;
    branchId: string | null;
  };
  openingBalanceCents: number;
  entries: LedgerEntryRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  closingBalanceCents: number;
}

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

export function AccountingStatements() {
  const initial = currentMonthBounds();
  const [fromDate, setFromDate] = useState(initial.fromDate);
  const [toDate, setToDate] = useState(initial.toDate);
  const [branchId, setBranchId] = useState<string>("");
  const [tab, setTab] = useState<"trial" | "income" | "balance">("trial");
  const [data, setData] = useState<StatementsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ledger, setLedger] = useState<LedgerPayload | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const loadStatements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ fromDate, toDate });
      if (branchId) qs.set("branchId", branchId);
      const res = await fetch(`/api/finance/accounting/reports?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message ?? "No se pudieron cargar los estados contables.");
        setData(null);
        return;
      }
      setData(json.data as StatementsPayload);
    } catch {
      setError("Error de red al consultar los estados contables.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, branchId]);

  useEffect(() => {
    void loadStatements();
  }, [loadStatements]);

  const openLedger = async (accountId: string) => {
    setLedgerLoading(true);
    try {
      const qs = new URLSearchParams({ accountId, fromDate, toDate });
      if (branchId) qs.set("branchId", branchId);
      const res = await fetch(`/api/finance/accounting/reports?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setLedger(json.data as LedgerPayload);
      }
    } finally {
      setLedgerLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc17-from">
            Desde
          </label>
          <input
            id="fc17-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc17-to">
            Hasta
          </label>
          <input
            id="fc17-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="block rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc17-branch">
            Sucursal
          </label>
          <select
            id="fc17-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            <option value="">Todas las sucursales (consolidado)</option>
            {data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadStatements()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <>
          {/* Declaración explícita de partidas corporativas */}
          <div
            className={`rounded-lg border p-3 text-xs ${
              data.unassignedCorporate.declared
                ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                : "bg-muted/40 text-muted-foreground"
            }`}
          >
            <p className="font-medium">{data.unassignedCorporate.declaration}</p>
            {data.unassignedCorporate.declared && data.unassignedCorporate.accounts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {data.unassignedCorporate.accounts.map((acc) => (
                  <span key={acc.accountId} className="rounded border bg-background px-2 py-0.5 text-xs">
                    {acc.code} {acc.name}: C {formatMxn(acc.debitCents)} / A {formatMxn(acc.creditCents)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Selector de estado */}
          <div className="flex gap-2 border-b pb-2">
            {(
              [
                { key: "trial", label: "Balanza de Comprobación" },
                { key: "income", label: "Estado de Resultados" },
                { key: "balance", label: "Balance General" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === item.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Balanza de Comprobación */}
          {tab === "trial" && (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Código</th>
                    <th className="px-3 py-2 text-left">Cuenta</th>
                    <th className="px-3 py-2 text-right">Saldo inicial</th>
                    <th className="px-3 py-2 text-right">Cargos</th>
                    <th className="px-3 py-2 text-right">Abonos</th>
                    <th className="px-3 py-2 text-right">Saldo final</th>
                    <th className="px-3 py-2 text-right">Mayor</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.trialBalance.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                        Sin pólizas publicadas en el rango seleccionado.
                      </td>
                    </tr>
                  ) : (
                    data.trialBalance.rows.map((row) => (
                      <tr key={row.accountId} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMxn(row.openingNetCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMxn(row.periodDebitCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMxn(row.periodCreditCents)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMxn(row.closingNetCents)}</td>
                        <td className="px-3 py-2 text-right">
                          <Button type="button" variant="ghost" size="sm" onClick={() => void openLedger(row.accountId)}>
                            <BookOpen className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="border-t bg-muted/40 font-semibold">
                  <tr>
                    <td colSpan={3} className="px-3 py-2">
                      Totales del periodo
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMxn(data.trialBalance.totals.periodDebitCents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMxn(data.trialBalance.totals.periodCreditCents)}
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-right text-xs text-muted-foreground">
                      Apertura C {formatMxn(data.trialBalance.totals.openingDebitCents)} / A{" "}
                      {formatMxn(data.trialBalance.totals.openingCreditCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Estado de Resultados */}
          {tab === "income" && (
            <div className="space-y-4 rounded-lg border bg-card p-4">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Ingresos</h3>
                <div className="divide-y rounded border">
                  {data.incomeStatement.income.map((row) => (
                    <div key={row.accountId} className="flex items-center justify-between px-3 py-2 text-sm">
                      <button
                        type="button"
                        onClick={() => void openLedger(row.accountId)}
                        className="text-left hover:underline"
                      >
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{row.code}</span>
                        {row.name}
                      </button>
                      <span className="tabular-nums">{formatMxn(row.amountCents)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between bg-muted/40 px-3 py-2 text-sm font-semibold">
                    <span>Total Ingresos</span>
                    <span className="tabular-nums">{formatMxn(data.incomeStatement.totalIncomeCents)}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Costos y Gastos</h3>
                <div className="divide-y rounded border">
                  {data.incomeStatement.expenses.map((row) => (
                    <div key={row.accountId} className="flex items-center justify-between px-3 py-2 text-sm">
                      <button
                        type="button"
                        onClick={() => void openLedger(row.accountId)}
                        className="text-left hover:underline"
                      >
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{row.code}</span>
                        {row.name}
                      </button>
                      <span className="tabular-nums">{formatMxn(row.amountCents)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between bg-muted/40 px-3 py-2 text-sm font-semibold">
                    <span>Total Gastos</span>
                    <span className="tabular-nums">{formatMxn(data.incomeStatement.totalExpenseCents)}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between rounded-md border bg-muted/60 px-4 py-3 text-base font-bold">
                <span>Resultado del periodo</span>
                <span className="tabular-nums">{formatMxn(data.incomeStatement.netIncomeCents)}</span>
              </div>
            </div>
          )}

          {/* Balance General */}
          {tab === "balance" && (
            <div className="space-y-4 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Balance General al {data.balanceSheet.asOfDate}</h3>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    data.balanceSheet.isBalanced
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {data.balanceSheet.isBalanced
                    ? "Cuadrado (sin ajuste oculto)"
                    : `Diferencia: ${formatMxn(data.balanceSheet.differenceCents)}`}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 rounded border p-3">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Activo</h4>
                  {data.balanceSheet.assets.map((row) => (
                    <div key={row.accountId} className="flex justify-between text-sm">
                      <button type="button" onClick={() => void openLedger(row.accountId)} className="hover:underline">
                        {row.code} {row.name}
                      </button>
                      <span className="tabular-nums">{formatMxn(row.amountCents)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-2 text-sm font-bold">
                    <span>Total Activo</span>
                    <span className="tabular-nums">{formatMxn(data.balanceSheet.totalAssetsCents)}</span>
                  </div>
                </div>

                <div className="space-y-3 rounded border p-3">
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Pasivo</h4>
                    {data.balanceSheet.liabilities.map((row) => (
                      <div key={row.accountId} className="flex justify-between text-sm">
                        <button type="button" onClick={() => void openLedger(row.accountId)} className="hover:underline">
                          {row.code} {row.name}
                        </button>
                        <span className="tabular-nums">{formatMxn(row.amountCents)}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold">
                      <span>Total Pasivo</span>
                      <span className="tabular-nums">{formatMxn(data.balanceSheet.totalLiabilitiesCents)}</span>
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Capital Contable</h4>
                    {data.balanceSheet.equity.map((row) => (
                      <div key={row.accountId} className="flex justify-between text-sm">
                        <button type="button" onClick={() => void openLedger(row.accountId)} className="hover:underline">
                          {row.code} {row.name}
                        </button>
                        <span className="tabular-nums">{formatMxn(row.amountCents)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm">
                      <span>Arrastre de ejercicios anteriores</span>
                      <span className="tabular-nums">
                        {formatMxn(data.balanceSheet.retainedEarningsPriorYearsCents)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Resultado del ejercicio en curso</span>
                      <span className="tabular-nums">
                        {formatMxn(data.balanceSheet.currentYearNetIncomeCents)}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold">
                      <span>Total Capital</span>
                      <span className="tabular-nums">{formatMxn(data.balanceSheet.totalEquityCents)}</span>
                    </div>
                  </div>

                  <div className="flex justify-between border-t pt-2 text-sm font-bold">
                    <span>Total Pasivo + Capital</span>
                    <span className="tabular-nums">{formatMxn(data.balanceSheet.totalLiabilitiesAndEquityCents)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Drill-down al mayor */}
      {(ledger || ledgerLoading) && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">
                {ledgerLoading
                  ? "Cargando auxiliar..."
                  : `Auxiliar de mayor: ${ledger?.account.code} ${ledger?.account.name}`}
              </h3>
              {ledger && (
                <p className="text-xs text-muted-foreground">
                  Saldo inicial: {formatMxn(ledger.openingBalanceCents)} · Saldo final:{" "}
                  {formatMxn(ledger.closingBalanceCents)}
                </p>
              )}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLedger(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {ledger && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="border-b bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left">Fecha</th>
                    <th className="px-2.5 py-1.5 text-left">Folio</th>
                    <th className="px-2.5 py-1.5 text-left">Descripción</th>
                    <th className="px-2.5 py-1.5 text-left">Sucursal</th>
                    <th className="px-2.5 py-1.5 text-right">Cargo</th>
                    <th className="px-2.5 py-1.5 text-right">Abono</th>
                    <th className="px-2.5 py-1.5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ledger.entries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2.5 py-4 text-center text-muted-foreground">
                        Sin movimientos publicados en este rango.
                      </td>
                    </tr>
                  ) : (
                    ledger.entries.map((e, i) => (
                      <tr key={`${e.journalId}-${i}`}>
                        <td className="px-2.5 py-1.5 font-mono">{e.accountingDate}</td>
                        <td className="px-2.5 py-1.5 font-mono">#{e.journalNumber ?? "—"}</td>
                        <td className="px-2.5 py-1.5">{e.memo ? `${e.description} (${e.memo})` : e.description}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{e.branchName ?? "Corporativo"}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatMxn(e.debitCents)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatMxn(e.creditCents)}</td>
                        <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">
                          {formatMxn(e.runningBalanceCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
