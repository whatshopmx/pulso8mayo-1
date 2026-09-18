"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { AlertCircle, Loader2, Wallet, Utensils, Users, TrendingUp, Minus } from "lucide-react";
import type {
  FinancialKPIsResult,
  KpiMetric,
  SemaphoreStatus,
} from "@/lib/services/financial-kpi-types";
import type { LineSource } from "@/lib/services/pnl-types";
import type { DateRange } from "@/components/finance/period-selector";
import { format } from "date-fns";

interface FinancialKpiCardsProps {
  branchId?: string;
  dateRange?: DateRange;
}

// Tokens semánticos: la paleta cruda de Tailwind no tenía variante oscura, así
// que el semáforo perdía su lectura entera en `.dark`.
const STATUS_COLORS: Record<SemaphoreStatus, { bar: string; badge: string; label: string }> = {
  OK: { bar: "bg-success", badge: statusBadgeClasses("success"), label: "Saludable" },
  WARNING: { bar: "bg-warning", badge: statusBadgeClasses("warning"), label: "Precaución" },
  CRITICAL: { bar: "bg-destructive", badge: statusBadgeClasses("destructive"), label: "Crítico" },
};

/**
 * Pisos de plausibilidad (P1 #2). Un semáforo solo certifica lo que la base de
 * datos respalda: un food cost de 0.9% no es "saludable", es un cálculo sin
 * consumo detrás. Las cotas separan lo operativo de lo imposible —no juzgan la
 * gestión— y solo se aplican cuando la procedencia NO es una medición directa.
 */
const IMPLAUSIBLE_COST_FLOOR_PERCENT = 3;
const IMPLAUSIBLE_MARGIN_CEILING_PERCENT = 95;
/** ±200% en ventas casi siempre es base incomparable (alta/baja de sucursal), no tendencia. */
const IMPLAUSIBLE_SALES_DELTA_PERCENT = 200;
/** Más de 100 puntos porcentuales no es un movimiento: es un artefacto de base. */
const IMPLAUSIBLE_DELTA_POINTS = 100;

function isIndirectSource(source: LineSource): boolean {
  return source !== "MEASURED";
}

const INSUFFICIENT_BADGE = statusBadgeClasses("neutral");
const INSUFFICIENT_LABEL_SHORT = "Sin datos suficientes";

/**
 * Marca de procedencia, con el mismo vocabulario que el P&L
 * (`components/finance/pnl-branch-table.tsx`): un número estimado nunca se
 * presenta con la misma tipografía que uno medido.
 */
const SOURCE_MARKER: Record<LineSource, { mark: string; hint: string } | null> = {
  MEASURED: null,
  DERIVED: {
    mark: "†",
    hint: "Calculado con tus datos pero por vía indirecta (compras en lugar de consumo, o plantilla contratada en lugar de asistencia real).",
  },
  ESTIMATED: {
    mark: "‡",
    hint: "Calculado con una tarifa que tú configuraste, no con un importe que el sistema haya medido.",
  },
  SECTOR_DEFAULT: {
    mark: "*",
    hint: "Estimación sectorial HORECA: este renglón NO se calcula con tus datos todavía.",
  },
  NO_DATA: null,
};

/** Formatea una diferencia en puntos porcentuales contra el período anterior. */
function DeltaBadge({
  deltaPoints,
  lowerIsBetter,
}: {
  deltaPoints: number | null;
  lowerIsBetter: boolean;
}) {
  if (deltaPoints === null) {
    return (
      <span className="text-xs text-muted-foreground/70" title="Sin período anterior comparable">
        sin comparativa
      </span>
    );
  }

  // Un movimiento por debajo de una décima es ruido de redondeo, no tendencia.
  if (Math.abs(deltaPoints) < 0.1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="w-3 h-3" aria-hidden /> sin cambio
      </span>
    );
  }

  // Magnitud antes que signo (P1 #2): un salto de cientos de puntos no es una
  // tendencia, es un período anterior casi vacío. Se muestra, no se certifica.
  if (Math.abs(deltaPoints) > IMPLAUSIBLE_DELTA_POINTS) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title={`${deltaPoints > 0 ? "+" : "−"}${Math.abs(deltaPoints).toFixed(1)} puntos porcentuales: fuera del rango fiable`}
      >
        sin comparativa fiable
      </span>
    );
  }

  const worse = lowerIsBetter ? deltaPoints > 0 : deltaPoints < 0;
  const sign = deltaPoints > 0 ? "+" : "−";
  const abs = Math.abs(deltaPoints).toFixed(1);

  return (
    <span
      className={`text-xs font-semibold tabular-nums ${worse ? "text-destructive" : "text-success"}`}
      title={`${abs} puntos porcentuales ${deltaPoints > 0 ? "más" : "menos"} que el período anterior`}
    >
      {sign}
      {abs} pts
    </span>
  );
}

