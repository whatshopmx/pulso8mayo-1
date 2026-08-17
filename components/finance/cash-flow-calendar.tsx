"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { OpeningBalanceCard } from "@/components/finance/opening-balance-card";
import { ExpenseRowActions } from "@/components/finance/expense-row-actions";
import { statusBadgeClasses } from "@/lib/utils";
import {
  AlertTriangle,
  Calendar,
  Download,
  TrendingDown,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Clock,
  PieChart,
  BarChart3,
  Building2,
  HelpCircle,
  ArrowRight,
  ShieldCheck,
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
  /** Sucursal de la partida; se rotula sólo en alcance de grupo. */
  branchId?: string | null;
  branchName?: string | null;
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
  /** `null` cuando nadie ha capturado el saldo: ya no hay constante de respaldo. */
  initialBalanceCents: number | null;
  openingBalance?: {
    source: "BRANCH" | "COMPANY" | "NONE";
    asOfDate: string | null;
    ageInDays: number | null;
    isStale: boolean;
  };
  inflow?: InflowEstimate;
  /** Alcance realmente aplicado — puede diferir del solicitado (`enforceBranchScope`). */
  scope?: {
    branchId: string | null;
    branchName: string | null;
  };
  /** Facturas sin sucursal asignada, excluidas del cálculo por sucursal. */
  unassignedInvoicesCount?: number;
  procurementCommitments?: {
    purchaseOrdersCount: number;
    purchaseOrdersTotalCents: number;
    invoicesCount: number;
    invoicesTotalCents: number;
    /** Comprometido real que vence después de la ventana proyectada */
    outsideWindow?: {
      purchaseOrdersCount: number;
      purchaseOrdersTotalCents: number;
      invoicesCount: number;
      invoicesTotalCents: number;
    };
  };
  payroll?: {
    activeEmployees: number;
    monthlyTotalCents: number;
    biweeklyEstimateCents: number;
    branchCount: number;
  } | null;
}

