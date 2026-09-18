import React from "react";
import Link from "next/link";
import { LivePulseSummary } from "@/lib/services/live-command-service";
import { 
  Store, 
  Users, 
  DollarSign, 
  AlertTriangle, 
  CheckCircle2, 
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
  const hasStaffRate = summary.staffAttendanceRate !== null;
  const isStaffHealthy = hasStaffRate && summary.staffAttendanceRate! >= 90;
  const staffTileTone = !hasStaffRate
    ? "bg-muted text-muted-foreground"
    : isStaffHealthy
    ? "bg-info/10 text-info"
    : "bg-warning/10 text-warning-text";
  const staffTextTone = !hasStaffRate
    ? "text-muted-foreground"
    : isStaffHealthy
    ? "text-info"
    : "text-warning-text";

  // El banner escala sobre la unión de señales, no sobre un solo contador.
  // Antes el verde dependía solo de `criticalAlertsCount`; aperturas y
  // dotación se calculaban pero solo teñían tiles, nunca escalaban el banner.
  const openingIssues = summary.branches.filter((b) => b.opening.status !== "ON_TIME").length;
  const staffIssues = summary.branches.filter(
    (b) => b.staff.status !== "NORMAL" && b.staff.status !== "UNKNOWN",
  ).length;
  const coldIssues = summary.branches.filter((b) => b.nom251.status !== "OK").length;
  const alertIssues = summary.branches.filter((b) => b.activeAlerts.length > 0).length;
  const branchesWithIssues = summary.branches.filter(
    (b) =>
      b.opening.status !== "ON_TIME" ||
      (b.staff.status !== "NORMAL" && b.staff.status !== "UNKNOWN") ||
      b.nom251.status !== "OK" ||
      b.activeAlerts.length > 0,
  ).length;

  const staffOk = !hasStaffRate || summary.staffAttendanceRate! >= 90;
  const severity: "critical" | "attention" | "stable" =
    summary.criticalAlertsCount > 0
      ? "critical"
      : branchesWithIssues > 0 || !staffOk
      ? "attention"
      : "stable";

  // Motivo dominante: decir el hecho ("3 de 3 sin apertura a tiempo"), no el
  // adjetivo ("Servicio Estable").
  const dominantIssue = [
    { count: openingIssues, label: "sin apertura a tiempo" },
    { count: staffIssues, label: "con dotación incompleta" },
    { count: coldIssues, label: "sin frío NOM-251 registrado" },
    { count: alertIssues, label: "con alertas activas" },
  ].reduce((a, b) => (b.count > a.count ? b : a));

  const dotTone =
    severity === "critical"
      ? "bg-destructive"
      : severity === "attention"
      ? "bg-warning"
      : "bg-success";

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 transition-colors">
      {/* Header contextual del turno */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-3 w-3">
            {severity === "stable" && (
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dotTone} opacity-75`}
              ></span>
            )}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${dotTone}`}></span>
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

        {severity === "critical" ? (
          <Link
            href="/dashboard/exceptions"
            className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 transition-colors"
          >
            <ShieldAlert className="h-4 w-4 animate-pulse" />
            <span>{summary.criticalAlertsCount} riesgo{summary.criticalAlertsCount > 1 ? "s" : ""} en rush requiere{summary.criticalAlertsCount > 1 ? "n" : ""} atención</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : severity === "attention" ? (
          <div className="inline-flex items-center gap-1.5 text-xs text-warning-text font-medium px-2.5 py-1 rounded-full bg-warning/10 border border-warning/20">
            <AlertTriangle className="h-3.5 w-3.5 text-warning-text" />
            <span>
              {dominantIssue.count} de {summary.totalBranches} sucursales {dominantIssue.label}
            </span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-xs text-success-text font-medium px-2.5 py-1 rounded-full bg-success/10 border border-success/20">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            <span>Todas las sucursales abrieron a tiempo con frío NOM-251 registrado</span>
          </div>
        )}
      </div>

      {/* Grid de 4 Pilares del Pulso */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Pilar 1: Aperturas */}
        <div className="flex items-center gap-3.5 rounded-lg border border-border/70 bg-background/50 p-3">
          <div className={`p-2.5 rounded-lg ${isOpenFull ? 'bg-success/10 text-success-text' : 'bg-warning/10 text-warning-text'}`}>
            <Store className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Aperturas a Tiempo</span>
              <span className={`text-xs font-semibold ${isOpenFull ? 'text-success-text' : 'text-warning-text'}`}>
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
          <div className={`p-2.5 rounded-lg ${staffTileTone}`}>
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Personal en Piso</span>
              <span className={`text-xs font-semibold ${staffTextTone}`}>
                {hasStaffRate ? `${summary.staffAttendanceRate}% cubierto` : "Sin dotación"}
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
          <div className="p-2.5 rounded-lg bg-success/10 text-success-text">
            <DollarSign className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Venta Acumulada Hoy</span>
              <span className="text-xs font-semibold text-success-text">
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
              <span className="text-xs font-semibold text-muted-foreground">
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
