// M16 / T39: Cash Flow Projection Service
// Projects 30-day cash flow by aggregating:
//   - Estimated daily sales inflows
//   - Operating expenses (rent, services, maintenance, etc.)
//   - Purchase orders committed (APPROVED, SENT, PARTIALLY_RECEIVED)
//   - Invoices from procurement (CFDI XML received but not linked to a paid expense)

import { db } from "@/lib/db";
import { dailySalesCuts, operatingExpenses, invoices, purchaseOrders, suppliers, employeeContracts, users, branches, cashFlowAssumptions } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, inArray, asc, isNull } from "drizzle-orm";
import { addCalendarDays, localDateString } from "@/lib/workflows/today";

// ── Types ────────────────────────────────────────────────────────

export interface CashFlowDay {
  date: string;
  /** `null` cuando no hay historial de ventas del que estimar (`inflow.basis === 'NONE'`) */
  projectedInflowCents: number | null;
  projectedOutflowCents: number;
  /** `null` cuando no hay entradas estimadas: sin ellas no hay flujo neto que afirmar */
  netFlowCents: number | null;
  /** `null` cuando no hay entradas estimadas */
  cumulativeBalanceCents: number | null;
  outflowItemsCount: number;
  hasHighConcentration: boolean;
}

/**
 * De dónde salen las entradas proyectadas.
 *
 * - `SEASONAL`: promedio por día de la semana sobre la ventana histórica. Un
 *   restaurante no vende lo mismo un martes que un sábado; el promedio plano
 *   dibujaba una línea recta que no informaba nada.
 * - `AVERAGE`: promedio simple. Con menos de dos semanas de cortes, partir la
 *   muestra en siete no deja suficientes datos por día para decir nada.
 * - `NONE`: no hay un solo corte de venta. No se estima: se declara.
 */
export type InflowBasis = "SEASONAL" | "AVERAGE" | "NONE";

/**
 * De dónde salió el saldo inicial.
 *
 * - `BRANCH`: capturado para esta sucursal.
 * - `COMPANY`: capturado para el grupo; se usa cuando la sucursal no tiene el suyo.
 * - `NONE`: nadie lo ha capturado. No se inventa.
 */
export type OpeningBalanceSource = "BRANCH" | "COMPANY" | "NONE";

export interface OpeningBalance {
  source: OpeningBalanceSource;
  /** Fecha a la que corresponde el saldo capturado */
  asOfDate: string | null;
  /** Días transcurridos desde `asOfDate`; `null` sin captura */
  ageInDays: number | null;
  /** `true` cuando conviene volver a capturarlo (más de una semana) */
  isStale: boolean;
}

export interface InflowEstimate {
  basis: InflowBasis;
  /** Días distintos con corte dentro de la ventana histórica */
  historyDays: number;
  /** Ventana histórica leída, en días */
  lookbackDays: number;
  /** Promedio simple de los días con corte; `null` sin historial */
  avgDailyInflowCents: number | null;
}

export interface OutflowItem {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  status: string;
  isPayroll: boolean;
  /** Fuente del egreso para distinguir origen en el UI */
  source: "OPERATING_EXPENSE" | "PURCHASE_ORDER" | "PROCUREMENT_INVOICE";
  /** Nombre del proveedor (solo para PO y procurement invoices) */
  supplierName?: string;
}

export interface CategorySummary {
  category: string;
  amountCents: number;
  count: number;
  percentage: number;
}

export interface WeeklyAggregation {
  /** Identificador estable (`week-1`), independiente de la etiqueta que se pinte */
  key: string;
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalOutflowCents: number;
  itemCount: number;
  isHeavy: boolean;
  /** Días de la ventana que esta semana cubre de verdad (1..7) */
  dayCount: number;
  /** `true` cuando la ventana se corta a media semana */
  isPartial: boolean;
}

