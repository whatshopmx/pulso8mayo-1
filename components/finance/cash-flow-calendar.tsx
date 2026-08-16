"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statusBadgeClasses } from "@/lib/utils";
import {
  AlertTriangle,
  Calendar,
  Download,
  TrendingDown,
  TrendingUp,
  Wallet,
  ChevronDown,
  ChevronUp,
  Clock,
  PieChart,
  BarChart3,
} from "lucide-react";
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

// ── Types ────────────────────────────────────────────────────────

export interface CashFlowDay {
  date: string;
  /** `null` cuando el inquilino no tiene cortes de venta (`inflow.basis === 'NONE'`) */
  projectedInflowCents: number | null;
  projectedOutflowCents: number;
  netFlowCents: number | null;
  cumulativeBalanceCents: number | null;
  outflowItemsCount: number;
  hasHighConcentration: boolean;
}

/** Ver `InflowBasis` en `lib/services/cash-flow-service.ts`. */
export type InflowBasis = "SEASONAL" | "AVERAGE" | "NONE";

export interface InflowEstimate {
  basis: InflowBasis;
  historyDays: number;
  lookbackDays: number;
  avgDailyInflowCents: number | null;
}

interface OutflowItem {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  status: string;
  isPayroll: boolean;
  source?: "OPERATING_EXPENSE" | "PURCHASE_ORDER" | "PROCUREMENT_INVOICE";
  supplierName?: string;
}

interface CategorySummary {
  category: string;
  amountCents: number;
  count: number;
  percentage: number;
}

interface WeeklyAggregation {
  key?: string;
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalOutflowCents: number;
  itemCount: number;
  isHeavy: boolean;
  /** Días de la ventana que la semana cubre de verdad (1..7) */
  dayCount?: number;
  /** `true` cuando la ventana se corta a media semana */
  isPartial?: boolean;
}

export interface CashFlowProjection {
  days: CashFlowDay[];
  outflowItems: OutflowItem[];
  categorySummary: CategorySummary[];
  weeklyAggregation: WeeklyAggregation[];
  overdueItems: OutflowItem[];
  upcomingItems: OutflowItem[];
  initialBalanceCents: number;
  inflow?: InflowEstimate;
  procurementCommitments?: {
    purchaseOrdersCount: number;
    purchaseOrdersTotalCents: number;
    invoicesCount: number;
    invoicesTotalCents: number;
  };
  payroll?: {
    activeEmployees: number;
    monthlyTotalCents: number;
    biweeklyEstimateCents: number;
    branchCount: number;
  } | null;
}

interface CashFlowCalendarProps {
  projection: CashFlowProjection | CashFlowDay[];
}

// ── Helpers ──────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  RENTA: "Renta",
  SERVICIOS: "Servicios",
  MANTENIMIENTO: "Mantenimiento",
  PUBLICIDAD: "Publicidad",
  SERVICIOS_PROFESIONALES: "Serv. Profesionales",
  NOMINA: "Nómina",
  COMPRAS: "Compras (OC + Facturas)",
  OTROS: "Otros",
};

// Tokens de gráfica, no hex crudo: la leyenda usaba una paleta fija mientras las
// barras del mismo archivo usaban `var(--chart-N)`, así que al cambiar de tema la
// leyenda dejaba de corresponder con lo graficado.
const CATEGORY_COLORS: Record<string, string> = {
  RENTA: "var(--chart-1)",
  SERVICIOS: "var(--chart-2)",
  MANTENIMIENTO: "var(--chart-3)",
  PUBLICIDAD: "var(--chart-4)",
  SERVICIOS_PROFESIONALES: "var(--chart-5)",
  NOMINA: "var(--destructive)",
  COMPRAS: "var(--info)",
  OTROS: "var(--muted-foreground)",
};

const SOURCE_LABELS: Record<string, string> = {
  OPERATING_EXPENSE: "Gasto",
  PURCHASE_ORDER: "OC",
  PROCUREMENT_INVOICE: "Factura",
};

const SOURCE_COLORS: Record<string, string> = {
  OPERATING_EXPENSE: "bg-muted text-muted-foreground border-muted",
  PURCHASE_ORDER: "bg-info/10 text-info border-info/20",
  PROCUREMENT_INVOICE: "bg-chart-4/10 text-chart-4 border-chart-4/20",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Por aprobar",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  PAID: "Pagado",
  PROGRAMADO: "Programado",
};

