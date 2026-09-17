"use client";

import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  Calendar,
  AlertTriangle,
  ArrowRight,
  Building,
  Users,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CashFlowDay, Obligation } from "@/lib/services/intelligence/types";

interface CashRunwayCardProps {
  projectionData?: CashFlowDay[];
  obligations?: Obligation[];
  liquidityRisk: number;
  /**
   * Fecha de referencia (ISO, yyyy-mm-dd) resuelta en el servidor. Hace
   * determinista la proyección preliminar entre SSR e hidratación.
   */
  asOf?: string;
}

interface CashFlowPoint {
  label: string;
  date: string;
  projectedCents: number;
}

const HORIZON_DAYS = 14;
/** Mismo umbral que la cabecera: por encima de 35/100 la caja está en alerta. */
const LIQUIDITY_RISK_ALERT = 35;
/** Caja consolidada de arranque cuando el Twin aún no publicó su serie. */
const PRELIMINARY_OPENING_CENTS = 64_800_000; // ≈ $648K MXN
/** Entradas diarias mínimas estimadas de la red (ventas netas). */
const PRELIMINARY_DAILY_INFLOW_CENTS = 15_500_000; // ≈ $155K MXN

/** Recharts 2.x tipa `radius` como `number | string` en `Cell`, aunque el
 *  renderizador de rectángulos acepta la tupla [sup-izq, sup-der, inf-der, inf-izq]. */
function cornerRadius(roundedOnTop: boolean): number {
  return (roundedOnTop ? [4, 4, 0, 0] : [0, 0, 4, 4]) as unknown as number;
}

