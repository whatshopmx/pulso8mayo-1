"use client";

import { MetricCard, MetricGrid, MetricCardSkeleton } from "@/components/ui/metric-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, DollarSign, ShieldCheck, TrendingDown, Info, ChevronRight, CalendarX } from "lucide-react";
import { ErrorState } from "@/components/shared/error-state";

interface BranchContribution {
  branchId: string;
  branchName: string;
  value: number;
}

interface DashboardKpisProps {
  data?: {
    totalProducts: number;
    activeAlertsCount: number;
    totalStockValue: number;
    branchesWithStock: number;
    threeWayMatchRate?: number | null;
    wasteLossRatio?: number | null;
    /** AD-2: solo viaja en modo "Todas". Top 3 sucursales por KPI principal. */
    attribution?: {
      stockValueByBranch: BranchContribution[];
      alertsByBranch: BranchContribution[];
      wasteLossByBranch: BranchContribution[];
    } | null;
    /** Task 2 plan loteprod-gaps (§5.4): lotes vencidos con stock sin merma registrada. */
    expiredWastePendingCount?: number;
  } | null;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Scope suffix for subtitles, e.g. "todas las sucursales" or a branch name. */
  scopeLabel?: string;
}

const formatMXN = (cents: number) =>
  `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;

/** AD-2: en modo "Todas", atribuye el KPI a sus top sucursales contribuyentes.
 *  Informativo (la tarjeta puede ser un Link): el cambio de scope vive en el header
 *  y en QuickAlerts, donde el chip sí es clicable. */
function Contributors({ rows, format }: { rows: BranchContribution[]; format?: (v: number) => string }) {
  if (!rows || rows.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {rows.map((r, i) => (
        <span key={r.branchId}>
          {i > 0 && " · "}
          <span className="font-medium text-foreground/80">{r.branchName}</span>
          {" "}
          {format ? format(r.value) : r.value}
        </span>
      ))}
    </p>
  );
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
  const expiredPending = data.expiredWastePendingCount ?? 0;
  const attribution = data.attribution;

  return (
    <MetricGrid columns={4}>
      {/* 1. Valor total de inventario */}
      <MetricCard
        label="Valor del Inventario"
        value={`$${(stockValue / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        icon={<DollarSign className="h-4 w-4" />}
        subtitle={scopeLabel ? `Valor · ${scopeLabel}` : undefined}
      >
        {attribution && (
          <Contributors rows={attribution.stockValueByBranch} format={formatMXN} />
        )}
      </MetricCard>

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
        {attribution && (
          <Contributors rows={attribution.alertsByBranch} />
        )}
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
      >
        {attribution && (
          <Contributors rows={attribution.wasteLossByBranch} format={formatMXN} />
        )}
      </MetricCard>

      {/* 5. Merma obligatoria pendiente (§5.4): solo cuando existe — es una
          deuda operativa concreta, no un KPI de tendencia. Lotes vencidos que
          el cron ya bloqueó (EXPIRED) y siguen con stock sin tirar. */}
      {expiredPending > 0 && (
        <MetricCard
          href="/dashboard/inventory/expirations"
          label="Merma Obligatoria Pendiente"
          value={
            <span className="inline-flex items-center gap-2">
              {expiredPending}
              <span
                className="inline-flex h-2 w-2 rounded-full bg-destructive"
                role="img"
                aria-label="Lotes vencidos sin registrar merma"
              />
            </span>
          }
          icon={<CalendarX className="h-4 w-4" />}
          tone="warning"
          subtitle={
            <span className="inline-flex items-center gap-1">
              Lotes vencidos sin merma registrada{scopeLabel ? ` · ${scopeLabel}` : ""}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="Qué es la merma obligatoria" className="cursor-help">
                      <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px]">
                    Lotes que caducaron y siguen en inventario. Registra su merma para conciliar el stock.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          }
        >
          <div className="flex items-center gap-1 text-xs font-medium text-primary">
            Registrar merma
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </MetricCard>
      )}
    </MetricGrid>
  );
}