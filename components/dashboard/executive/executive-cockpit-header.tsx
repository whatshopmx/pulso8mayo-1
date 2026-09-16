"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  TrendingUp,
  Percent,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Flame,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ExecutiveViewMode = "cockpit" | "economics" | "liquidity";

interface VitalSignsData {
  healthScore: number;
  driftScore: number;
  salesMonthMxn: number;
  salesTargetPercent: number;
  primeCostPercent: number;
  foodCostPercent: number;
  laborCostPercent: number;
  freeCash14dCents: number;
  liquidityRisk: number;
  pendingDecisionsCount: number;
}

interface ExecutiveCockpitHeaderProps {
  companyName: string;
  data: VitalSignsData;
  activeView?: ExecutiveViewMode;
}

function fmtMxnCompact(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1e8) return `$${(cents / 1e8).toFixed(2)}M`;
  if (abs >= 1e5) return `$${(cents / 1e5).toFixed(1)}K`;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

export function ExecutiveCockpitHeader({
  companyName,
  data,
  activeView: forcedView,
}: ExecutiveCockpitHeaderProps) {
  const searchParams = useSearchParams();
  const rawView = searchParams.get("view");
  const currentView: ExecutiveViewMode =
    forcedView ??
    (rawView === "economics" || rawView === "liquidity" ? rawView : "cockpit");

  const isPrimeCostHealthy = data.primeCostPercent <= 60;
  const isPrimeCostWarning = data.primeCostPercent > 60 && data.primeCostPercent <= 65;

  return (
    <div className="space-y-4">
      {/* Page Title & Subtitle */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Dirección & Unit Economics
            <Badge variant="outline" className="text-xs font-normal text-muted-foreground border-border">
              {companyName}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cabina de decisiones estratégicas, margen operativo y liquidez de red
          </p>
        </div>
      </div>

      {/* Vital Signs Bar (4 Key Metrics) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Salud del Grupo */}
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              <span>Salud de Red (Twin)</span>
              <Activity className={cn("h-4 w-4", data.healthScore >= 80 ? "text-emerald-500" : "text-amber-500")} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {data.healthScore}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </span>
              <span className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                data.driftScore <= 15 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              )}>
                {data.driftScore <= 15 ? "Alineado" : `Desv. ${data.driftScore}`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {data.driftScore <= 15 ? "Disciplinas operativas estables" : "Variación entre sucursales detectada"}
            </p>
          </CardContent>
        </Card>

        {/* 2. Venta Acumulada */}
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              <span>Venta Neta del Mes</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {fmtMxnCompact(data.salesMonthMxn * 100)}
              </span>
              <span className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                data.salesTargetPercent >= 95 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              )}>
                {Math.round(data.salesTargetPercent)}% meta
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              Corte consolidado todas las sucursales
            </p>
          </CardContent>
        </Card>

        {/* 3. Prime Cost Consolidado */}
        <Card className={cn(
          "border bg-card shadow-none transition-colors",
          !isPrimeCostHealthy && !isPrimeCostWarning ? "border-destructive/40 bg-destructive/5" : "border-border"
        )}>
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              <span>Prime Cost (Comida + Nómina)</span>
              <Percent className={cn(
                "h-4 w-4",
                isPrimeCostHealthy ? "text-emerald-500" : isPrimeCostWarning ? "text-amber-500" : "text-destructive"
              )} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={cn(
                "text-2xl font-bold tracking-tight",
                isPrimeCostHealthy ? "text-foreground" : isPrimeCostWarning ? "text-amber-600 dark:text-amber-400" : "text-destructive"
              )}>
                {data.primeCostPercent.toFixed(1)}%
              </span>
              <span className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                isPrimeCostHealthy ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive"
              )}>
                {isPrimeCostHealthy ? "Meta ≤ 60%" : "Fuga de Margen"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              Alimentos {data.foodCostPercent.toFixed(1)}% · Nómina {data.laborCostPercent.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        {/* 4. Caja Libre a 14 Días */}
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              <span>Caja Libre Proyectada (14d)</span>
              <Wallet className={cn("h-4 w-4", data.liquidityRisk <= 35 ? "text-emerald-500" : "text-amber-500")} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {fmtMxnCompact(data.freeCash14dCents)}
              </span>
              <span className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                data.liquidityRisk <= 35 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              )}>
                {data.liquidityRisk <= 35 ? "Holgado" : "Alerta de Flujo"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              Descontando nómina e IMSS confirmados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Decision Modes Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-border pb-1">
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Tab 1: Despacho & Decisiones */}
          <Link
            href="/dashboard/executive?view=cockpit"
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
              currentView === "cockpit"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            <span>1. Despacho & Decisiones</span>
            {data.pendingDecisionsCount > 0 && (
              <span
                className={cn(
                  "text-xs px-1.5 py-0.2 rounded-full font-bold",
                  currentView === "cockpit"
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-destructive text-destructive-foreground"
                )}
              >
                {data.pendingDecisionsCount}
              </span>
            )}
          </Link>

          {/* Tab 2: Unit Economics & Prime Cost */}
          <Link
            href="/dashboard/executive?view=economics"
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
              currentView === "economics"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            <span>2. Unit Economics & Prime Cost</span>
            {!isPrimeCostHealthy && (
              <span
                className={cn(
                  "text-xs px-1.5 py-0.2 rounded-full font-bold",
                  currentView === "economics"
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-amber-500 text-white"
                )}
              >
                !
              </span>
            )}
          </Link>

          {/* Tab 3: Oxígeno & Flujo 14D */}
          <Link
            href="/dashboard/executive?view=liquidity"
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors",
              currentView === "liquidity"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            <span>3. Oxígeno & Flujo 14D</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
