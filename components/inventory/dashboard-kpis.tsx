"use client";

import { MetricCard, MetricGrid, MetricCardSkeleton } from "@/components/ui/metric-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, DollarSign, ShieldCheck, TrendingDown, Info, ChevronRight } from "lucide-react";
import { ErrorState } from "@/components/shared/error-state";

interface DashboardKpisProps {
  data?: {
    totalProducts: number;
    activeAlertsCount: number;
    totalStockValue: number;
    branchesWithStock: number;
    threeWayMatchRate?: number | null;
    wasteLossRatio?: number | null;
  } | null;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Scope suffix for subtitles, e.g. "todas las sucursales" or a branch name. */
  scopeLabel?: string;
}

export function DashboardKpis({ data, loading, isError, onRetry, scopeLabel }: DashboardKpisProps) {
  if (isError) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="md:col-span-2 lg:col-span-4">
          <ErrorState
            message="No se pudo cargar el resumen del inventario."
            onRetry={onRetry}
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return <MetricCardSkeleton />;
  }

  // On success, read from a non-null data object only — never fall back to 0
  // from an undefined payload (that would mask a silent fetch failure as
  // a clean bill of health).
  if (!data) {
    return <MetricCardSkeleton />;
  }

  const stockValue = data.totalStockValue;
  const activeAlerts = data.activeAlertsCount;
  const matchRate = data.threeWayMatchRate;
  const wasteLoss = data.wasteLossRatio;

  return (
    <MetricGrid columns={4}>
      {/* 1. Valor total de inventario */}
      <MetricCard
        label="Valor del Inventario"
        value={`$${(stockValue / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        icon={<DollarSign className="h-4 w-4" />}
        subtitle={scopeLabel ? `Valor · ${scopeLabel}` : undefined}
      />

      {/* 2. Alertas activas — clickeable hacia la bandeja de alertas */}
      <MetricCard
        href="/dashboard/inventory/alerts"
        label="Alertas Críticas"
        value={
          activeAlerts > 0 ? (
            <span className="inline-flex items-center gap-2">
              {activeAlerts}
              <span
                className="inline-flex h-2 w-2 rounded-full bg-destructive"
                role="img"
                aria-label="Hay alertas activas"
              />
            </span>
          ) : (
            activeAlerts
          )
        }
        icon={<AlertTriangle className="h-4 w-4" />}
        tone={activeAlerts > 0 ? "primary" : "neutral"}
        subtitle={
          (activeAlerts > 0 ? "Requieren revisión urgente" : "Operación sin incidencias") +
          (scopeLabel ? ` · ${scopeLabel}` : "")
        }
      >
        {/* Persistent affordance: visible without hover (touch/keyboard/SR) */}
        <div className="flex items-center gap-1 text-xs font-medium text-primary">
          Ver detalle
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
      </MetricCard>

      {/* 3. Tasa de Match 3-Way */}
      <MetricCard
        label="Facturas Conciliadas"
        value={matchRate != null ? `${matchRate}%` : "—"}
        icon={<ShieldCheck className="h-4 w-4" />}
        tone={matchRate != null ? "success" : "neutral"}
        progress={matchRate != null ? { value: matchRate } : undefined}
        subtitle={
          <span className="inline-flex items-center gap-1">
            Facturas conciliadas{scopeLabel ? ` · ${scopeLabel}` : ""}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Qué son las facturas conciliadas" className="cursor-help">
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px]">
                  Porcentaje de facturas cuyo importe y productos coinciden con la orden de compra y lo que llegó a almacén.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        }
      />

      {/* 4. Ratio de Pérdidas por Merma */}
      <MetricCard
        label="Pérdida por Merma"
        value={wasteLoss != null ? `${wasteLoss}%` : "—"}
        icon={<TrendingDown className="h-4 w-4" />}
        tone={wasteLoss != null ? "warning" : "neutral"}
        progress={wasteLoss != null ? { value: Math.min(wasteLoss, 100) } : undefined}
        subtitle={
          <span className="inline-flex items-center gap-1">
            Pérdida mensual{scopeLabel ? ` · ${scopeLabel}` : " sobre inventario"}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Qué es la pérdida por merma" className="cursor-help">
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px]">
                  Porcentaje del valor del inventario que se perdió este mes por caducidad, daño o derrame.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        }
      />
    </MetricGrid>
  );
}