"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FinancialKpiCards } from "@/components/sales/financial-kpi-cards";
import { PnlBranchTable } from "@/components/finance/pnl-branch-table";
import { PeriodSelector, getPresetRange, type DateRange } from "@/components/finance/period-selector";
import { useBranch } from "@/lib/branch-context";
import { BarChart3, RefreshCw, Users, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function FinanceResultsPage() {
  const { selectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";

  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange("this_month"));

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        refresh();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [refresh]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-primary" /> Resultados y Rentabilidad
          </h1>
          <p className="text-sm text-muted-foreground max-w-[70ch]">
            Comparación de sucursales, insumos, merma, nómina y resultado operativo con procedencia auditable de datos.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
          <PeriodSelector dateRange={dateRange} onDateRangeChange={setDateRange} disabled={refreshing} />
          <button
            type="button"
            onClick={refresh}
            className="self-start sm:self-center inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-input bg-background text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Recargar (Ctrl+Shift+R)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Recargar</span>
          </button>
        </div>
      </div>

      {/* Accesos rápidos a análisis específicos de resultados */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild className="h-8 text-xs gap-1.5">
          <Link href="/dashboard/finance/labor-cost">
            <Users className="w-3.5 h-3.5 text-muted-foreground" /> Costo Laboral por Sucursal
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild className="h-8 text-xs gap-1.5">
          <Link href="/dashboard/finance/commissions">
            <Percent className="w-3.5 h-3.5 text-muted-foreground" /> Comisiones por Canal
          </Link>
        </Button>
      </div>

      {/* 1. Indicadores clave */}
      <section id="kpis">
        <h2 className="text-sm font-semibold text-foreground/80 mb-2">Márgenes y objetivos</h2>
        <FinancialKpiCards key={`kpi-${refreshKey}`} branchId={selectedBranch} dateRange={dateRange} />
      </section>

      {/* 2. P&L de sucursales con procedencia */}
      <section id="pnl">
        <h2 className="text-sm font-semibold text-foreground/80 mb-2">P&L Consolidado por Sucursal</h2>
        <PnlBranchTable key={`pnl-${refreshKey}`} dateRange={dateRange} />
      </section>
    </div>
  );
}