export function FinancialKpiCards({ branchId, dateRange }: FinancialKpiCardsProps) {
  const [kpis, setKpis] = useState<FinancialKPIsResult | null>(null);
  const [salesSummary, setSalesSummary] = useState<{
    cutsCount: number;
    totalTickets: number;
    avgTicketCents: number;
    cashSalesCents: number;
    cardSalesCents: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fetchKpis = async () => {
      setLoading(true);
      setFailed(false);
      try {
        const salesUrl = new URL("/api/sales/analytics", window.location.origin);
        const kpiUrl = new URL("/api/finance/kpis", window.location.origin);
        if (branchId && branchId !== "ALL") {
          salesUrl.searchParams.set("branchId", branchId);
          kpiUrl.searchParams.set("branchId", branchId);
        }
        if (dateRange?.from) {
          const fromStr = format(dateRange.from, "yyyy-MM-dd");
          salesUrl.searchParams.set("startDate", fromStr);
          kpiUrl.searchParams.set("startDate", fromStr);
          if (dateRange.to) {
            const toStr = format(dateRange.to, "yyyy-MM-dd");
            salesUrl.searchParams.set("endDate", toStr);
            kpiUrl.searchParams.set("endDate", toStr);
          }
        }

        const [salesRes, kpiRes] = await Promise.all([
          fetch(salesUrl.toString()),
          fetch(kpiUrl.toString()),
        ]);

        const salesJson = await salesRes.json();
        const kpiJson = await kpiRes.json();

        if (!kpiRes.ok || !kpiJson.success) {
          setFailed(true);
          return;
        }

        setKpis(kpiJson.data as FinancialKPIsResult);
        // El desglose de tickets y formas de pago sigue viniendo de analytics:
        // son datos del corte, no del cálculo de costos.
        setSalesSummary(salesRes.ok && salesJson.success ? salesJson.data?.summary ?? null : null);
      } catch (err) {
        console.error("Failed to load financial KPIs:", err);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };

    fetchKpis();
  }, [branchId, dateRange]);

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Calculando KPIs financieros...
      </div>
    );
  }

  if (failed || !kpis) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="No se pudieron cargar los KPIs financieros"
        description="Error al conectar con el servicio de analítica de ventas. Revisa tu conexión e intenta recargar la página."
      />
    );
  }

  if (kpis.totalSalesCents === 0) {
    return (
      <EmptyState
        icon={Wallet}
        title="Sin ventas registradas en el período"
        description="Sube un corte POS o recibe cortes por WhatsApp para visualizar la venta total y el desglose efectivo/tarjeta."
      />
    );
  }

  const cashCents = salesSummary?.cashSalesCents ?? 0;
  const cardCents = salesSummary?.cardSalesCents ?? 0;
  const cashPct =
    cashCents + cardCents > 0 ? Math.round((cashCents / (cashCents + cardCents)) * 100) : 0;

  const renderCostBar = (
    icon: React.ReactNode,
    label: string,
    metric: KpiMetric,
    targetPercent: number,
    insufficientLabel: string,
  ) => {
    const marker = SOURCE_MARKER[metric.source];

    // Sin porcentaje no hay barra que dibujar: se dice qué falta capturar.
    if (metric.percent === null) {
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium flex items-center gap-1.5">
              {icon}
              {label}
            </span>
            <span className="text-xs text-muted-foreground">Sin datos</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted" />
          <p className="text-xs text-muted-foreground">{metric.note}</p>
        </div>
      );
    }

    const colors = STATUS_COLORS[metric.status ?? "OK"];
    const displayPct = Math.min(metric.percent, 100);

    // Suficiencia ANTES de veredicto: con procedencia indirecta y un valor por
    // debajo del piso operativo, el número no tiene consumo/asistencia detrás.
    // Decir "Saludable" aquí es la mentira que rompe la confianza en cada
    // badge verde de la plataforma.
    const insufficient =
      isIndirectSource(metric.source) && metric.percent < IMPLAUSIBLE_COST_FLOOR_PERCENT;
    const barColor = insufficient ? "bg-muted-foreground/25" : colors.bar;
    const badgeClass = insufficient ? INSUFFICIENT_BADGE : colors.badge;

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium flex items-center gap-1.5">
            {icon}
            {label}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!insufficient && <DeltaBadge deltaPoints={metric.deltaPoints} lowerIsBetter />}
            <span className="text-xs font-bold tabular-nums">
              {metric.percent}%
              {marker && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <sup
                      role="button"
                      tabIndex={0}
                      className="ml-0.5 text-warning-text cursor-help focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") e.preventDefault();
                      }}
                    >
                      {marker.mark}
                    </sup>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">{marker.hint}</TooltipContent>
                </Tooltip>
              )}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full border ${badgeClass}`}>
              {insufficient ? INSUFFICIENT_LABEL_SHORT : colors.label}
            </span>
          </div>
        </div>
        {/* Barra sobre capa absoluta: el relleno anima con transform scaleX
            (compositor), nunca con width (layout thrash). */}
        <div className="relative h-2 rounded-full overflow-hidden bg-muted">
          <div
            className={`absolute inset-y-0 left-0 w-full origin-left ${barColor} transition-transform duration-500 motion-reduce:transition-none`}
            style={{ transform: `scaleX(${displayPct / 100})` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/30"
            style={{ left: `${Math.max(0, targetPercent)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {insufficient ? insufficientLabel : `Objetivo del grupo: <${targetPercent}%`}
        </p>
      </div>
    );
  };

  const marginInsufficient =
    kpis.healthyMarginPercent !== null &&
    isIndirectSource(kpis.weakestSource) &&
    kpis.healthyMarginPercent > IMPLAUSIBLE_MARGIN_CEILING_PERCENT;
  const marginColors = marginInsufficient
    ? { bar: "bg-muted-foreground/25", badge: INSUFFICIENT_BADGE, label: INSUFFICIENT_LABEL_SHORT }
    : kpis.healthyMarginStatus === null
      ? null
      : STATUS_COLORS[kpis.healthyMarginStatus];

  /** Nota al pie: solo los métodos que realmente aparecen arriba. */
  const footnotes: string[] = [];
  for (const metric of [kpis.foodCost, kpis.laborCost]) {
    const marker = SOURCE_MARKER[metric.source];
    if (marker && !footnotes.some((f) => f.startsWith(marker.mark))) {
      footnotes.push(`${marker.mark} ${marker.hint}`);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-1.5">
          Resumen Financiero
          {/* Tooltip Radix, no `title`: visible con foco de teclado y en táctil.
              Mismo patrón que app/dashboard/sales. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center w-5 h-5 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 rounded-full border border-muted-foreground/30 text-xs leading-none text-muted-foreground cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Qué incluye el resumen financiero: ventas totales, tickets promedio, proporción efectivo/tarjeta y costos operativos calculados con las mismas fuentes que el P&L por sucursal."
              >
                ?
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              Ventas totales, tickets promedio, proporción efectivo/tarjeta y costos operativos (food cost, labor cost) calculados con las mismas fuentes que el P&L por sucursal. Los objetivos son los configurados para tu grupo.
            </TooltipContent>
          </Tooltip>
        </CardTitle>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1">
          <span className="text-3xl font-bold text-foreground">
            {formatCents(kpis.totalSalesCents)}
          </span>
          {kpis.salesDeltaPercent !== null &&
            (() => {
              const delta = kpis.salesDeltaPercent as number;
              const deltaTitle = `Contra ${formatCents(kpis.previousTotalSalesCents)} del período anterior (${kpis.previousPeriod.startDate} a ${kpis.previousPeriod.endDate})`;
              // Magnitud antes que signo (P1 #2): +2851% no es buena noticia, es
              // un período anterior casi vacío. El verde de éxito se reserva a
              // lo que sí es comparable.
              if (Math.abs(delta) > IMPLAUSIBLE_SALES_DELTA_PERCENT) {
                return (
                  <span
                    className="text-xs font-medium text-muted-foreground"
                    title={`${delta > 0 ? "+" : ""}${delta}% vs. período anterior · ${deltaTitle}`}
                  >
                    sin comparativa fiable
                  </span>
                );
              }
              return (
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    delta >= 0 ? "text-success" : "text-destructive"
                  }`}
                  title={deltaTitle}
                >
                  {delta > 0 ? "+" : ""}
                  {delta}% vs. período anterior
                </span>
              );
            })()}
        </div>
        {salesSummary && (
          <p className="text-xs text-muted-foreground">
            {salesSummary.cutsCount} cortes · {salesSummary.totalTickets?.toLocaleString()} tickets ·
            ticket prom.{" "}
            <span className="font-medium text-foreground">
              {formatCents(salesSummary.avgTicketCents)}
            </span>
          </p>
        )}
        <p className="text-xs text-muted-foreground/80">
          Período: {kpis.period.startDate} a {kpis.period.endDate} ({kpis.period.days} días)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Food Cost & Labor Cost — primary operational KPIs */}
        <div className="space-y-3 pt-2 border-t">
          {renderCostBar(
            <Utensils className="w-3.5 h-3.5" />,
            "Food Cost",
            kpis.foodCost,
            kpis.targets.foodCostTargetPercent,
            "Sin datos de consumo suficientes para leer este porcentaje como salud.",
          )}
          {renderCostBar(
            <Users className="w-3.5 h-3.5" />,
            "Labor Cost",
            kpis.laborCost,
            kpis.targets.laborCostTargetPercent,
            "Sin datos de asistencia suficientes para leer este porcentaje como salud.",
          )}
        </div>

        {/* Margen de contribución */}
        <div className="flex items-center justify-between pt-3 border-t">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            Margen tras food y labor
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center w-4 h-4 min-w-[28px] min-h-[28px] sm:min-w-0 sm:min-h-0 rounded-full border border-muted-foreground/30 text-xs leading-none text-muted-foreground cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Qué es este margen: 100% menos food cost menos labor cost. No es utilidad operativa, no descuenta renta ni gastos operativos."
                >
                  ?
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                100% menos food cost menos labor cost. NO es utilidad operativa: todavía no descuenta renta, servicios ni gastos operativos. Para el margen real, consulta el P&L por sucursal.
              </TooltipContent>
            </Tooltip>
          </div>
          {kpis.healthyMarginPercent === null ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!marginInsufficient && (
                <DeltaBadge deltaPoints={kpis.healthyMarginDeltaPoints} lowerIsBetter={false} />
              )}
              <span
                className={`text-sm font-bold tabular-nums ${
                  marginInsufficient
                    ? "text-muted-foreground"
                    : kpis.healthyMarginStatus === "OK"
                      ? "text-success"
                      : kpis.healthyMarginStatus === "WARNING"
                        ? "text-warning-text"
                        : "text-destructive"
                }`}
              >
                {kpis.healthyMarginPercent}%
              </span>
              {marginColors && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full border ${marginColors.badge}`}>
                  {marginColors.label}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Efectivo vs Tarjeta — single proportion bar */}
        {cashCents + cardCents > 0 && (
          <div className="pt-3 border-t">
            <div className="flex items-center justify-between text-xs font-medium mb-1.5">
              <span>Efectivo vs Tarjeta</span>
              <span className="text-muted-foreground">
                {cashPct}% / {100 - cashPct}%
              </span>
            </div>
            <div className="w-full h-5 rounded-full overflow-hidden bg-muted flex text-xs font-medium leading-none">
              <div
                className="h-full bg-chart-3 flex items-center justify-center text-white"
                style={{ width: `${cashPct}%` }}
                aria-label={`Efectivo: ${cashPct}%`}
              >
                {cashPct >= 15 && <span>E</span>}
              </div>
              <div
                className="h-full bg-chart-4 flex items-center justify-center text-white"
                style={{ width: `${100 - cashPct}%` }}
                aria-label={`Tarjeta: ${100 - cashPct}%`}
              >
                {100 - cashPct >= 15 && <span>T</span>}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
              <span>Efectivo: {formatCents(cashCents)}</span>
              <span>Tarjeta: {formatCents(cardCents)}</span>
            </div>
          </div>
        )}

        {footnotes.length > 0 && (
          <div className="space-y-1 pt-3 border-t text-xs leading-relaxed text-muted-foreground max-w-[70ch]">
            {footnotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