export interface CashFlowProjection {
  days: CashFlowDay[];
  outflowItems: OutflowItem[];
  categorySummary: CategorySummary[];
  weeklyAggregation: WeeklyAggregation[];
  overdueItems: OutflowItem[];
  upcomingItems: OutflowItem[];
  /**
   * Saldo del que arranca la proyección. `null` cuando nadie lo ha capturado:
   * el esquema no tiene banco ni libro mayor, así que no hay de dónde derivarlo
   * y la pantalla lo pide en vez de proyectar sobre una constante.
   */
  initialBalanceCents: number | null;
  /** De dónde salió el saldo inicial, para declararlo en pantalla */
  openingBalance: OpeningBalance;
  /** Sobre qué base se estimaron las entradas, para declararlo en pantalla */
  inflow: InflowEstimate;
  /**
   * Alcance con el que se calcularon estas cifras.
   *
   * Es el alcance **aplicado**, no el solicitado: a un GERENTE que pide otra
   * sucursal `enforceBranchScope` le devuelve la suya, y la pantalla tiene que
   * rotular lo que de verdad se calculó. Etiquetar cifras de grupo como si
   * fueran de una sucursal es peor que no tener el filtro.
   */
  scope: {
    branchId: string | null;
    branchName: string | null;
  };
  /**
   * Facturas pendientes sin sucursal asignada, excluidas del cálculo cuando el
   * alcance es una sucursal. `invoices.branch_id` es nullable: sin declararlas,
   * desaparecerían en silencio.
   */
  unassignedInvoicesCount: number;
  /**
   * PO + facturas comprometidas **incluidas en la proyección**.
   *
   * Antes esto sumaba todas las OC comprometidas y todas las facturas
   * pendientes, incluidas las que vencen fuera de la ventana, mientras la
   * proyección sólo admite las de adentro. Eran dos cifras en la misma pantalla
   * afirmando describir la misma proyección y sin coincidir nunca.
   *
   * Ahora los totales son los admitidos, y lo que queda fuera se declara aparte
   * en vez de desaparecer: sigue siendo dinero comprometido, sólo que después.
   */
  procurementCommitments: {
    purchaseOrdersCount: number;
    purchaseOrdersTotalCents: number;
    invoicesCount: number;
    invoicesTotalCents: number;
    /** Comprometido real que vence después de la ventana proyectada */
    outsideWindow: {
      purchaseOrdersCount: number;
      purchaseOrdersTotalCents: number;
      invoicesCount: number;
      invoicesTotalCents: number;
    };
  };
  /** Nómina real estimada desde contratos activos */
  payroll: {
    activeEmployees: number;
    monthlyTotalCents: number;
    biweeklyEstimateCents: number;
    /** Sucursales incluidas en el cálculo */
    branchCount: number;
  } | null;
}

// ── Constants ────────────────────────────────────────────────────

const PO_COMMITTED_STATUSES = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] as const;

/**
 * A partir de cuántos días un saldo capturado se considera viejo.
 *
 * No se rechaza —un saldo de hace nueve días sigue siendo mejor que ninguno—
 * pero la pantalla pide actualizarlo, porque cada día que pasa la proyección
 * arrastra un punto de partida más lejano.
 */
const OPENING_BALANCE_STALE_DAYS = 7;

/** Ventana histórica de cortes que alimenta la estimación de entradas. */
const INFLOW_LOOKBACK_DAYS = 90;
/**
 * Piso de días con corte para partir la muestra por día de la semana. Con menos
 * de dos semanas quedan uno o dos sábados: un promedio de esa muestra es ruido
 * presentado como estacionalidad.
 */
const MIN_DAYS_FOR_SEASONAL = 14;

