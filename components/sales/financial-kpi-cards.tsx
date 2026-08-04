"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertCircle, Loader2, Wallet, Utensils, Users, TrendingUp } from "lucide-react";

interface FinancialKpiCardsProps {
  branchId?: string;
}

type SemaphoreStatus = "OK" | "WARNING" | "CRITICAL";

interface FinancialKpis {
  totalSales: number;
  cutsCount: number;
  totalTickets: number;
  avgTicketCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  foodCostPercent: number;
  foodCostStatus: SemaphoreStatus;
  laborCostPercent: number;
  laborCostStatus: SemaphoreStatus;
  combinedCostPercent: number;
  healthyMarginPercent: number;
}

const STATUS_COLORS: Record<SemaphoreStatus, { bar: string; badge: string; label: string }> = {
  OK: { bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "✓ Saludable" },
  WARNING: { bar: "bg-amber-500", badge: "bg-amber-100 text-amber-700", label: "⚠ Precaución" },
  CRITICAL: { bar: "bg-red-500", badge: "bg-red-100 text-red-700", label: "❗ Crítico" },
};

export function FinancialKpiCards({ branchId }: FinancialKpiCardsProps) {
  const [kpis, setKpis] = useState<FinancialKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fetchKpis = async () => {
      setLoading(true);
      setFailed(false);
      try {
        // Fetch sales summary
        const salesUrl = new URL("/api/sales/analytics", window.location.origin);
        if (branchId && branchId !== "ALL") {
          salesUrl.searchParams.set("branchId", branchId);
        }

        // Fetch financial KPIs (food cost, labor cost)
        const kpiUrl = new URL("/api/finance/kpis", window.location.origin);
        if (branchId && branchId !== "ALL") {
          kpiUrl.searchParams.set("branchId", branchId);
        }

        const [salesRes, kpiRes] = await Promise.all([
          fetch(salesUrl.toString()),
          fetch(kpiUrl.toString()),
        ]);

        const salesJson = await salesRes.json();
        const kpiJson = await kpiRes.json();

        if (salesRes.ok && salesJson.success) {
          const summary = salesJson.data?.summary;
          const totalSales = summary?.totalSalesCents || 0;
          if (totalSales > 0) {
            const financeData = (kpiRes.ok && kpiJson.success) ? kpiJson.data : null;
            setKpis({
              totalSales,
              cutsCount: summary.cutsCount,
              totalTickets: summary.totalTickets,
              avgTicketCents: summary.avgTicketCents,
              cashSalesCents: summary.cashSalesCents || 0,
              cardSalesCents: summary.cardSalesCents || 0,
              foodCostPercent: financeData?.foodCostPercent ?? 0,
              foodCostStatus: financeData?.foodCostStatus ?? "OK",
              laborCostPercent: financeData?.laborCostPercent ?? 0,
              laborCostStatus: financeData?.laborCostStatus ?? "OK",
              combinedCostPercent: financeData?.combinedCostPercent ?? 0,
              healthyMarginPercent: financeData?.healthyMarginPercent ?? 0,
            });
          } else {
            setKpis(null);
          }
        } else {
          setFailed(true);
        }
      } catch (err) {
        console.error("Failed to load financial KPIs:", err);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };

    fetchKpis();
  }, [branchId]);

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Calculando KPIs financieros...
      </div>
    );
  }

  if (failed) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="No se pudieron cargar los KPIs financieros"
        description="Error al conectar con el servicio de analítica de ventas. Revisa tu conexión e intenta recargar la página."
      />
    );
  }

  if (!kpis) {
    return (
      <EmptyState
        icon={Wallet}
        title="Sin ventas registradas en el período"
        description="Sube un corte POS o recibe cortes por WhatsApp para visualizar la venta total y el desglose efectivo/tarjeta."
      />
    );
  }

  const cashPct =
    kpis.cashSalesCents + kpis.cardSalesCents > 0
      ? Math.round((kpis.cashSalesCents / (kpis.cashSalesCents + kpis.cardSalesCents)) * 100)
      : 0;

  const renderCostBar = (
    icon: React.ReactNode,
    label: string,
    percent: number,
    status: SemaphoreStatus,
    targetPercent: number
  ) => {
    const colors = STATUS_COLORS[status];
    const displayPct = Math.min(percent, 100); // clamp to 100% for bar width

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium flex items-center gap-1.5">
            {icon}
            {label}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold">{percent}%</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors.badge}`}>
              {colors.label}
            </span>
          </div>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden bg-muted flex">
          <div
            className={`h-full ${colors.bar} transition-all duration-500`}
            style={{ width: `${displayPct}%` }}
          />
          {/* Target marker */}
          <div
            className="h-full w-0.5 bg-foreground/30"
            style={{ marginLeft: `${Math.max(0, targetPercent - displayPct)}%` }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Objetivo: &lt;{targetPercent}%
        </p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription className="text-xs font-medium flex items-center gap-1">
          Resumen Financiero
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/25 text-[9px] text-muted-foreground cursor-help"
            title="Ventas totales, tickets promedio, proporción efectivo/tarjeta, y costos operativos (food cost, labor cost) calculados desde los cortes registrados en el período."
          >
            ?
          </span>
        </CardDescription>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1">
          <span className="text-3xl font-bold text-foreground">{formatMXN(kpis.totalSales)}</span>
          <span className="text-xs text-muted-foreground">
            {kpis.cutsCount} cortes · {kpis.totalTickets?.toLocaleString()} tickets · ticket prom.{" "}
            <span className="font-medium text-foreground">{formatMXN(kpis.avgTicketCents)}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Food Cost & Labor Cost — primary operational KPIs */}
        <div className="space-y-3 pt-2 border-t">
          {renderCostBar(
            <Utensils className="w-3.5 h-3.5" />,
            "Food Cost",
            kpis.foodCostPercent,
            kpis.foodCostStatus,
            30
          )}
          {renderCostBar(
            <Users className="w-3.5 h-3.5" />,
            "Labor Cost",
            kpis.laborCostPercent,
            kpis.laborCostStatus,
            28
          )}
        </div>

        {/* Healthy margin summary */}
        <div className="flex items-center justify-between pt-3 border-t">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            Margen Saludable
          </div>
          <span className={`text-sm font-bold ${kpis.healthyMarginPercent >= 45 ? "text-emerald-600" : kpis.healthyMarginPercent >= 35 ? "text-amber-600" : "text-red-600"}`}>
            {kpis.healthyMarginPercent}%
          </span>
        </div>

        {/* Efectivo vs Tarjeta — single proportion bar */}
        <div className="pt-3 border-t">
          <div className="flex items-center justify-between text-xs font-medium mb-1.5">
            <span>Efectivo vs Tarjeta</span>
            <span className="text-muted-foreground">
              {cashPct}% / {100 - cashPct}%
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full overflow-hidden bg-muted flex">
            <div className="h-full bg-chart-1" style={{ width: `${cashPct}%` }} />
            <div className="h-full bg-chart-4" style={{ width: `${100 - cashPct}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
            <span>Efectivo: {formatMXN(kpis.cashSalesCents)}</span>
            <span>Tarjeta: {formatMXN(kpis.cardSalesCents)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


