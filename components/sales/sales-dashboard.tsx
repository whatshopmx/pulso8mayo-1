"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { BarChart3, AlertCircle, Loader2 } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface SalesDashboardProps {
  /** Controlled branch filter — owned by the parent page so KPIs and charts share one selector. */
  branchId: string;
}

export function SalesDashboard({ branchId }: SalesDashboardProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchAnalytics = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const url = new URL("/api/sales/analytics", window.location.origin);
      if (branchId !== "ALL") {
        url.searchParams.set("branchId", branchId);
      }

      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.data);
      } else {
        setFailed(true);
      }
    } catch (err) {
      console.error("Failed to load sales analytics:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const trend = data?.trend || [];
  const channelBreakdown = data?.channelBreakdown || [];

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  const formattedTrend = trend.map((pt: any) => ({
    date: pt.date,
    Venta: (pt.totalSalesCents / 100).toFixed(2),
    Tickets: pt.ticketCount,
  }));

  if (loading) {
    return (
      <div className="py-12 flex justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando analítica de ventas...
      </div>
    );
  }

  if (failed) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="No se pudo cargar la analítica de ventas"
        description="Error al conectar con el servicio. Revisa tu conexión e intenta recargar la página."
      />
    );
  }

  if (!data?.summary) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Sin datos suficientes para graficar"
        description="Registra cortes de ventas para visualizar la tendencia diaria y el desglose por canal."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Tendencia y Desglose por Canal</h2>
        <p className="text-xs text-muted-foreground">
          Comportamiento del ingreso acumulado y participación de Salón, Delivery y Eventos.
        </p>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Trend (Area Chart) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-1.5">
              Tendencia de Ventas Diarias
              <span
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/25 text-[9px] text-muted-foreground cursor-help"
                title="Evolución de la venta total diaria (todas las sucursales y canales) en el período seleccionado. Útil para detectar días atípicos o caídas en la operación."
              >
                ?
              </span>
            </CardTitle>
            <CardDescription className="text-xs">
              Comportamiento del ingreso acumulado por fecha de operación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {formattedTrend.length > 0 ? (
              <>
                <div
                  className="h-64 w-full"
                  role="img"
                  aria-label="Tendencia de ventas diarias del período seleccionado"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={formattedTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                      <XAxis dataKey="date" tickLine={false} style={{ fontSize: "12px" }} />
                      <YAxis tickLine={false} style={{ fontSize: "12px" }} />
                      <Tooltip
                        formatter={(value: any) => [`$${Number(value).toLocaleString("es-MX")}`, "Venta"]}
                        labelStyle={{ fontWeight: "bold" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="Venta"
                        stroke="var(--chart-3)"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#salesGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <table className="sr-only">
                  <caption>Tendencia de ventas diarias</caption>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Venta (MXN)</th>
                      <th>Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formattedTrend.map((d: any) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td>${d.Venta}</td>
                        <td>{d.Tickets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
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
            <CardTitle className="text-base font-bold flex items-center gap-1.5">
              Desglose por Canal
              <span
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/25 text-[9px] text-muted-foreground cursor-help"
                title="Distribución porcentual de la venta total entre Salón, Delivery y Eventos. Ayuda a entender qué canal genera más ingreso en el período."
              >
                ?
              </span>
            </CardTitle>
            <CardDescription className="text-xs">
              Participación de Salón, Delivery y Eventos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {channelBreakdown.length > 0 ? (
              <>
                <div
                  className="space-y-3"
                  role="img"
                  aria-label="Desglose de ventas por canal"
                >
                  {channelBreakdown.map((item: any) => (
                    <div key={item.channel} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span>{item.channel}</span>
                        <span>
                          {formatMXN(item.totalSalesCents)} ({item.percentage}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(item.percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <table className="sr-only">
                  <caption>Desglose de ventas por canal</caption>
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th>Venta (MXN)</th>
                      <th>Porcentaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channelBreakdown.map((item: any) => (
                      <tr key={item.channel}>
                        <td>{item.channel}</td>
                        <td>${(item.totalSalesCents / 100).toFixed(2)}</td>
                        <td>{item.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Sin cortes cargados en el período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
