"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowUpRight, ArrowDownLeft, Calendar } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface CashFlowDay {
  date: string;
  projectedInflowCents: number;
  projectedOutflowCents: number;
  netFlowCents: number;
  cumulativeBalanceCents: number;
  outflowItemsCount: number;
  hasHighConcentration: boolean;
}

interface CashFlowCalendarProps {
  projection: CashFlowDay[];
}

export function CashFlowCalendar({ projection }: CashFlowCalendarProps) {
  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  const chartData = projection.slice(0, 14).map((pt) => ({
    fecha: new Date(pt.date + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
    Entradas: (pt.projectedInflowCents / 100).toFixed(2),
    Salidas: (pt.projectedOutflowCents / 100).toFixed(2),
  }));

  const highConcentrationDays = projection.filter((p) => p.hasHighConcentration);

  return (
    <div className="space-y-6">
      {/* Alert if concentration detected */}
      {highConcentrationDays.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-amber-900">
                Alerta de Concentración de Vencimientos ({highConcentrationDays.length} días)
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                Se detectó una alta concentración de egresos los días:{" "}
                {highConcentrationDays
                  .slice(0, 3)
                  .map((d) => d.date)
                  .join(", ")}
                . Planifica el saldo de tesorería para evitar contratiempos.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Projection Recharts BarChart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" /> Proyección de Entradas vs Salidas (Próximos 14 días)
          </CardTitle>
          <CardDescription className="text-xs">
            Comparativa diaria de ingresos estimados por ventas vs compromisos de egresos (gastos + nómina).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="fecha" tickLine={false} style={{ fontSize: "11px" }} />
                <YAxis tickLine={false} style={{ fontSize: "11px" }} />
                <Tooltip
                  formatter={(val: any) => [`$${Number(val).toLocaleString("es-MX")}`, ""]}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Salidas" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 30-Day Grid Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">Calendario de Saldo Proyectado a 30 Días</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10 gap-2">
            {projection.map((day) => {
              const isNegative = day.netFlowCents < 0;
              return (
                <div
                  key={day.date}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    day.hasHighConcentration
                      ? "border-amber-300 bg-amber-50"
                      : isNegative
                      ? "border-rose-200 bg-rose-50/50"
                      : "border-muted bg-card hover:bg-muted/30"
                  }`}
                >
                  <span className="text-[10px] font-bold text-muted-foreground block">
                    {new Date(day.date + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                  </span>
                  <span className={`text-xs font-bold block mt-1 ${isNegative ? "text-rose-600" : "text-emerald-600"}`}>
                    {formatMXN(day.cumulativeBalanceCents)}
                  </span>
                  {day.hasHighConcentration && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-100 text-amber-800 mt-1 border-amber-200">
                      ⚡ Pico
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
