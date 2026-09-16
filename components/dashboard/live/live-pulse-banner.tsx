import React from "react";
import Link from "next/link";
import { LivePulseSummary } from "@/lib/services/live-command-service";
import { 
  Store, 
  Users, 
  DollarSign, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ChevronRight,
  ShieldAlert
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface LivePulseBannerProps {
  summary: LivePulseSummary;
}

export function LivePulseBanner({ summary }: LivePulseBannerProps) {
  const formattedSales = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(summary.salesTodayCents / 100);

  const isOpenFull = summary.openRatePercent === 100 && summary.totalBranches > 0;
  const isStaffHealthy = summary.staffAttendanceRate >= 90;

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs transition-all">
      {/* Header contextual del turno */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Pulso en Vivo del Turno
              </h2>
              <Badge variant="outline" className="text-xs font-mono font-medium">
                Fecha Operativa: {summary.businessDate}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Monitoreo activo para {summary.totalBranches} sucursales de la cadena
            </p>
          </div>
        </div>

        {summary.criticalAlertsCount > 0 ? (
          <Link
            href="/dashboard/exceptions"
            className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 transition-colors"
          >
            <ShieldAlert className="h-4 w-4 animate-bounce" />
            <span>{summary.criticalAlertsCount} riesgo{summary.criticalAlertsCount > 1 ? "s" : ""} en rush requiere{summary.criticalAlertsCount > 1 ? "n" : ""} atención</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Servicio Estable sin Alertas Críticas</span>
          </div>
        )}
      </div>

      {/* Grid de 4 Pilares del Pulso */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Pilar 1: Aperturas */}
        <div className="flex items-center gap-3.5 rounded-lg border border-border/70 bg-background/50 p-3">
          <div className={`p-2.5 rounded-lg ${isOpenFull ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
            <Store className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Aperturas a Tiempo</span>
              <span className={`text-[11px] font-semibold ${isOpenFull ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {summary.openRatePercent}%
              </span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold tracking-tight text-foreground">
                {summary.openBranchesCount}
              </span>
              <span className="text-xs text-muted-foreground">/ {summary.totalBranches} tiendas</span>
            </div>
          </div>
        </div>

        {/* Pilar 2: Personal en Turno */}
        <div className="flex items-center gap-3.5 rounded-lg border border-border/70 bg-background/50 p-3">
          <div className={`p-2.5 rounded-lg ${isStaffHealthy ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Personal en Piso</span>
              <span className={`text-[11px] font-semibold ${isStaffHealthy ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {summary.staffAttendanceRate}% cubierto
              </span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold tracking-tight text-foreground">
                {summary.staffActiveNow}
              </span>
              <span className="text-xs text-muted-foreground">colaboradores activos</span>
            </div>
          </div>
        </div>

        {/* Pilar 3: Ventas POS del Día */}
        <div className="flex items-center gap-3.5 rounded-lg border border-border/70 bg-background/50 p-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <DollarSign className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Venta Acumulada Hoy</span>
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                POS
              </span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold tracking-tight text-foreground">
                {formattedSales}
              </span>
            </div>
          </div>
        </div>

        {/* Pilar 4: Alertas de Turno / Riesgos */}
        <div className="flex items-center gap-3.5 rounded-lg border border-border/70 bg-background/50 p-3">
          <div className={`p-2.5 rounded-lg ${summary.criticalAlertsCount > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
            {summary.criticalAlertsCount > 0 ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Riesgos Operativos</span>
              <span className="text-[11px] font-semibold text-muted-foreground">
                M17 / NOM-251
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className={`text-lg font-bold tracking-tight ${summary.criticalAlertsCount > 0 ? 'text-destructive' : 'text-foreground'}`}>
                {summary.criticalAlertsCount}
              </span>
              <Link 
                href="/dashboard/exceptions" 
                className="text-xs text-primary hover:underline flex items-center font-medium"
              >
                Ver mesa <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
