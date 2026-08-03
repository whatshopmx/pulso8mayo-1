"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Receipt, ShoppingBag, TrendingUp, CreditCard, Wallet, Store, Loader2 } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface SalesDashboardProps {
  branches: Array<{ id: string; name: string }>;
}

export function SalesDashboard({ branches }: SalesDashboardProps) {
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const url = new URL("/api/sales/analytics", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }

      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.data);
      }
    } catch (err) {
      console.error("Failed to load sales analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [selectedBranch]);

  const summary = data?.summary;
  const trend = data?.trend || [];
  const channelBreakdown = data?.channelBreakdown || [];

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  const formattedTrend = trend.map((pt: any) => ({
    date: pt.date,
    Venta: (pt.totalSalesCents / 100).toFixed(2),
    Tickets: pt.ticketCount,
  }));

  return (
    <div className="space-y-6">
      {/* Header & Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Métricas de Ventas y Tendencia</h2>
          <p className="text-xs text-muted-foreground">
            Resumen consolidado de ingresos, ticket promedio y comportamiento por canal.
          </p>
        </div>

        <div className="w-full sm:w-64">
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger>
              <SelectValue placeholder="Todas las sucursales" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas las sucursales</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando analítica de ventas...
        </div>
      ) : summary ? (
        <>
          {/* KPI Hero Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Venta Total</CardTitle>
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatMXN(summary.totalSalesCents)}</div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  De {summary.cutsCount} cortes registrados
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Ticket Promedio</CardTitle>
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatMXN(summary.avgTicketCents)}</div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Total de {summary.totalTickets.toLocaleString()} cuentas
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Efectivo vs Tarjeta</CardTitle>
                <Wallet className="w-4 h-4 text-purple-600" />
              </CardHeader>
              <CardContent>
                <div className="text-sm font-semibold flex items-center justify-between">
                  <span>Efectivo:</span>
                  <span className="font-bold">{formatMXN(summary.cashSalesCents)}</span>
                </div>
                <div className="text-sm font-semibold flex items-center justify-between mt-1">
                  <span>Tarjeta:</span>
                  <span className="font-bold">{formatMXN(summary.cardSalesCents)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Canal Principal</CardTitle>
                <Store className="w-4 h-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                {channelBreakdown.length > 0 ? (
                  <div>
                    <div className="text-lg font-bold">
                      {channelBreakdown[0].channel} ({channelBreakdown[0].percentage}%)
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {formatMXN(channelBreakdown[0].totalSalesCents)}
                    </p>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Sin desglose</span>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sales Trend (Area Chart) */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base font-bold">Tendencia de Ventas Diarias</CardTitle>
                <CardDescription className="text-xs">
                  Comportamiento del ingreso acumulado por fecha de operación.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {formattedTrend.length > 0 ? (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={formattedTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                        <XAxis dataKey="date" tickLine={false} style={{ fontSize: "11px" }} />
                        <YAxis tickLine={false} style={{ fontSize: "11px" }} />
                        <Tooltip
                          formatter={(value: any) => [`$${Number(value).toLocaleString("es-MX")}`, "Venta"]}
                          labelStyle={{ fontWeight: "bold" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="Venta"
                          stroke="#10b981"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#salesGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-foreground">
                    Sin suficientes datos de ventas para mostrar la tendencia.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Channels Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-bold">Desglose por Canal</CardTitle>
                <CardDescription className="text-xs">
                  Participación de Salón, Delivery y Eventos.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {channelBreakdown.length > 0 ? (
                  channelBreakdown.map((item: any) => (
                    <div key={item.channel} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span>{item.channel}</span>
                        <span>{formatMXN(item.totalSalesCents)} ({item.percentage}%)</span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(item.percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    Sin cortes cargados en el período.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