/** Día de la semana (0=domingo) de un `YYYY-MM-DD`, leído sin zona horaria. */
function dayOfWeekOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Día del mes (1-31) de un `YYYY-MM-DD`, sin pasar por `Date`. */
function dayOfMonthOf(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

/** Mes (1-12) de un `YYYY-MM-DD`. */
function monthOf(dateStr: string): number {
  return Number(dateStr.slice(5, 7));
}

/**
 * Alcance de la proyección: qué sucursal y con qué reloj se decide "hoy".
 *
 * `branches.timezone` es la única fuente de husos del esquema — `companies` no
 * tiene columna. Con sucursal se usa la suya. Sin sucursal (grupo completo) se
 * usa la de las sucursales sólo cuando todas coinciden: un grupo repartido entre
 * Cancún y Tijuana no tiene un "hoy" único, y elegir la de una al azar sería
 * peor que caer al default de `localDateString` (America/Mexico_City).
 */
async function resolveProjectionScope(
  companyId: string,
  branchId?: string
): Promise<{ timeZone: string | null; branchName: string | null }> {
  if (branchId) {
    const [row] = await db
      .select({ timezone: branches.timezone, name: branches.name })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
      .limit(1);
    return { timeZone: row?.timezone ?? null, branchName: row?.name ?? null };
  }

  const zonas = await db
    .selectDistinct({ timezone: branches.timezone })
    .from(branches)
    .where(and(eq(branches.companyId, companyId), eq(branches.active, true)));

  const distintas = zonas.map((z) => z.timezone).filter(Boolean);
  return {
    timeZone: distintas.length === 1 ? distintas[0] : null,
    branchName: null,
  };
}

// ── Main function ────────────────────────────────────────────────

export async function getCashFlowProjection(
  companyId: string,
  days = 30,
  branchId?: string
): Promise<CashFlowProjection> {
  // Qué día es "hoy" se decide con el reloj de la sucursal, no con el del
  // servidor. `toISOString()` calcula en UTC: en UTC-6, después de las 6pm local
  // —la hora a la que una dueña revisa el dinero— la ventana se recorría un día
  // y las partidas saltaban entre "vencido" y "próximo".
  const { timeZone, branchName } = await resolveProjectionScope(companyId, branchId);
  const startDate = new Date();
  const startDateStr = localDateString(startDate, timeZone);
  // Último día que el timeline emite de verdad: el bucle de abajo produce `days`
  // filas (índices 0..days-1). Cerrar la ventana en `+days` admitía partidas de
  // un día que ninguna fila cubre — se cobraban en "Total egresos" y en ninguna
  // barra de la gráfica.
  const endDateStr = addCalendarDays(startDateStr, days - 1);

  // ── 0. Saldo inicial capturado ──────────────────────────────────
  //
  // Antes esto era `INITIAL_BALANCE = 2000000`: los mismos $20,000 para un café
  // de 3 sucursales y para un grupo hotelero de 15, renderizados en negritas
  // como "Saldo inicial proyectado". "Saldo mínimo", las bandas de color y "Te
  // alcanza para N días" heredaban esa invención.
  //
  // Se lee el supuesto de la sucursal y se cae al del grupo. Sin ninguno de los
  // dos, `null`: la pantalla pide el dato en vez de proyectar sobre una cifra
  // que nadie capturó.
  const supuestos = await db
    .select({
      branchId: cashFlowAssumptions.branchId,
      openingBalanceCents: cashFlowAssumptions.openingBalanceCents,
      asOfDate: cashFlowAssumptions.asOfDate,
    })
    .from(cashFlowAssumptions)
    .where(
      and(
        eq(cashFlowAssumptions.companyId, companyId),
        branchId
          ? sql`(${cashFlowAssumptions.branchId} = ${branchId} OR ${cashFlowAssumptions.branchId} IS NULL)`
          : isNull(cashFlowAssumptions.branchId)
      )
    );

  const supuestoSucursal = branchId
    ? supuestos.find((s) => s.branchId === branchId)
    : undefined;
  const supuestoGrupo = supuestos.find((s) => s.branchId === null);
  const supuesto = supuestoSucursal ?? supuestoGrupo;

  const openingBalanceSource: OpeningBalanceSource = supuestoSucursal
    ? "BRANCH"
    : supuestoGrupo
      ? "COMPANY"
      : "NONE";

  const initialBalanceCents = supuesto?.openingBalanceCents ?? null;
  const openingAsOfDate = supuesto?.asOfDate ?? null;
  const openingAgeInDays = openingAsOfDate
    ? Math.round(
        (Date.parse(`${startDateStr}T00:00:00Z`) -
          Date.parse(`${openingAsOfDate}T00:00:00Z`)) /
          86_400_000
      )
    : null;

  // ── 1. Entradas estimadas desde los cortes de venta ─────────────
  //
  // Antes esto era el promedio de TODA la historia aplicado plano a los 30 días:
  // la serie "Entradas" de la gráfica era una línea recta por construcción. Y el
  // fallback `1500000` era inalcanzable —`Number(daysCount || 1)` nunca da 0—,
  // así que un inquilino sin cortes recibía $0/día de entradas y estrenaba la
  // pantalla en rojo completo. Ahora: promedio por día de la semana sobre los
  // últimos 90 días, y sin historial se declara en vez de inventarse.
  const lookbackStartStr = addCalendarDays(startDateStr, -INFLOW_LOOKBACK_DAYS);

  const salesByDate = await db
    .select({
      businessDate: dailySalesCuts.businessDate,
      totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
    })
    .from(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, companyId),
        ...(branchId ? [eq(dailySalesCuts.branchId, branchId)] : []),
        gte(dailySalesCuts.businessDate, lookbackStartStr),
        lte(dailySalesCuts.businessDate, startDateStr)
      )
    )
    .groupBy(dailySalesCuts.businessDate);

  const historyDays = salesByDate.length;
  const historyTotalCents = salesByDate.reduce(
    (sum, row) => sum + Number(row.totalSales || 0),
    0
  );
  const avgDailyInflowCents =
    historyDays > 0 ? Math.round(historyTotalCents / historyDays) : null;

  const inflowBasis: InflowBasis =
    historyDays === 0
      ? "NONE"
      : historyDays >= MIN_DAYS_FOR_SEASONAL
        ? "SEASONAL"
        : "AVERAGE";

  // Promedio por día de la semana. Un día sin muestra en la ventana cae al
  // promedio simple: preferimos la cifra menos precisa a un hueco.
  const inflowByDayOfWeek: (number | null)[] = new Array(7).fill(null);
  if (inflowBasis === "SEASONAL") {
    const buckets: { total: number; count: number }[] = Array.from(
      { length: 7 },
      () => ({ total: 0, count: 0 })
    );
    for (const row of salesByDate) {
      const bucket = buckets[dayOfWeekOf(row.businessDate)];
      bucket.total += Number(row.totalSales || 0);
      bucket.count += 1;
    }
    for (let dow = 0; dow < 7; dow++) {
      inflowByDayOfWeek[dow] =
        buckets[dow].count > 0
          ? Math.round(buckets[dow].total / buckets[dow].count)
          : avgDailyInflowCents;
    }
  }

  /** Entradas estimadas para una fecha; `null` cuando no hay de dónde estimarlas. */
  const inflowFor = (dateStr: string): number | null => {
    if (inflowBasis === "NONE") return null;
    if (inflowBasis === "AVERAGE") return avgDailyInflowCents;
    return inflowByDayOfWeek[dayOfWeekOf(dateStr)] ?? avgDailyInflowCents;
  };

  // ── 2. Operating expenses (scheduled) ──────────────────────────
  const opExList = await db
    .select({
      id: operatingExpenses.id,
      dueDate: operatingExpenses.dueDate,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      category: operatingExpenses.category,
      status: operatingExpenses.status,
    })
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        ...(branchId ? [eq(operatingExpenses.branchId, branchId)] : []),
        gte(operatingExpenses.dueDate, startDateStr),
        lte(operatingExpenses.dueDate, endDateStr)
      )
    )
    .orderBy(asc(operatingExpenses.dueDate));

  // ── 3. Overdue operating expenses ──────────────────────────────
  const overdueOpEx = await db
    .select({
      id: operatingExpenses.id,
      dueDate: operatingExpenses.dueDate,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      category: operatingExpenses.category,
      status: operatingExpenses.status,
    })
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        ...(branchId ? [eq(operatingExpenses.branchId, branchId)] : []),
        sql`${operatingExpenses.dueDate} < ${startDateStr}`,
        sql`${operatingExpenses.status} != 'PAID'`
      )
    )
    .orderBy(asc(operatingExpenses.dueDate));

  // ── 4. Purchase Orders committed (APPROVED, SENT, PARTIALLY_RECEIVED) ──
  const poRows = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
      dateRequired: purchaseOrders.dateRequired,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        ...(branchId ? [eq(purchaseOrders.branchId, branchId)] : []),
        // Copia mutable en vez de `as any`: `inArray` no acepta un `readonly[]`,
        // pero el cast silenciaba también un cambio de valores del enum.
        inArray(purchaseOrders.status, [...PO_COMMITTED_STATUSES]),
        sql`${purchaseOrders.totalAmount} > 0`
      )
    )
    .orderBy(asc(purchaseOrders.expectedDeliveryDate));

  // ── 5. Procurement invoices (CFDI recibidos y todavía sin pagar) ──
  //
  // Antes esta consulta traía TODAS las facturas de la empresa sin filtro, con
  // la nota de que "representan pasivos reales una vez recibido el CFDI". Eso
  // era cierto para el pasivo, pero no para una PROYECCIÓN de salidas: una
  // factura ya liquidada seguía proyectándose como dinero por salir, para
  // siempre, y el saldo proyectado empeoraba solo con el paso del tiempo.
  //
  // Desde la migración 0040 hay estatus de pago. PAID ya salió de la cuenta y
  // CANCELLED nunca va a salir: ninguna de las dos es flujo futuro.
  //
  // El vencimiento también sale de ahí: `due_date` (fecha del CFDI + días de
  // crédito del proveedor) es cuándo se paga de verdad, no la fecha de emisión.
  //
  // `invoices.branch_id` es **nullable**, a diferencia de las otras cuatro
  // tablas. Filtrar con `= branchId` a secas haría desaparecer en silencio a las
  // facturas sin sucursal asignada: dinero real que la dueña debe, invisible
  // justo en la pantalla que promete alertarla. Se traen también las NULL, se
  // excluyen del cálculo y su conteo se declara en pantalla.
  const invRowsRaw = await db
    .select({
      id: invoices.id,
      folio: invoices.folio,
      total: invoices.total,
      fecha: invoices.fecha,
      dueDate: invoices.dueDate,
      branchId: invoices.branchId,
      nombreEmisor: invoices.nombreEmisor,
      supplierName: suppliers.name,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.paymentStatus, "PENDING"),
        ...(branchId
          ? [
              sql`(${invoices.branchId} = ${branchId} OR ${invoices.branchId} IS NULL)`,
            ]
          : [])
      )
    );

  const invRows = branchId
    ? invRowsRaw.filter((inv) => inv.branchId === branchId)
    : invRowsRaw;
  const unassignedInvoicesCount = branchId
    ? invRowsRaw.filter((inv) => inv.branchId === null).length
    : 0;

  // ── 6. Real payroll from active employee contracts ────────────
  const activeEmployees = await db
    .select({
      userId: employeeContracts.userId,
      monthlySalary: employeeContracts.monthlySalary,
      baseSalary: employeeContracts.baseSalary,
      branchId: users.branchId,
    })
    .from(employeeContracts)
    .innerJoin(users, eq(employeeContracts.userId, users.id))
    .where(
      and(
        eq(users.companyId, companyId),
        // La nómina sigue a la sucursal del empleado (`users.branchId`), no a la
        // del contrato: `employee_contracts.branch_id` es nullable y en la base
        // sembrada viene vacío.
        ...(branchId ? [eq(users.branchId, branchId)] : []),
        eq(employeeContracts.status, "ACTIVE")
      )
    );

  const activeCount = activeEmployees.length;
  const monthlyTotalCents = activeEmployees.reduce(
    (sum, e) => sum + (e.monthlySalary || (e.baseSalary || 0) * 30),
    0
  );
  const biweeklyPayrollCents = Math.round(monthlyTotalCents / 2);
  const payrollBranchSet = new Set(activeEmployees.map((e) => e.branchId).filter(Boolean));

  const payrollData = activeCount > 0 ? {
    activeEmployees: activeCount,
    monthlyTotalCents,
    biweeklyEstimateCents: biweeklyPayrollCents,
    branchCount: payrollBranchSet.size || 1,
  } : null;

  // ── 7. Build outflow items + by-date map ───────────────────────
  const allOutflowItems: OutflowItem[] = [];
  const outflowsByDate: Record<string, { amount: number; count: number; items: OutflowItem[] }> = {};

  const addItem = (item: OutflowItem) => {
    allOutflowItems.push(item);
    if (!outflowsByDate[item.date]) {
      outflowsByDate[item.date] = { amount: 0, count: 0, items: [] };
    }
    outflowsByDate[item.date].amount += item.amountCents;
    outflowsByDate[item.date].count += 1;
    outflowsByDate[item.date].items.push(item);
  };

  // 6a. Operating expenses
  for (const exp of opExList) {
    if (exp.dueDate) {
      addItem({
        id: exp.id,
        date: exp.dueDate,
        description: exp.description,
        amountCents: exp.amountCents,
        category: exp.category,
        status: exp.status,
        isPayroll: false,
        source: "OPERATING_EXPENSE",
      });
    }
  }

  // Comprometido admitido en la ventana vs. comprometido que vence después. Se
  // cuenta aquí, donde se decide la admisión, para que la tira de "Fuentes de
  // egresos" no pueda desviarse de lo que la proyección realmente incluyó.
  const admitido = {
    purchaseOrdersCount: 0,
    purchaseOrdersTotalCents: 0,
    invoicesCount: 0,
    invoicesTotalCents: 0,
  };
  const fueraDeVentana = {
    purchaseOrdersCount: 0,
    purchaseOrdersTotalCents: 0,
    invoicesCount: 0,
    invoicesTotalCents: 0,
  };

  // 6b. Purchase Orders → estimate outflow on expectedDeliveryDate or dateRequired
  for (const po of poRows) {
    // Use expectedDeliveryDate as proxy for payment date (typically 7-30 days after delivery)
    // Fallback to dateRequired, then to today + 14 days
    // `expected_delivery_date` y `date_required` son `timestamp`, no `date`: se
    // leen en la zona de la operación. Con `toISOString()` una entrega fechada a
    // las 19:00 del día 20 se cobraba el 21.
    let poDate = po.expectedDeliveryDate
      ? localDateString(new Date(po.expectedDeliveryDate), timeZone)
      : po.dateRequired
        ? localDateString(new Date(po.dateRequired), timeZone)
        : null;

    // If no date or date is in the past, estimate 14 days from now
    if (!poDate || poDate < startDateStr) {
      poDate = addCalendarDays(startDateStr, 14);
    }

    // Only include if within the projection window
    if (poDate >= startDateStr && poDate <= endDateStr) {
      const supplierLabel = po.supplierName || "Proveedor";
      addItem({
        id: po.id,
        date: poDate,
        description: `OC ${po.poNumber} — ${supplierLabel}`,
        amountCents: po.totalAmount || 0,
        category: "COMPRAS",
        status: po.status,
        isPayroll: false,
        source: "PURCHASE_ORDER",
        supplierName: po.supplierName || undefined,
      });
      admitido.purchaseOrdersCount += 1;
      admitido.purchaseOrdersTotalCents += po.totalAmount || 0;
    } else {
      fueraDeVentana.purchaseOrdersCount += 1;
      fueraDeVentana.purchaseOrdersTotalCents += po.totalAmount || 0;
    }
  }

  // 6c. Procurement invoices
  for (const inv of invRows) {
    // La salida se fecha en el VENCIMIENTO, no en la emisión. El comentario que
    // estaba aquí ("el pago suele vencer 15-30 días después de la emisión")
    // describía el problema sin corregirlo: la partida se colocaba en la fecha
    // del CFDI, así que una factura a 30 días aparecía saliendo el mismo día
    // que se recibió. `due_date` (migración 0040) ya trae esa fecha calculada
    // con los días de crédito del proveedor.
    //
    // Si `due_date` no se pudo derivar (fecha del CFDI ilegible), se cae a la
    // emisión: adelantar la salida es el error conservador — nunca hace creer
    // que hay más dinero del que hay.
    const invDate = inv.dueDate || inv.fecha;
    if (invDate && invDate >= startDateStr && invDate <= endDateStr) {
      const emitterLabel = inv.nombreEmisor || inv.supplierName || "Proveedor";
      addItem({
        id: inv.id,
        date: invDate,
        description: `Factura ${inv.folio || "S/N"} — ${emitterLabel}`,
        amountCents: inv.total,
        category: "COMPRAS",
        status: "POR PAGAR",
        isPayroll: false,
        source: "PROCUREMENT_INVOICE",
        supplierName: inv.nombreEmisor || inv.supplierName || undefined,
      });
      admitido.invoicesCount += 1;
      admitido.invoicesTotalCents += inv.total;
    } else {
      fueraDeVentana.invoicesCount += 1;
      fueraDeVentana.invoicesTotalCents += inv.total;
    }
  }

  // ── 7. Overdue items (OpEx vencidos) ──────────────────────────
  const overdueItems: OutflowItem[] = overdueOpEx.map((exp) => ({
    id: exp.id,
    date: exp.dueDate || "",
    description: exp.description,
    amountCents: exp.amountCents,
    category: exp.category,
    status: exp.status,
    isPayroll: false,
    source: "OPERATING_EXPENSE" as const,
  }));

  // ── 8. Build daily projection timeline ─────────────────────────
  const projectionDays: CashFlowDay[] = [];
  let runningBalance = initialBalanceCents ?? 0;

  for (let i = 0; i < days; i++) {
    const dateStr = addCalendarDays(startDateStr, i);

    // Nómina real el 15 y el 30 (desde contratos, no hardcodeada).
    //
    // Se agrega ANTES de leer el acumulado del día, y el acumulado se lee
    // DESPUÉS. `addItem` ya suma el monto y el conteo en `outflowsByDate`, así
    // que el código anterior —que capturaba `dayOutflows` primero, le sumaba a
    // mano `count += 1` y después calculaba `dayOutflows.amount + payrollExtra`—
    // cobraba la quincena dos veces en cualquier fecha que ya tuviera otro
    // egreso. La agregación semanal leía el mapa una sola vez, y por eso la
    // barra "Salidas", el total de la semana y "Total egresos" se contradecían.
    // El día se lee de la propia cadena de la fecha. `getDate()`/`getMonth()`
    // leían el reloj del servidor mientras `dateStr` era el corte UTC del mismo
    // instante: con datos reales la nómina caía en el 16 y el 31, no en el 15 y
    // el 30 (hallazgo de la Task 1).
    const dayOfMonth = dayOfMonthOf(dateStr);
    const isPayrollDay =
      dayOfMonth === 15 ||
      dayOfMonth === 30 ||
      (dayOfMonth === 28 && monthOf(dateStr) === 2); // Feb
    if (isPayrollDay && biweeklyPayrollCents > 0) {
      addItem({
        id: `payroll-${dateStr}`,
        date: dateStr,
        description: `Nómina quincenal (${activeCount} empleados)`,
        amountCents: biweeklyPayrollCents,
        category: "NOMINA",
        status: "PROGRAMADO",
        isPayroll: true,
        source: "OPERATING_EXPENSE",
      });
    }

    const dayOutflows = outflowsByDate[dateStr] || { amount: 0, count: 0, items: [] };
    const totalOutflow = dayOutflows.amount;
    const dayInflow = inflowFor(dateStr);

    // Sin entradas estimadas no hay flujo neto ni saldo acumulado que afirmar.
    // Restar los egresos contra cero produciría exactamente la pantalla roja
    // que un inquilino nuevo no se ha ganado.
    const netFlow = dayInflow === null ? null : dayInflow - totalOutflow;
    if (netFlow !== null) runningBalance += netFlow;

    // El saldo acumulado necesita las dos cosas: de dónde parte y cuánto entra.
    // Sin saldo capturado, la trayectoria arrancaría de cero y todo el mes se
    // vería en rojo por un dato que nadie dio.
    const saldoConocido = netFlow !== null && initialBalanceCents !== null;

    const hasHighConcentration =
      dayOutflows.count >= 3 ||
      (dayInflow !== null && totalOutflow > dayInflow * 2.5);

    projectionDays.push({
      date: dateStr,
      projectedInflowCents: dayInflow,
      projectedOutflowCents: totalOutflow,
      netFlowCents: netFlow,
      cumulativeBalanceCents: saldoConocido ? runningBalance : null,
      outflowItemsCount: dayOutflows.count,
      hasHighConcentration,
    });
  }

  // ── 9. Category summary ────────────────────────────────────────
  const categoryMap: Record<string, { amountCents: number; count: number }> = {};
  for (const item of allOutflowItems) {
    if (!categoryMap[item.category]) {
      categoryMap[item.category] = { amountCents: 0, count: 0 };
    }
    categoryMap[item.category].amountCents += item.amountCents;
    categoryMap[item.category].count += 1;
  }

  const totalCents = Object.values(categoryMap).reduce((s, c) => s + c.amountCents, 0);
  const categorySummary: CategorySummary[] = Object.entries(categoryMap)
    .map(([category, data]) => ({
      category,
      amountCents: data.amountCents,
      count: data.count,
      percentage: totalCents > 0 ? Math.round((data.amountCents / totalCents) * 100) : 0,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  // ── 10. Weekly aggregation ─────────────────────────────────────
  //
  // Con `days = 30`, `floor(i/7)+1` emite CINCO semanas: la última cubre 2 días
  // reales. Antes se le imprimía igual una etiqueta de 7 días —el rango salía de
  // `weekStart + 6` sin mirar dónde termina la ventana— y ese muñón casi vacío
  // entraba a la mediana, jalándola hacia abajo y marcando como "pesada"
  // cualquier semana normal. Falsas alarmas nacidas de una división entera.
  //
  // Ahora la semana parcial se rotula por los días que de verdad cubre y se
  // excluye de la mediana, pero se sigue mostrando: son egresos que existen.
  const weeklyMap: Record<string, WeeklyAggregation> = {};
  for (let i = 0; i < days; i++) {
    const dateStr = addCalendarDays(startDateStr, i);
    const weekNum = Math.floor(i / 7) + 1;
    const weekKey = `week-${weekNum}`;

    if (!weeklyMap[weekKey]) {
      weeklyMap[weekKey] = {
        key: weekKey,
        weekLabel: "",
        startDate: dateStr,
        endDate: dateStr,
        totalOutflowCents: 0,
        itemCount: 0,
        isHeavy: false,
        dayCount: 0,
        isPartial: false,
      };
    }

    const week = weeklyMap[weekKey];
    week.endDate = dateStr;
    week.dayCount += 1;

    const dayData = outflowsByDate[dateStr];
    if (dayData) {
      week.totalOutflowCents += dayData.amount;
      week.itemCount += dayData.count;
    }
  }

  const weeklyList = Object.values(weeklyMap);
  const formatoDia = (dateStr: string) =>
    new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  for (const week of weeklyList) {
    week.isPartial = week.dayCount < 7;
    const numero = week.key.replace("week-", "");
    week.weekLabel = `Semana ${numero} (${formatoDia(week.startDate)}-${formatoDia(week.endDate)})`;
  }

  // La mediana sale solo de las semanas completas: comparar una semana de 7 días
  // contra el total de un muñón de 2 no mide concentración, mide el calendario.
  const semanasCompletas = weeklyList.filter((w) => !w.isPartial);
  const baseMediana = semanasCompletas.length > 0 ? semanasCompletas : weeklyList;
  const amounts = baseMediana.map((w) => w.totalOutflowCents).sort((a, b) => a - b);
  const median = amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)] : 0;
  for (const week of weeklyList) {
    // Una semana parcial nunca se marca pesada: su total es más chico por
    // definición, no por estar descargada.
    week.isHeavy =
      !week.isPartial && week.totalOutflowCents > median * 1.5 && week.totalOutflowCents > 0;
  }

  // ── 11. Upcoming items (next 7 days) ───────────────────────────
  const sevenDaysFromNow = addCalendarDays(startDateStr, 7);
  const upcomingItems = allOutflowItems.filter(
    (item) => item.date >= startDateStr && item.date <= sevenDaysFromNow
  );

  return {
    days: projectionDays,
    outflowItems: allOutflowItems,
    categorySummary,
    weeklyAggregation: weeklyList,
    overdueItems,
    upcomingItems,
    initialBalanceCents,
    openingBalance: {
      source: openingBalanceSource,
      asOfDate: openingAsOfDate,
      ageInDays: openingAgeInDays,
      isStale:
        openingAgeInDays !== null && openingAgeInDays > OPENING_BALANCE_STALE_DAYS,
    },
    inflow: {
      basis: inflowBasis,
      historyDays,
      lookbackDays: INFLOW_LOOKBACK_DAYS,
      avgDailyInflowCents,
    },
    scope: {
      branchId: branchId ?? null,
      branchName,
    },
    unassignedInvoicesCount,
    procurementCommitments: {
      ...admitido,
      outsideWindow: fueraDeVentana,
    },
    payroll: payrollData,
  };
}
