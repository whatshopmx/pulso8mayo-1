"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  DollarSign,
  ArrowDownRight,
  ArrowRight,
  ShieldCheck,
  Building,
} from "lucide-react";
import { PnlAuditDrawer } from "./pnl-audit-drawer";
import { cn } from "@/lib/utils";

interface PnlWaterfallProps {
  salesTotalCents: number;
  foodCostPercent: number;
  laborCostPercent: number;
  storeOpexPercent?: number;
}

function fmtMxn(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;
}

export function PnlExecutiveWaterfall({
  salesTotalCents,
  foodCostPercent,
  laborCostPercent,
  storeOpexPercent = 18.0,
}: PnlWaterfallProps) {
  // If no sales recorded, default to a sensible scale
  const safeSales = salesTotalCents > 0 ? salesTotalCents : 100000000; // $1M MXN demo base

  const foodCostCents = Math.round((foodCostPercent / 100) * safeSales);
  const grossMarginPercent = 100 - foodCostPercent;
  const grossMarginCents = safeSales - foodCostCents;

  const laborCostCents = Math.round((laborCostPercent / 100) * safeSales);
  const primeCostPercent = foodCostPercent + laborCostPercent;
  const primeMarginPercent = 100 - primeCostPercent;
  const primeMarginCents = Math.round((primeMarginPercent / 100) * safeSales);

  const storeOpexCents = Math.round((storeOpexPercent / 100) * safeSales);
  const ebitdaPercent = primeMarginPercent - storeOpexPercent;
  const ebitdaCents = Math.round((ebitdaPercent / 100) * safeSales);

  const isEbitdaPositive = ebitdaPercent > 0;

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Cascada de Rentabilidad & EBITDA de Red
            </CardTitle>
            <CardDescription>
              Estructura consolidada de ingresos, prime margin y rendimiento operativo
            </CardDescription>
          </div>
          <PnlAuditDrawer buttonText="Ver P&L por Sucursal" />
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 space-y-4">
        {/* Waterfall Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Step 1: Venta Neta */}
          <div className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              1. Ingresos Netos
            </span>
            <div className="text-xl font-bold text-foreground">
              {fmtMxn(safeSales)}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Base de cálculo (100%)
            </p>
          </div>

          {/* Step 2: Costo de Alimentos */}
          <div className="p-3.5 rounded-lg bg-sky-500/5 border border-sky-500/20 space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-sky-700 dark:text-sky-400 uppercase tracking-wide">
                2. Insumos (COGS)
              </span>
              <span className="text-xs font-bold text-sky-600">
                -{foodCostPercent.toFixed(1)}%
              </span>
            </div>
            <div className="text-xl font-bold text-foreground">
              -{fmtMxn(foodCostCents)}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Margen Bruto: {grossMarginPercent.toFixed(1)}%
            </p>
          </div>

          {/* Step 3: Mano de Obra */}
          <div className="p-3.5 rounded-lg bg-indigo-500/5 border border-indigo-500/20 space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">
                3. Mano de Obra
              </span>
              <span className="text-xs font-bold text-indigo-600">
                -{laborCostPercent.toFixed(1)}%
              </span>
            </div>
            <div className="text-xl font-bold text-foreground">
              -{fmtMxn(laborCostCents)}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Prime Margin: {primeMarginPercent.toFixed(1)}%
            </p>
          </div>

          {/* Step 4: EBITDA Operativo */}
          <div className={cn(
            "p-3.5 rounded-lg border space-y-1",
            isEbitdaPositive
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-destructive/10 border-destructive/30"
          )}>
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                4. EBITDA Operativo
              </span>
              <span className={cn(
                "text-xs font-bold px-1.5 py-0.2 rounded",
                isEbitdaPositive ? "bg-emerald-500 text-white" : "bg-destructive text-white"
              )}>
                {ebitdaPercent.toFixed(1)}%
              </span>
            </div>
            <div className={cn(
              "text-xl font-bold",
              isEbitdaPositive ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
            )}>
              {fmtMxn(ebitdaCents)}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tras rentas y servicios de tienda (~{storeOpexPercent}%)
            </p>
          </div>
        </div>

        {/* Quick summary note */}
        <div className="p-3 rounded-md bg-muted/20 border border-border/60 text-xs text-muted-foreground flex items-center justify-between">
          <span>
            💡 <strong>Estrategia de Rentabilidad:</strong> Cada punto porcentual reducido en Prime Cost suma directamente al EBITDA consolidado de la marca.
          </span>
          <PnlAuditDrawer buttonText="Auditar por Tienda" className="h-7 text-xs" />
        </div>
      </CardContent>
    </Card>
  );
}
