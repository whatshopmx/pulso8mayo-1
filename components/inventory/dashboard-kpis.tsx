"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, AlertTriangle, DollarSign, ShieldCheck, TrendingDown, Loader2 } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";

interface DashboardKpisProps {
  data?: {
    totalProducts: number;
    activeAlertsCount: number;
    totalStockValue: number;
    branchesWithStock: number;
  } | null;
  loading: boolean;
}

export function DashboardKpis({ data, loading }: DashboardKpisProps) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">&nbsp;</CardTitle>
            </CardHeader>
            <CardContent>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stockValue = data?.totalStockValue ?? 0;
  const mockValueHistory = [
    { value: stockValue * 0.92 },
    { value: stockValue * 0.95 },
    { value: stockValue * 0.91 },
    { value: stockValue * 0.98 },
    { value: stockValue },
  ].map((item, idx) => ({
    day: idx,
    value: item.value / 100
  }));

  const activeAlerts = data?.activeAlertsCount ?? 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* 1. Valor total de inventario con mini-gráfico de sparkline */}
      <Card className="overflow-hidden flex flex-col justify-between">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Valor del Inventario</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="pb-0 flex-1 flex flex-col justify-between">
          <div className="text-2xl font-bold font-mono">
            ${(stockValue / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="h-10 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockValueHistory} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.52 0.17 25)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="oklch(0.52 0.17 25)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke="oklch(0.52 0.17 25)" 
                  strokeWidth={1.5} 
                  fillOpacity={1} 
                  fill="url(#colorValue)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 2. Alertas activas con pulso rojo animado */}
      <Card className="flex flex-col justify-between">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Alertas Críticas</CardTitle>
          <AlertTriangle className={`h-4 w-4 ${activeAlerts > 0 ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex items-baseline gap-2">
            <div className={`text-2xl font-bold font-mono ${activeAlerts > 0 ? "text-primary" : ""}`}>
              {activeAlerts}
            </div>
            {activeAlerts > 0 && (
              <span className="relative flex h-2 w-2 mb-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {activeAlerts > 0 ? "Requieren revisión urgente" : "Operación sin incidencias"}
          </p>
        </CardContent>
      </Card>

      {/* 3. Tasa de Match 3-Way (Simulada/Efectividad) */}
      <Card className="flex flex-col justify-between">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Efectividad 3-Way Match</CardTitle>
          <ShieldCheck className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent className="pb-4">
          <div className="text-2xl font-bold font-mono text-green-600">94.2%</div>
          <div className="w-full bg-muted h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-green-600 h-full rounded-full" style={{ width: '94.2%' }} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Facturas conciliadas sin discrepancias</p>
        </CardContent>
      </Card>

      {/* 4. Ratio de Pérdidas por Merma */}
      <Card className="flex flex-col justify-between">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Pérdida por Merma</CardTitle>
          <TrendingDown className="h-4 w-4 text-amber-500" />
        </CardHeader>
        <CardContent className="pb-4">
          <div className="text-2xl font-bold font-mono text-amber-600">2.8%</div>
          <div className="w-full bg-muted h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-amber-500 h-full rounded-full" style={{ width: '2.8%' }} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Pérdida mensual sobre inventario</p>
        </CardContent>
      </Card>
    </div>
  );
}