interface CashFlowCalendarProps {
  projection: CashFlowProjection;
  /** Horizonte pedido, para rotularlo. Por defecto, los días que trae el payload. */
  horizonDays?: number;
  /** Si se dibuja el control de captura del saldo. La ruta lo vuelve a exigir. */
  canEditAssumptions?: boolean;
  /** Revalida la proyección tras capturar el saldo. */
  onAssumptionSaved?: () => void;
  /** Si se dibujan las acciones de pago/reprogramación. La ruta manda. */
  canActOnExpenses?: boolean;
  /** Revalida la proyección tras pagar o reprogramar. */
  onActionDone?: () => void;
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


// ── Sub-components ───────────────────────────────────────────────

/**
 * Destino de cada partida según su origen.
 *
 * El inventario del crítico: 4 elementos interactivos, 0 que naveguen. La dueña
 * se enteraba de que tenía 6 gastos vencidos y después tenía que salir, abrir la
 * lista y buscar a mano por una descripción truncada.
 *
 * `PROCUREMENT_INVOICE` va a Cuentas por Pagar y no a `/finance/fiscal` como
 * decía el plan: esa pantalla es un validador de CFDI, no una lista — no tiene
 * fila que enfocar. `payables` sí lista las facturas pendientes por id.
 */
const SOURCE_ROUTES: Record<string, string> = {
  OPERATING_EXPENSE: "/dashboard/finance/expenses",
  PROCUREMENT_INVOICE: "/dashboard/finance/payables",
  PURCHASE_ORDER: "/dashboard/inventory/purchase-orders",
};

function hrefParaPartida(item: OutflowItem): string | null {
  // La nómina se sintetiza en el servicio (`payroll-<fecha>`): no hay registro
  // que abrir, así que esa fila no enlaza a ninguna parte.
  if (item.isPayroll) return null;
  const base = item.source ? SOURCE_ROUTES[item.source] : null;
  return base ? `${base}?focus=${encodeURIComponent(item.id)}` : null;
}

/**
 * Fila de una partida: zona enlazada al registro origen + acciones a un lado.
 *
 * Las acciones van **fuera** del `Link`, no dentro: un `<button>` anidado en un
 * `<a>` es HTML inválido y rompe la navegación por teclado — el lector de
 * pantalla anuncia un solo control donde hay tres.
 */
function ItemRow({
  item,
  className,
  children,
  trailing,
  actions,
}: {
  item: OutflowItem;
  className: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const href = hrefParaPartida(item);

  const contenido = href ? (
    <Link
      href={href}
      // El foco de teclado y el hover se ven en toda la zona enlazada, no en
      // un fragmento de texto.
      className="flex-1 min-w-0 rounded-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
    >
      {children}
    </Link>
  ) : (
    <div className="flex-1 min-w-0">{children}</div>
  );

  return (
    <div className={className}>
      {contenido}
      {trailing}
      {actions}
    </div>
  );
}

/**
 * Segunda línea de una partida: categoría, proveedor, sucursal y fecha.
 *
 * `supplierName` venía en el payload y no se renderizaba en ningún lado, así
 * que identificar "Renta" entre seis filas truncadas exigía recordar cuál era.
 * La sucursal sólo aparece en alcance de grupo: repetirla en cada fila cuando
 * ya está en la píldora del encabezado es ruido.
 */
function ItemMeta({
  item,
  showBranch,
  prefix,
}: {
  item: OutflowItem;
  showBranch: boolean;
  prefix: string;
}) {
  const partes = [
    CATEGORY_LABELS[item.category] || item.category,
    item.supplierName,
    showBranch ? item.branchName : null,
  ].filter(Boolean);

  return (
    <p className="text-muted-foreground">
      {partes.join(" · ")} · {prefix} {formatDate(item.date)}
    </p>
  );
}

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

export function CashFlowCalendar({
  projection,
  horizonDays,
  canEditAssumptions = false,
  onAssumptionSaved,
  canActOnExpenses = false,
  onActionDone,
}: CashFlowCalendarProps) {
  // Los colapsos vivían en `useState`, así que se reiniciaban en cada cambio de
  // sucursal y no se podían enlazar. En la URL sobreviven al remonte y viajan en
  // el enlace que se le manda al contador.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const showAllCategories = searchParams.get("categorias") === "todas";
  const showAllOverdue = searchParams.get("vencidos") === "todos";

  const alternarParam = (clave: string, valor: string, activo: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (activo) params.delete(clave);
    else params.set(clave, valor);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // El fallback de "arreglo legacy" se eliminó: cuando el payload no era el
  // objeto completo, vaciaba cuatro de las seis secciones sin decir nada —
  // un estado degradado indistinguible de uno sano. La API devuelve siempre el
  // objeto, así que el tipo lo exige y punto.
  const data = projection;

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

  // Horizonte que la pantalla está describiendo. Se rotula en la gráfica, el
  // resumen y el CSV para que las tres digan la misma ventana.
  const horizonte = horizonDays ?? days.length;

  // Sin saldo capturado no hay punto de partida, así que no hay trayectoria:
  // nada que dependa del saldo acumulado se dibuja.
  const sinSaldoCapturado = initialBalanceCents === null;

  // El saldo proyectado necesita las dos cosas: de dónde parte y cuánto entra.
  // Falte la que falte, no se proyecta — y se dice cuál falta, porque "captura
  // tu saldo" y "captura tus ventas" son acciones distintas.
  const sinProyeccionDeSaldo = sinSaldoCapturado || sinHistorialDeVentas;

  /**
   * Las cuatro estimaciones que cargan la pantalla. Se nombran y se explican en
   * vez de presentarse como hechos: quien decide con estas cifras tiene derecho
   * a saber cuáles son medidas y cuáles inferidas.
   */
  const supuestos = [
    {
      titulo: "Saldo inicial",
      explicacion: sinSaldoCapturado
        ? "Nadie lo ha capturado todavía. Pulso no se conecta al banco, así que este dato lo pone una persona — y sin él no se puede proyectar el saldo del mes."
        : `Capturado a mano${
            data.openingBalance?.asOfDate ? ` con fecha ${data.openingBalance.asOfDate}` : ""
          }. Pulso no se conecta al banco: es el dinero que alguien reportó tener${
            data.openingBalance?.source === "COMPANY" && data.scope?.branchId
              ? ", y es el dato del grupo porque esta sucursal no tiene el suyo"
              : ""
          }.`,
    },
    {
      titulo: "Entradas por ventas",
      explicacion:
        inflow?.basis === "SEASONAL"
          ? `Promedio por día de la semana sobre los últimos ${inflow.lookbackDays} días (${inflow.historyDays} días con corte). Un sábado se proyecta con los sábados anteriores, no con el promedio general.`
          : inflow?.basis === "AVERAGE"
            ? `Promedio simple de ${inflow.historyDays} días con corte. Con menos de dos semanas de historial no alcanza para separar por día de la semana.`
            : "No hay cortes de venta capturados, así que no se estiman entradas. La proyección de saldo no se dibuja en vez de suponer cero.",
    },
    {
      titulo: "Fecha de pago de las OC",
      explicacion:
        "Se usa la fecha de entrega esperada de cada orden de compra. Si no tiene, o ya pasó, se estima a 14 días. No es la fecha real de pago al proveedor.",
    },
    {
      titulo: "Quincena",
      explicacion:
        "La nómina se coloca el 15 y el 30 de cada mes (28 en febrero), calculada desde los contratos activos. Si tu calendario de pago es otro, las fechas no coinciden.",
    },
  ];
  const faltante = sinSaldoCapturado
    ? "Necesita el saldo en caja y bancos para proyectar"
    : "Necesita cortes de venta para proyectar el saldo";

  // Comprometido que existe pero vence después de la ventana: se declara, no se
  // suma a las cifras de la proyección.
  const fueraDeVentanaRaw = data.procurementCommitments?.outsideWindow;
  const fueraDeVentana =
    fueraDeVentanaRaw &&
    (fueraDeVentanaRaw.purchaseOrdersCount > 0 || fueraDeVentanaRaw.invoicesCount > 0)
      ? fueraDeVentanaRaw
      : null;

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

    // Antes esto era `.slice(0, 14)` mientras las categorías, las semanas y el
    // CSV usaban 30: tres horizontes distintos en la misma pantalla, y sólo la
    // gráfica decía cuál era el suyo. Ahora todo describe la misma ventana.
    const totalInflow = days.reduce((sum, d) => sum + (d.projectedInflowCents ?? 0), 0);
    const totalOutflow = days.reduce((sum, d) => sum + d.projectedOutflowCents, 0);

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
  const chartData = days.map((pt) => ({
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
    // El nombre declara qué contiene: horizonte, alcance y fecha. Antes era
    // `flujo-efectivo-30d.csv` fijo — dos descargas de sucursales distintas se
    // pisaban en la carpeta y ninguna decía de cuál era.
    const alcanceArchivo = data.scope?.branchName
      ? data.scope.branchName.toLowerCase().replace(/\s+/g, "-")
      : "grupo";
    a.download = `flujo-efectivo-${horizonte}d-${alcanceArchivo}-${days[0].date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleOverdue = showAllOverdue ? overdueItems : overdueItems.slice(0, 5);

  /**
   * Acciones de una partida, o nada. Sólo gastos operativos: las OC y las
   * facturas de procurement no tienen estos endpoints, y un botón que va a
   * fallar es peor que ningún botón.
   */
  const accionesDeGasto = (item: OutflowItem) =>
    canActOnExpenses && item.source === "OPERATING_EXPENSE" && !item.isPayroll ? (
      <ExpenseRowActions
        expenseId={item.id}
        status={item.status}
        minDate={days[0]?.date ?? ""}
        onDone={onActionDone ?? (() => {})}
      />
    ) : null;
  // La sucursal se rotula en cada partida sólo cuando las cifras son del grupo:
  // repetirla en alcance de una sucursal, con la píldora arriba diciéndolo, es
  // ruido en filas que ya se truncan.
  const esAlcanceGrupo = !data.scope?.branchId;

  /**
   * Tarjeta de vencidos. Se define aquí, arriba del guard de "sin proyección",
   * para poder renderizarla en los dos caminos: son compromisos que ya pasaron
   * su fecha, y no dependen de que haya días proyectados.
   */
  const tarjetaVencidos = overdueItems.length > 0 && (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 space-y-3">
            <div>
              <h4 className="text-sm font-bold text-destructive">
                Gastos vencidos ({overdueItems.length})
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Estos compromisos ya pasaron su fecha de vencimiento y no están marcados como pagados.
              </p>
            </div>
            <div className="divide-y divide-destructive/10 rounded-md border border-destructive/20 bg-background">
              {visibleOverdue.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  trailing={
                    <div className="text-right shrink-0">
                      <p className="font-bold text-destructive tabular-nums">
                        {formatMXN(item.amountCents)}
                      </p>
                      <Badge
                        variant="outline"
                        className={`text-xs px-1 py-0 ${statusBadgeClasses("destructive")}`}
                      >
                        {STATUS_LABELS[item.status] || item.status}
                      </Badge>
                    </div>
                  }
                  actions={accionesDeGasto(item)}
                >
                  <div className="min-w-0 px-1 py-0.5">
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
                    <ItemMeta item={item} showBranch={esAlcanceGrupo} prefix="Venció" />
                  </div>
                </ItemRow>
              ))}
            </div>
            {overdueItems.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => alternarParam("vencidos", "todos", showAllOverdue)}
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
  );

  // Sin días proyectados no hay gráfica ni semanas, pero los vencidos siguen
  // siendo dinero que ya se debe. Antes este guard iba ANTES de la tarjeta de
  // vencidos, así que un inquilino con seis facturas vencidas y sin proyección
  // no veía ninguna: la pantalla que promete alertar se quedaba muda justo
  // cuando había algo que decir.
  if (!days.length) {
    return (
      <div className="space-y-6">
        {tarjetaVencidos}
        <EmptyState
          icon={Calendar}
          title="Todavía no hay proyección"
          description={
            overdueItems.length > 0
              ? "No hay días proyectados para este alcance. Los vencidos de arriba sí están al día."
              : "No hay gastos, órdenes de compra ni facturas en la ventana seleccionada."
          }
        />
      </div>
    );
  }

  const maxCategoryPct = Math.max(...categorySummary.map((c) => c.percentage), 1);

  return (
    <div className="space-y-6">
      {/* Para qué sucursal son estos números. Va arriba de todo y siempre
          visible: las cifras del grupo entero etiquetadas como una sucursal son
          peor que no tener el filtro. Rotula el alcance APLICADO — a un GERENTE
          que pide otra sucursal el servidor le devuelve la suya. */}
      {data.scope && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="gap-1.5 font-medium">
            <Building2 className="w-3 h-3" />
            {data.scope.branchName ?? (data.scope.branchId ? "Sucursal" : "Grupo completo")}
          </Badge>
          {/* `invoices.branch_id` es nullable: estas facturas quedaron fuera del
              cálculo por sucursal. Se dicen en voz alta en vez de desaparecer. */}
          {data.unassignedInvoicesCount != null && data.unassignedInvoicesCount > 0 && (
            <span className="text-muted-foreground">
              {data.unassignedInvoicesCount}{" "}
              {data.unassignedInvoicesCount === 1
                ? "factura sin sucursal asignada, no incluida"
                : "facturas sin sucursal asignada, no incluidas"}
            </span>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          FILA 1: ¿Me alcanza? — hero cards
          ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* El saldo se captura en la misma tarjeta que lo muestra: corregirlo no
            debería exigir salir de la pantalla que motivó la corrección. */}
        <OpeningBalanceCard
          balanceCents={initialBalanceCents}
          openingBalance={data.openingBalance}
          branchId={data.scope?.branchId ?? null}
          branchName={data.scope?.branchName ?? null}
          canEdit={canEditAssumptions}
          onSaved={onAssumptionSaved ?? (() => {})}
        />

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
            {sinProyeccionDeSaldo ? (
              <>
                <div className="text-2xl font-bold text-muted-foreground">
                  Sin estimar
                </div>
                <p className="text-xs text-muted-foreground mt-1">{faltante}</p>
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
            {sinProyeccionDeSaldo ? (
              <>
                <div className="text-2xl font-bold text-muted-foreground">
                  Sin estimar
                </div>
                <p className="text-xs text-muted-foreground mt-1">{faltante}</p>
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

      {/* ════════════════════════════════════════════════════════════
          Línea de supuestos: qué de esta pantalla es dato y qué es estimación.
          Las cuatro cargan toda la proyección y antes se presentaban como
          hechos, sin manera de saber de dónde salían.
          ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Supuestos:</span>
        {supuestos.map((s, i) => (
          <span key={s.titulo} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">·</span>}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  {s.titulo}
                  <HelpCircle className="w-3 h-3" aria-hidden="true" />
                  <span className="sr-only">— cómo se calcula</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-xs leading-relaxed" align="start">
                <p className="font-medium text-foreground mb-1">{s.titulo}</p>
                <p className="text-muted-foreground">{s.explicacion}</p>
              </PopoverContent>
            </Popover>
          </span>
        ))}
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

      {/* Lo comprometido que vence DESPUÉS de la ventana. Antes se sumaba a las
          cifras de arriba, así que la tira y "Total egresos" se contradecían
          describiendo la misma proyección. Ahora se dice aparte: sigue siendo
          dinero comprometido, sólo que más adelante. */}
      {fueraDeVentana && (
        <p className="text-xs text-muted-foreground px-3">
          Además hay{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatMXN(
              fueraDeVentana.purchaseOrdersTotalCents + fueraDeVentana.invoicesTotalCents
            )}
          </span>{" "}
          comprometidos que vencen después de esta ventana
          {fueraDeVentana.purchaseOrdersCount > 0 && (
            <> · {fueraDeVentana.purchaseOrdersCount} OC</>
          )}
          {fueraDeVentana.invoicesCount > 0 && (
            <>
              {" "}
              · {fueraDeVentana.invoicesCount}{" "}
              {fueraDeVentana.invoicesCount === 1 ? "factura" : "facturas"}
            </>
          )}
          . No se incluyen en las cifras de arriba.
        </p>
      )}

      {/* ════════════════════════════════════════════════════════════
          FILA 1.5: Facturas vencidas — ACCIÓN INMEDIATA
          ════════════════════════════════════════════════════════════ */}
      {tarjetaVencidos}

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
                  onClick={() => alternarParam("categorias", "todas", showAllCategories)}
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
                    <ItemRow
                      key={item.id}
                      item={item}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      trailing={
                        <p className="font-bold text-foreground shrink-0 tabular-nums">
                          {formatMXN(item.amountCents)}
                        </p>
                      }
                      actions={accionesDeGasto(item)}
                    >
                      <div className="min-w-0 px-1 py-0.5">
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
                        <ItemMeta item={item} showBranch={esAlcanceGrupo} prefix="Vence" />
                      </div>
                    </ItemRow>
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
            <h4 className="text-sm font-bold">Resumen {horizonte} días</h4>
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
              Proyección de Entradas vs Salidas (Próximos {horizonte} días)
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
              aria-label={`Flujo de efectivo: entradas vs salidas de los próximos ${horizonte} días`}
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
              <caption>Proyección de entradas y salidas (próximos {horizonte} días)</caption>
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

      {/* `payables` avisa que es de sólo consulta. Aquí el aviso cambia de
          sentido: esta pantalla SÍ escribe, pero no concilia contra el banco.
          Marcar pagado registra lo que la dueña sabe ("ya lo pagué"), no lo que
          el banco confirmó. Decirlo evita que un tablero en verde se lea como
          una conciliación que nadie hizo. */}
      {canActOnExpenses && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-px" />
          <span>
            <span className="font-semibold">Marcar pagado registra el gasto, no el movimiento
            bancario.</span>{" "}
            Pulso no se conecta a tu banco: queda anotado quién lo marcó y cuándo, pero la
            conciliación contra el estado de cuenta sigue siendo tuya.
          </span>
        </div>
      )}

      {/* Salida al detalle completo. Esta pantalla proyecta; el saldo real de lo
          que se debe, con su antigüedad y conciliación, vive en Cuentas por
          Pagar. */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/finance/payables">
            Ver Cuentas por Pagar
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
