"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Printer, TrendingUp, Percent, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExecutiveViewMode = "cockpit" | "economics" | "liquidity";

/** Signos vitales consolidados que alimentan la cabecera y las pestañas. */
export interface VitalSignsData {
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
}

/** Umbrales compartidos por las tarjetas de signos vitales y las pestañas. */
const PRIME_COST_TARGET = 60;
const PRIME_COST_WARNING = 65;
const LIQUIDITY_RISK_LIMIT = 35;

function fmtMxnCompact(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1e8) return `$${(cents / 1e8).toFixed(2)}M`;
  if (abs >= 1e5) return `$${(cents / 1e5).toFixed(1)}K`;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

/**
 * Cabecera y barra de pestañas de la cabina ejecutiva.
 *
 * Debe renderizarse dentro de `<ExecutiveCockpitTabs>`: las pestañas son
 * `TabsTrigger` de Radix y consumen el estado de `<Tabs>` (cambio en cliente,
 * cero latencia). No depende de `useSearchParams`, así que no obliga a
 * suspender el árbol ni dispara navegaciones RSC al alternar de vista.
 */
export function ExecutiveCockpitHeader({ companyName, data }: ExecutiveCockpitHeaderProps) {
  const isPrimeCostHealthy = data.primeCostPercent <= PRIME_COST_TARGET;
  const isPrimeCostWarning =
    data.primeCostPercent > PRIME_COST_TARGET && data.primeCostPercent <= PRIME_COST_WARNING;

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
        <div className="flex items-center gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
            data-testid="executive-export-button"
            onClick={() => window.print()}
          >
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Exportar (PDF)
          </Button>
        </div>
      </div>

      {/* Vital Signs Bar (4 Key Metrics) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Salud del Grupo */}
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
              <span>Salud de Red (Twin)</span>
              <Activity className={cn("h-4 w-4", data.healthScore >= 80 ? "text-success" : "text-warning")} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {data.healthScore}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </span>
              <span className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                data.driftScore <= 15 ? "bg-success/10 text-success-text" : "bg-warning/10 text-warning-text"
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
                data.salesTargetPercent >= 95 ? "bg-success/10 text-success-text" : "bg-warning/10 text-warning-text"
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
                isPrimeCostHealthy ? "text-success" : isPrimeCostWarning ? "text-warning" : "text-destructive"
              )} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={cn(
                "text-2xl font-bold tracking-tight",
                isPrimeCostHealthy ? "text-foreground" : isPrimeCostWarning ? "text-warning-text" : "text-destructive"
              )}>
                {data.primeCostPercent.toFixed(1)}%
              </span>
              <span className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                isPrimeCostHealthy ? "bg-success/10 text-success-text" : "bg-destructive/10 text-destructive"
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
              <Wallet
                className={cn(
                  "h-4 w-4",
                  data.liquidityRisk <= LIQUIDITY_RISK_LIMIT ? "text-success" : "text-warning"
                )}
              />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {fmtMxnCompact(data.freeCash14dCents)}
              </span>
              <span className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded",
                data.liquidityRisk <= LIQUIDITY_RISK_LIMIT ? "bg-success/10 text-success-text" : "bg-warning/10 text-warning-text"
              )}>
                {data.liquidityRisk <= LIQUIDITY_RISK_LIMIT ? "Holgado" : "Alerta de Flujo"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              Descontando nómina e IMSS confirmados
            </p>
          </CardContent>
        </Card>
      </div>

      {/*
        Modos de decisión — pestañas en cliente.
        El indicador activo es un subrayado de Operational Red (2px) más un tinte
        tonal en el badge: se elimina el bloque rojo sólido que saturaba la
        cabecera y se respeta el límite del 10-15% de la regla One Voice.
      */}
      <TabsList
        variant="line"
        className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 print:hidden"
      >
        <TabsTrigger
          value="cockpit"
          data-testid="executive-tab-cockpit"
          className="h-9 flex-none gap-2 px-3 text-sm text-muted-foreground group-data-[orientation=horizontal]/tabs:after:bottom-0 after:bg-primary data-[state=active]:text-foreground"
        >
          <span>1. Despacho & Decisiones</span>
          {data.pendingDecisionsCount > 0 && (
            <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums text-destructive">
              {data.pendingDecisionsCount}
            </span>
          )}
        </TabsTrigger>

        <TabsTrigger
          value="economics"
          data-testid="executive-tab-economics"
          className="h-9 flex-none gap-2 px-3 text-sm text-muted-foreground group-data-[orientation=horizontal]/tabs:after:bottom-0 after:bg-primary data-[state=active]:text-foreground"
        >
          <span>2. Unit Economics & Prime Cost</span>
          {!isPrimeCostHealthy && (
            <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums text-warning-text">
              {data.primeCostPercent.toFixed(1)}%
            </span>
          )}
        </TabsTrigger>

        <TabsTrigger
          value="liquidity"
          data-testid="executive-tab-liquidity"
          className="h-9 flex-none gap-2 px-3 text-sm text-muted-foreground group-data-[orientation=horizontal]/tabs:after:bottom-0 after:bg-primary data-[state=active]:text-foreground"
        >
          <span>3. Oxígeno & Flujo 14D</span>
          {data.liquidityRisk > LIQUIDITY_RISK_LIMIT && (
            <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums text-destructive">
              {data.liquidityRisk}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
    </div>
  );
}