function formatMXN(cents: number) {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function isProjection(obj: any): obj is CashFlowProjection {
  return obj && "categorySummary" in obj;
}

// ── Sub-components ───────────────────────────────────────────────

/** Barra horizontal proporcional para una categoría */
function CategoryBar({ label, amountCents, percentage, maxPct }: {
  label: string;
  amountCents: number;
  percentage: number;
  maxPct: number;
}) {
  const color = CATEGORY_COLORS[label] || CATEGORY_COLORS.OTROS;
  const widthPct = maxPct > 0 ? (percentage / maxPct) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">
          {CATEGORY_LABELS[label] || label}
        </span>
        <span className="text-muted-foreground">
          {formatMXN(amountCents)} ({percentage}%)
        </span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(widthPct, 2)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export function CashFlowCalendar({ projection }: CashFlowCalendarProps) {
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllOverdue, setShowAllOverdue] = useState(false);

  // Handle both old (array) and new (object) API responses
  const data: CashFlowProjection = isProjection(projection)
    ? projection
    : {
        days: projection,
        outflowItems: [],
        categorySummary: [],
        weeklyAggregation: [],
        overdueItems: [],
        upcomingItems: [],
        initialBalanceCents: 0,
      };

  const {
    days,
    categorySummary,
    weeklyAggregation,
    overdueItems,
    upcomingItems,
    initialBalanceCents,
    inflow,
  } = data;

  // Sin un solo corte de venta no hay de dónde estimar entradas, y el servicio
  // manda `null` en vez de $0/día. Nada que dependa del saldo proyectado —las
  // bandas de color, "te alcanza para N días", el saldo mínimo— se dibuja:
  // proyectar sobre cero pintaba de rojo la pantalla de estreno de cualquier
  // inquilino nuevo.
  const sinHistorialDeVentas = inflow?.basis === "NONE";

  // ── Derived metrics ──────────────────────────────────────────
  const metrics = useMemo(() => {
    if (!days.length) return null;

    // Días con saldo conocido: los demás no participan de ningún extremo.
    const conSaldo = days.filter((d) => d.cumulativeBalanceCents !== null);
    if (!conSaldo.length) return null;

    let minBalance = Infinity;
    let minDay: CashFlowDay | null = null;

    for (const day of conSaldo) {
      if (day.cumulativeBalanceCents! < minBalance) {
        minBalance = day.cumulativeBalanceCents!;
        minDay = day;
      }
    }

    const daysUntilNegative =
      conSaldo.find((d) => d.cumulativeBalanceCents! < 0)?.date ?? null;
    const negativeDays = conSaldo.filter((d) => d.cumulativeBalanceCents! < 0).length;

    const criticalDays = days
      .filter((d) => d.hasHighConcentration)
      .slice(0, 5);

    const totalInflow = days
      .slice(0, 14)
      .reduce((sum, d) => sum + (d.projectedInflowCents ?? 0), 0);
    const totalOutflow = days
      .slice(0, 14)
      .reduce((sum, d) => sum + d.projectedOutflowCents, 0);

    return {
      firstBalance: initialBalanceCents,
      minBalance,
      minDay,
      daysUntilNegative,
      negativeDays,
      criticalDays,
      totalInflow,
      totalOutflow,
      runway: daysUntilNegative
        ? days.findIndex((d) => d.date === daysUntilNegative)
        : days.length,
    };
  }, [days, initialBalanceCents]);

  // ── Chart data ──────────────────────────────────────────────
  // `null` en Entradas deja el hueco a la vista en la gráfica en vez de dibujar
  // una serie en cero que se leería como "hoy no entró nada".
  const chartData = days.slice(0, 14).map((pt) => ({
    fecha: formatDate(pt.date),
    Entradas:
      pt.projectedInflowCents === null
        ? null
        : (pt.projectedInflowCents / 100).toFixed(2),
    Salidas: (pt.projectedOutflowCents / 100).toFixed(2),
  }));

  const weeklyChartData = weeklyAggregation.map((w) => ({
    semana: w.weekLabel,
    Egresos: (w.totalOutflowCents / 100).toFixed(2),
    Presión: w.isHeavy ? "Alta" : "Normal",
  }));

  // ── Export CSV ──────────────────────────────────────────────
  const handleExportCSV = () => {
    const header =
      "Fecha,Entradas (MXN),Salidas (MXN),Flujo Neto (MXN),Saldo Acumulado (MXN),Egresos (cantidad)";
    // Celda vacía —no "0.00"— cuando la cifra no se pudo estimar: un cero en una
    // hoja de cálculo es una afirmación, y aquí no hay nada que afirmar.
    const pesos = (cents: number | null) =>
      cents === null ? "" : (cents / 100).toFixed(2);
    const rows = days.map((d) =>
      [
        d.date,
        pesos(d.projectedInflowCents),
        pesos(d.projectedOutflowCents),
        pesos(d.netFlowCents),
        pesos(d.cumulativeBalanceCents),
        d.outflowItemsCount,
      ].join(",")
    );
    const bom = "\uFEFF";
    const blob = new Blob([bom + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flujo-efectivo-30d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!days.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-xs text-muted-foreground">
          Sin datos de proyección disponibles.
        </CardContent>
      </Card>
    );
  }

  const maxCategoryPct = Math.max(...categorySummary.map((c) => c.percentage), 1);
  const visibleOverdue = showAllOverdue ? overdueItems : overdueItems.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════
          FILA 1: ¿Me alcanza? — hero cards
          ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Saldo actual */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium mb-1">
              <Wallet className="w-4 h-4" />
              Saldo inicial proyectado
            </div>
            <div className="text-2xl font-bold text-foreground">
              {formatMXN(metrics?.firstBalance ?? 0)}
            </div>
          </CardContent>
        </Card>

        {/* Saldo mínimo */}
        <Card
          className={
            metrics && metrics.minBalance < 0
              ? "border-destructive/30 bg-destructive/5"
              : metrics && metrics.minBalance < 50000
              ? "border-warning/30 bg-warning/5"
              : ""
          }
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium mb-1">
              <TrendingDown className="w-4 h-4" />
              Saldo mínimo proyectado
            </div>
            {sinHistorialDeVentas ? (
              <>
                <div className="text-2xl font-bold text-muted-foreground">
                  Sin estimar
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Necesita cortes de venta para proyectar el saldo
                </p>
              </>
            ) : (
              <>
                <div
                  className={`text-2xl font-bold ${
                    metrics && metrics.minBalance < 0
                      ? "text-destructive"
                      : metrics && metrics.minBalance < 50000
                      ? "text-warning"
                      : "text-foreground"
                  }`}
                >
                  {formatMXN(metrics?.minBalance ?? 0)}
                </div>
                {metrics?.minDay && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Día más crítico:{" "}
                    <span className="font-medium text-foreground">
                      {formatDate(metrics.minDay.date)}
                    </span>
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Días de efectivo — "Runway" es vocabulario de capital de riesgo, no de
            un dueño de taquería. */}
        <Card
          className={
            metrics && metrics.negativeDays > 0
              ? "border-destructive/30 bg-destructive/5"
              : ""
          }
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium mb-1">
              <Calendar className="w-4 h-4" />
              Te alcanza para
            </div>
            {sinHistorialDeVentas ? (
              <>
                <div className="text-2xl font-bold text-muted-foreground">
                  Sin estimar
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Captura los cortes de venta para estimar las entradas
                </p>
              </>
            ) : metrics?.daysUntilNegative ? (
              <>
                <div className="text-2xl font-bold text-destructive">
                  {metrics.runway} días
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Saldo negativo el{" "}
                  <span className="font-medium text-destructive">
                    {formatDate(metrics.daysUntilNegative)}
                  </span>
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-success">
                  {days.length}+ días
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Sin riesgo de saldo negativo en la ventana de proyección
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Procurement summary — what's feeding the projection */}
      {data.procurementCommitments &&
        (data.procurementCommitments.purchaseOrdersCount > 0 ||
          data.procurementCommitments.invoicesCount > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
            <span className="font-medium text-foreground">Fuentes de egresos:</span>
            {data.procurementCommitments.purchaseOrdersCount > 0 && (
              <Badge variant="outline" className={`text-xs ${SOURCE_COLORS.PURCHASE_ORDER}`}>
                {data.procurementCommitments.purchaseOrdersCount} OC (
                {formatMXN(data.procurementCommitments.purchaseOrdersTotalCents)})
              </Badge>
            )}
            {data.procurementCommitments.invoicesCount > 0 && (
              <Badge variant="outline" className={`text-xs ${SOURCE_COLORS.PROCUREMENT_INVOICE}`}>
                {data.procurementCommitments.invoicesCount} Facturas (
                {formatMXN(data.procurementCommitments.invoicesTotalCents)})
              </Badge>
            )}
            {data.payroll && data.payroll.activeEmployees > 0 && (
              <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
                Nómina: {data.payroll.activeEmployees} emp ·{" "}
                {formatMXN(data.payroll.biweeklyEstimateCents)}/quincena
              </Badge>
            )}
            <span>+ gastos operativos</span>
          </div>
        )}

      {/* ════════════════════════════════════════════════════════════
          FILA 1.5: Facturas vencidas — ACCIÓN INMEDIATA
          ════════════════════════════════════════════════════════════ */}
      {overdueItems.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 space-y-3">
                <div>
                  <h4 className="text-sm font-bold text-destructive">
                    Facturas y gastos vencidos ({overdueItems.length})
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Estos compromisos ya pasaron su fecha de vencimiento y no están marcados como pagados.
                  </p>
                </div>
                <div className="divide-y divide-destructive/10 rounded-md border border-destructive/20 bg-background">
                  {visibleOverdue.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {item.description}
                          {item.source && item.source !== "OPERATING_EXPENSE" && (
                            <Badge
                              variant="outline"
                              className={`ml-1.5 text-xs px-1 py-0 ${SOURCE_COLORS[item.source] || ""}`}
                            >
                              {SOURCE_LABELS[item.source] || item.source}
                            </Badge>
                          )}
                        </p>
                        <p className="text-muted-foreground">
                          {CATEGORY_LABELS[item.category] || item.category} · Venció{" "}
                          {formatDate(item.date)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-destructive">
                          {formatMXN(item.amountCents)}
                        </p>
                        <Badge
                          variant="outline"
                          className={`text-xs px-1 py-0 ${statusBadgeClasses("destructive")}`}
                        >
                          {STATUS_LABELS[item.status] || item.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
                {overdueItems.length > 5 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setShowAllOverdue(!showAllOverdue)}
                  >
                    {showAllOverdue ? (
                      <>
                        <ChevronUp className="w-3 h-3 mr-1" /> Mostrar solo 5
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3 mr-1" /> Ver todos ({overdueItems.length})
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ════════════════════════════════════════════════════════════
          FILA 2: ¿En qué gasto? — categorías
          ════════════════════════════════════════════════════════════ */}
      {categorySummary.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Category breakdown bars */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <PieChart className="w-5 h-5 text-primary" />
                ¿En qué gasto?
              </CardTitle>
              <CardDescription className="text-xs">
                Distribución de egresos por categoría en el período de proyección.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {categorySummary.slice(0, showAllCategories ? undefined : 4).map((cat) => (
                <CategoryBar
                  key={cat.category}
                  label={cat.category}
                  amountCents={cat.amountCents}
                  percentage={cat.percentage}
                  maxPct={maxCategoryPct}
                />
              ))}
              {categorySummary.length > 4 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs w-full"
                  onClick={() => setShowAllCategories(!showAllCategories)}
                >
                  {showAllCategories ? (
                    <>
                      <ChevronUp className="w-3 h-3 mr-1" /> Colapsar
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3 mr-1" /> Ver todas ({categorySummary.length})
                    </>
                  )}
                </Button>
              )}
              {/* Total */}
              <div className="border-t pt-2 flex items-center justify-between text-xs font-bold">
                <span>Total egresos</span>
                <span>
                  {formatMXN(
                    categorySummary.reduce((s, c) => s + c.amountCents, 0)
                  )}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Upcoming 7 days — what's due soon */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Próximos 7 días
              </CardTitle>
              <CardDescription className="text-xs">
                Compromisos que vencen esta semana. Prepará la tesorería.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingItems.length > 0 ? (
                <div className="divide-y divide-border rounded-md border">
                  {upcomingItems.slice(0, 8).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {item.description}
                          {item.source && item.source !== "OPERATING_EXPENSE" && (
                            <Badge
                              variant="outline"
                              className={`ml-1.5 text-xs px-1 py-0 ${SOURCE_COLORS[item.source] || ""}`}
                            >
                              {SOURCE_LABELS[item.source] || item.source}
                            </Badge>
                          )}
                        </p>
                        <p className="text-muted-foreground">
                          {CATEGORY_LABELS[item.category] || item.category} ·{" "}
                          {formatDate(item.date)}
                        </p>
                      </div>
                      <p className="font-bold text-foreground shrink-0">
                        {formatMXN(item.amountCents)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  Sin compromisos en los próximos 7 días.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          FILA 3: ¿Qué semanas preocupan? — weekly aggregation
          ════════════════════════════════════════════════════════════ */}
      {weeklyAggregation.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Presión semanal de egresos
            </CardTitle>
            <CardDescription className="text-xs">
              Semanas donde la concentración de pagos supera el promedio. Las semanas marcadas en rojo requieren atención.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Rejilla que se ajusta al número de semanas emitidas. Con `lg:grid-cols-4`
                fijo, una ventana de 30 días (5 semanas) dejaba siempre una tarjeta
                huérfana en su propio renglón. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              {weeklyAggregation.map((week) => (
                <div
                  key={week.key ?? week.startDate}
                  className={`rounded-lg border p-3 ${
                    week.isHeavy
                      ? "border-destructive/30 bg-destructive/5"
                      : week.isPartial
                      ? "border-dashed border-muted bg-muted/20"
                      : "border-muted bg-card"
                  }`}
                >
                  <p
                    className={`text-xs font-bold mb-2 ${
                      week.isHeavy ? "text-destructive" : "text-foreground"
                    }`}
                  >
                    {week.weekLabel}
                    {week.isHeavy && (
                      <AlertTriangle className="w-3 h-3 inline ml-1 text-destructive" />
                    )}
                  </p>
                  <p
                    className={`text-xl font-bold ${
                      week.isHeavy ? "text-destructive" : "text-foreground"
                    }`}
                  >
                    {formatMXN(week.totalOutflowCents)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {week.itemCount} compromisos
                    {/* Un total más chico porque la ventana se cortó no es una semana
                        descargada. Se dice, en vez de dejarlo comparar de más. */}
                    {week.isPartial && week.dayCount != null && (
                      <> · {week.dayCount} {week.dayCount === 1 ? "día" : "días"} en la ventana</>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ════════════════════════════════════════════════════════════
          FILA 4: Resumen 14d + Chart + Export
          ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Summary strip */}
        <Card className="lg:col-span-1">
          <CardContent className="p-4 space-y-3">
            <h4 className="text-sm font-bold">Resumen 14 días</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-success" />
                  Entradas
                </span>
                <span className="font-bold text-success">
                  {formatMXN(metrics?.totalInflow ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                  Salidas
                </span>
                <span className="font-bold text-destructive">
                  {formatMXN(metrics?.totalOutflow ?? 0)}
                </span>
              </div>
              <div className="border-t pt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">Flujo neto</span>
                <span
                  className={`font-bold ${
                    (metrics?.totalInflow ?? 0) - (metrics?.totalOutflow ?? 0) >= 0
                      ? "text-success"
                      : "text-destructive"
                  }`}
                >
                  {formatMXN((metrics?.totalInflow ?? 0) - (metrics?.totalOutflow ?? 0))}
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2 text-xs"
              onClick={handleExportCSV}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Exportar CSV
            </Button>
          </CardContent>
        </Card>

        {/* Bar chart */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Proyección de Entradas vs Salidas (Próximos 14 días)
            </CardTitle>
            <CardDescription className="text-xs">
              Comparativa diaria de ingresos estimados por ventas vs compromisos de egresos
              (gastos + nómina).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="h-72 w-full"
              role="img"
              aria-label="Flujo de efectivo: entradas vs salidas de los próximos 14 días"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="fecha" tickLine={false} style={{ fontSize: "12px" }} />
                  <YAxis tickLine={false} style={{ fontSize: "12px" }} />
                  <Tooltip
                    formatter={(val: any) => [
                      `$${Number(val).toLocaleString("es-MX")}`,
                      "",
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Bar
                    dataKey="Entradas"
                    fill="var(--chart-3)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Salidas"
                    fill="var(--chart-5)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>Proyección de entradas y salidas (próximos 14 días)</caption>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Entradas (MXN)</th>
                  <th>Salidas (MXN)</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((d) => (
                  <tr key={d.fecha}>
                    <td>{d.fecha}</td>
                    <td>${d.Entradas}</td>
                    <td>${d.Salidas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