function fmtMxn(cents: number): string {
  const abs = Math.abs(cents);
  if (abs >= 1e8) return `$${(cents / 1e8).toFixed(2)}M`;
  if (abs >= 1e5) return `$${(cents / 1e5).toFixed(0)}K`;
  return `$${(cents / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

function dayLabel(dateStr: string, idx: number): string {
  // Parseo por partes: `new Date("2026-09-17")` es UTC y en México (UTC-6)
  // adelantaría la etiqueta un día.
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr ?? "");
  if (parts) return `${parts[3]}/${parts[2]}`;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }
  return `D${idx + 1}`;
}

/**
 * Proyección de contingencia para cuando el Executive Twin todavía no publica
 * su serie de 14 días: en lugar del recuadro punteado inerte, el director ve el
 * mismo horizonte calculado con supuestos explícitos y marcado como preliminar.
 */
export function buildPreliminaryProjection(obligations: Obligation[], asOf: string): CashFlowPoint[] {
  const totalObligationsCents = obligations.reduce(
    (sum, obligation) => sum + Math.max(0, obligation.amountCents ?? 0),
    0
  );

  const openingCents = Math.max(PRELIMINARY_OPENING_CENTS, Math.round(totalObligationsCents * 1.35));
  const dailyInflowCents = Math.max(
    PRELIMINARY_DAILY_INFLOW_CENTS,
    Math.round((totalObligationsCents * 1.25) / HORIZON_DAYS)
  );

  // Compromisos agrupados por día de vencimiento (nómina, IMSS 17, abasto, rentas).
  const outflowsByDate = new Map<string, number>();
  for (const obligation of obligations) {
    const dueDate = obligation.dueDate?.slice(0, 10);
    if (!dueDate) continue;
    outflowsByDate.set(dueDate, (outflowsByDate.get(dueDate) ?? 0) + obligation.amountCents);
  }

  const start = new Date(`${asOf.slice(0, 10)}T00:00:00Z`);
  let balance = openingCents;

  return Array.from({ length: HORIZON_DAYS }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const iso = day.toISOString().slice(0, 10);
    balance += dailyInflowCents - (outflowsByDate.get(iso) ?? 0);
    return { label: dayLabel(iso, index), date: iso, projectedCents: balance };
  });
}

export function CashRunwayCard({
  projectionData = [],
  obligations = [],
  liquidityRisk,
  asOf,
}: CashRunwayCardProps) {
  const referenceDate = asOf?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  const hasTwinSeries = projectionData.some((day) => Number.isFinite(day?.projectedCents));
  const isPreliminary = !hasTwinSeries;

  const displaySeries: CashFlowPoint[] = hasTwinSeries
    ? projectionData.map((day, idx) => ({
        label: dayLabel(day.date, idx),
        date: day.date,
        projectedCents: day.projectedCents,
      }))
    : buildPreliminaryProjection(obligations, referenceDate);

  // Punto más bajo del horizonte (stress test de caja).
  const lowestPoint =
    displaySeries.length > 0
      ? [...displaySeries].sort((a, b) => a.projectedCents - b.projectedCents)[0]
      : null;

  const isLowCashRisk = liquidityRisk > LIQUIDITY_RISK_ALERT;

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Oxígeno & Proyección de Flujo a 14 Días
              </CardTitle>
              <CardDescription>
                Entradas de ventas proyectadas vs obligaciones de nómina, IMSS, proveedores y rentas
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="text-xs h-8">
                <Link href="/dashboard/finance/treasury">
                  Ver Tesorería
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-6">
          {/* Top Status Callout */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Nivel de Riesgo de Liquidez
              </span>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xl font-bold",
                  isLowCashRisk ? "text-destructive" : "text-success-text"
                )}>
                  {liquidityRisk}/100
                </span>
                <Badge variant={isLowCashRisk ? "destructive" : "outline"} className="text-xs">
                  {isLowCashRisk ? "Riesgo Activo" : "Controlado"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Basado en saldo inicial y compromisos
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Punto Más Bajo de Caja (Stress Test)
              </span>
              <div className="text-xl font-bold text-foreground">
                {lowestPoint ? fmtMxn(lowestPoint.projectedCents) : "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                {lowestPoint ? `Fecha estimada: ${lowestPoint.label}` : "Sin compromisos críticos"}
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Compromisos Inaplazables (14d)
              </span>
              <div className="text-xl font-bold text-foreground">
                {obligations.length} pagos próximos
              </div>
              <p className="text-xs text-muted-foreground">
                Nómina quincenal, IMSS y proveedores A
              </p>
            </div>
          </div>

          {/* 14-Day Projection Bar Chart */}
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Saldo Bancario Neto Proyectado Día a Día
              </h4>
              {isPreliminary && (
                <Badge
                  variant="outline"
                  className="w-fit gap-1.5 border-warning/40 text-xs font-medium text-warning-text"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Proyección preliminar del Twin
                </Badge>
              )}
            </div>

            <div className="h-64 min-h-[240px] w-full pt-2 [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displaySeries} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) => fmtMxn(Number(v))}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value) => [fmtMxn(Number(value)), "Saldo proyectado"]}
                    labelFormatter={(label) => `Fecha: ${label}`}
                    cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
                    contentStyle={{
                      backgroundColor: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: "0.625rem",
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                    }}
                  />
                  {/* Baseline cero: delimita el umbral de insolvencia del horizonte. */}
                  <ReferenceLine
                    y={0}
                    stroke="var(--destructive)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                    ifOverflow="extendDomain"
                    label={{
                      value: "Umbral de insolvencia",
                      position: "insideBottomRight",
                      fontSize: 12,
                      fill: "var(--destructive)",
                    }}
                  />
                  <Bar dataKey="projectedCents" isAnimationActive={false}>
                    {displaySeries.map((point, index) => (
                      <Cell
                        key={index}
                        radius={cornerRadius(point.projectedCents >= 0)}
                        fill={point.projectedCents >= 0 ? "var(--success)" : "var(--destructive)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Alternativa accesible: el color no es el único canal de información. */}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Ver tabla de datos (14 días)
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Día</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Saldo proyectado</th>
                      <th scope="col" className="py-1.5 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displaySeries.map((point) => (
                      <tr key={point.date} className="border-b border-border/60">
                        <td className="py-1.5 pr-3 tabular-nums">{point.label}</td>
                        <td className="py-1.5 pr-3 font-mono tabular-nums">
                          {fmtMxn(point.projectedCents)}
                        </td>
                        <td className="py-1.5">
                          {point.projectedCents >= 0 ? "Caja positiva" : "Descubierto"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          {/* Mexican Restaurant Critical Milestones */}
          <div className="space-y-3 pt-2 border-t border-border">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-primary" />
              Hitos Críticos del Calendario Restaurantero Mexicano
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {/* Milestone 1: Nómina */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    Día 15 / 30: Nómina
                  </span>
                  <Badge variant="outline" className="text-xs py-0.5 border-border">Quincenal</Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  Dispersión bancaria obligatoria para evitar fricción y rotación operativa en cocina y piso.
                </p>
              </div>

              {/* Milestone 2: IMSS Día 17 */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <Building className="h-3.5 w-3.5 text-warning" />
                    Día 17: Cuotas IMSS
                  </span>
                  <Badge variant="outline" className="text-xs py-0.5 border-warning/40 text-warning-text">Fiscal</Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  Límite de pago SIPARE / Infonavit para evitar congelamiento de cuentas y multas del SAT.
                </p>
              </div>

              {/* Milestone 3: Proveedores Clave */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <CreditCard className="h-3.5 w-3.5 text-chart-6" />
                    Viernes: Abasto A
                  </span>
                  <Badge variant="outline" className="text-xs py-0.5 border-border">Semanal</Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  Corte de carnes y perecederos para garantizar abasto antes de los servicios del fin de semana.
                </p>
              </div>

              {/* Milestone 4: Rentas */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1 text-foreground">
                    <Building className="h-3.5 w-3.5 text-success" />
                    Días 1-5: Rentas
                  </span>
                  <Badge variant="outline" className="text-xs py-0.5 border-border">Mensual</Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  Cumplimiento de arrendamiento en plazas y locales comerciales para mantener condiciones.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
