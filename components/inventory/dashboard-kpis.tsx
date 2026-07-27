"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, DollarSign, ShieldCheck, TrendingDown, Info } from "lucide-react";
import { KpiCardsSkeleton } from "@/components/shared/skeletons";
import Link from "next/link";

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
}

export function DashboardKpis({ data, loading }: DashboardKpisProps) {
  if (loading) {
    return <KpiCardsSkeleton />;
  }

  const stockValue = data?.totalStockValue ?? 0;
  const activeAlerts = data?.activeAlertsCount ?? 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* 1. Valor total de inventario */}
      <Card className="flex flex-col justify-between">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Valor del Inventario</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="pb-4">
          <div className="text-2xl font-bold font-mono">
            ${(stockValue / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </CardContent>
      </Card>

      {/* 2. Alertas activas — clickeable hacia la bandeja de alertas */}
      <Link href="/dashboard/inventory/alerts" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
        <Card className="flex flex-col justify-between h-full transition-colors hover:border-primary cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Alertas Críticas</CardTitle>
            <AlertTriangle className={`h-4 w-4 transition-colors duration-300 ${activeAlerts > 0 ? "text-primary" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-baseline gap-2">
              <div className={`text-2xl font-bold font-mono ${activeAlerts > 0 ? "text-primary" : ""}`}>
                {activeAlerts}
              </div>
              {activeAlerts > 0 && (
                <span className="inline-flex rounded-full h-2 w-2 bg-red-500 mb-1"></span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {activeAlerts > 0 ? "Requieren revisión urgente — toca para atender" : "Operación sin incidencias"}
            </p>
          </CardContent>
        </Card>
      </Link>

      {/* 3. Tasa de Match 3-Way */}
      <Card className="flex flex-col justify-between">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            Facturas Conciliadas
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px]">
                  Porcentaje de facturas cuyo importe y productos coinciden con la orden de compra y lo que llegó a almacén.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <ShieldCheck className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent className="pb-4">
          {data?.threeWayMatchRate !== null && data?.threeWayMatchRate !== undefined ? (
            <>
              <div className="text-2xl font-bold font-mono text-green-600">{data.threeWayMatchRate}%</div>
              <div className="w-full bg-muted h-1.5 rounded-full mt-3 overflow-hidden">
                <div className="bg-green-600 h-full rounded-full" style={{ width: `${data.threeWayMatchRate}%` }} />
              </div>
            </>
          ) : (
            <div className="h-[52px] flex items-center">
              <span className="text-sm text-muted-foreground">—</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">Facturas conciliadas sin discrepancias</p>
        </CardContent>
      </Card>

      {/* 4. Ratio de Pérdidas por Merma */}
      <Card className="flex flex-col justify-between">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
            Pérdida por Merma
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px]">
                  Porcentaje del valor del inventario que se perdió este mes por caducidad, daño o derrame.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <TrendingDown className="h-4 w-4 text-amber-500" />
        </CardHeader>
        <CardContent className="pb-4">
          {data?.wasteLossRatio !== null && data?.wasteLossRatio !== undefined ? (
            <>
              <div className="text-2xl font-bold font-mono text-amber-600">{data.wasteLossRatio}%</div>
              <div className="w-full bg-muted h-1.5 rounded-full mt-3 overflow-hidden">
                <div className="bg-amber-500 h-full rounded-full" style={{ width: `${Math.min(data.wasteLossRatio, 100)}%` }} />
              </div>
            </>
          ) : (
            <div className="h-[52px] flex items-center">
              <span className="text-sm text-muted-foreground">—</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">Pérdida mensual sobre inventario</p>
        </CardContent>
      </Card>
    </div>
  );
}
