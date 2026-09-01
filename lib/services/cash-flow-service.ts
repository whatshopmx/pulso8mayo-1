// M16 / T39: Cash Flow Projection Service
// Projects 30-day cash flow by aggregating:
//   - Estimated daily sales inflows
//   - Operating expenses (rent, services, maintenance, etc.)
//   - Purchase orders committed (APPROVED, SENT, PARTIALLY_RECEIVED)
//   - Invoices from procurement (CFDI XML received but not linked to a paid expense)

import { db } from "@/lib/db";
import { dailySalesCuts, operatingExpenses, invoices, purchaseOrders, suppliers, employeeContracts, users, branches, cashFlowAssumptions, payees } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, inArray, asc, isNull } from "drizzle-orm";
import { addCalendarDays, localDateString } from "@/lib/workflows/today";
import { projectRecurringContracts } from "@/lib/services/recurring-contract-projection";

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
  /**
   * Fuente del egreso para distinguir origen en el UI.
   *
   * `RECURRING_CONTRACT` no es un compromiso capturado como los otros tres: es
   * una obligación que se sabe que viene —la renta, la luz— proyectada desde el
   * contrato. Tiene valor propio porque sin ella "¿me alcanza?" ignora el gasto
   * más previsible del mes, pero no vale lo mismo que una factura recibida y la
   * pantalla no debe sumarlas sin decirlo.
   */
  source: "OPERATING_EXPENSE" | "PURCHASE_ORDER" | "PROCUREMENT_INVOICE" | "RECURRING_CONTRACT";
  /**
   * `true` cuando el importe es una estimación y no un pactado — un servicio
   * medido. Sólo lo llevan los recurrentes proyectados.
   */
  isEstimated?: boolean;
  /** Nombre del proveedor (solo para PO y procurement invoices) */
  supplierName?: string;
  /** Sucursal de la partida, para distinguirlas cuando el alcance es el grupo */
  branchId?: string | null;
  branchName?: string | null;
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
  /**
   * Contratos recurrentes proyectados en la ventana (renta, luz, agua).
   *
   * Va aparte del total de egresos a propósito: sirve para que la pantalla
   * pueda decir cuánto de lo proyectado es obligación estimada y no compromiso
   * capturado. `included: false` cuando quien mira los apagó.
   */
  recurringProjection: {
    included: boolean;
    itemCount: number;
    totalCents: number;
    /** De los anteriores, los de monto estimado (servicios medidos). */
    estimatedCount: number;
    estimatedTotalCents: number;
    /**
     * Períodos que NO se proyectaron porque ya existe factura o gasto
     * capturado. Se declara para distinguir "ya se capturó" de "no toca este
     * mes": proyectar y cobrar el mismo recibo miente al alza.
     */
    suppressedCount: number;
    suppressedTotalCents: number;
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

/**
 * Estados de un gasto en los que el dinero todavía no ha salido de la cuenta.
 *
 * `PAID` ya salió y `REJECTED` no saldrá nunca: ninguno es flujo futuro, y
 * contarlos infla la proyección. `PENDING_APPROVAL` sí cuenta — falta
 * autorizarlo, pero el compromiso existe.
 */
const OUTFLOW_PENDING_STATUSES = ["PENDING_APPROVAL", "APPROVED"] as const;

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
): Promise<{
  timeZone: string | null;
  branchName: string | null;
  /** Nombre por sucursal, para rotular cada partida en alcance de grupo */
  branchNames: Map<string, string>;
}> {
  // Una sola lectura de sucursales sirve para las tres cosas: la zona horaria,
  // el nombre del alcance y el rótulo de cada partida. Evita tres joins en las
  // consultas de egresos.
  const rows = await db
    .select({
      id: branches.id,
      name: branches.name,
      timezone: branches.timezone,
      active: branches.active,
    })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  const branchNames = new Map(rows.map((b) => [b.id, b.name]));

  if (branchId) {
    const propia = rows.find((b) => b.id === branchId);
    return {
      timeZone: propia?.timezone ?? null,
      branchName: propia?.name ?? null,
      branchNames,
    };
  }

  const distintas = [
    ...new Set(rows.filter((b) => b.active).map((b) => b.timezone).filter(Boolean)),
  ];
  return {
    timeZone: distintas.length === 1 ? distintas[0] : null,
    branchName: null,
    branchNames,
  };
}

// ── Captura del saldo inicial ────────────────────────────────────

/**
 * Guarda el saldo en caja y bancos del que arranca la proyección.
 *
 * Hay un supuesto por (compañía, sucursal), y `branchId` nulo es el del grupo,
 * así que esto es un upsert: capturar dos veces la misma sucursal actualiza,
 * no duplica. Los dos índices únicos de la tabla lo respaldan — el compuesto
 * para las sucursales y el parcial para la fila de grupo, que hace falta porque
 * Postgres trata los NULL como distintos entre sí.
 *
 * `companyId` y `updatedBy` vienen de la sesión, nunca del body.
 */
export async function saveCashFlowAssumption(opts: {
  companyId: string;
  branchId: string | null;
  openingBalanceCents: number;
  asOfDate: string;
  updatedBy: string;
}): Promise<void> {
  // `onConflictDoUpdate` no puede apuntar a los dos índices a la vez, y el
  // parcial ni siquiera es objetivo válido de `ON CONFLICT` sin repetir su
  // predicado. Se resuelve leyendo primero: la tabla tiene una fila por
  // (compañía, sucursal), así que la lectura es puntual.
  const [existente] = await db
    .select({ id: cashFlowAssumptions.id })
    .from(cashFlowAssumptions)
    .where(
      and(
        eq(cashFlowAssumptions.companyId, opts.companyId),
        opts.branchId
          ? eq(cashFlowAssumptions.branchId, opts.branchId)
          : isNull(cashFlowAssumptions.branchId)
      )
    )
    .limit(1);

  if (existente) {
    await db
      .update(cashFlowAssumptions)
      .set({
        openingBalanceCents: opts.openingBalanceCents,
        asOfDate: opts.asOfDate,
        updatedBy: opts.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(cashFlowAssumptions.id, existente.id));
    return;
  }

  await db.insert(cashFlowAssumptions).values({
    companyId: opts.companyId,
    branchId: opts.branchId,
    openingBalanceCents: opts.openingBalanceCents,
    asOfDate: opts.asOfDate,
    updatedBy: opts.updatedBy,
  });
}

// ── Main function ────────────────────────────────────────────────

export async function getCashFlowProjection(
  companyId: string,
  days = 30,
  branchId?: string,
  opts: {
    /**
     * Incluir los contratos recurrentes proyectados. Por omisión sí: que la
     * renta y la luz no aparezcan hasta que llegue el recibo es justo el
     * problema que esto viene a resolver. Se puede apagar desde la pantalla
     * para ver sólo lo capturado.
     */
    includeRecurringContracts?: boolean;
  } = {}
): Promise<CashFlowProjection> {
  const incluirRecurrentes = opts.includeRecurringContracts !== false;
  // Qué día es "hoy" se decide con el reloj de la sucursal, no con el del
  // servidor. `toISOString()` calcula en UTC: en UTC-6, después de las 6pm local
  // —la hora a la que una dueña revisa el dinero— la ventana se recorría un día
  // y las partidas saltaban entre "vencido" y "próximo".
  const { timeZone, branchName, branchNames } = await resolveProjectionScope(
    companyId,
    branchId
  );
  /** Rótulo de sucursal de una partida; `null` cuando no la tiene asignada. */
  const nombreSucursal = (id: string | null | undefined) =>
    id ? (branchNames.get(id) ?? null) : null;
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

  // ── 1. Entradas reales desde los cortes de venta registrados ─────
  //
  // No se extrapolan estimaciones ni supuestos hacia el futuro: sólo se cuentan
  // las ventas reales registradas en cortes de caja (`dailySalesCuts`).
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
        gte(dailySalesCuts.businessDate, startDateStr),
        lte(dailySalesCuts.businessDate, endDateStr)
      )
    )
    .groupBy(dailySalesCuts.businessDate);

  const actualSalesMap = new Map<string, number>(
    salesByDate.map((r) => [r.businessDate, Number(r.totalSales || 0)])
  );

  const historyDays = salesByDate.length;
  const historyTotalCents = salesByDate.reduce(
    (sum, row) => sum + Number(row.totalSales || 0),
    0
  );
  const avgDailyInflowCents =
    historyDays > 0 ? Math.round(historyTotalCents / historyDays) : null;

  const inflowBasis: InflowBasis = "NONE";

  /** Entradas basadas únicamente en cortes de caja reales registrados */
  const inflowFor = (dateStr: string): number => {
    return actualSalesMap.get(dateStr) ?? 0;
  };

  // ── 2. Operating expenses (scheduled) ──────────────────────────
  //
  // Sólo lo que todavía va a salir de la cuenta. `PAID` ya salió —y si se pagó
  // antes de la fecha del saldo capturado, contarlo aquí lo cobra dos veces— y
  // `REJECTED` no va a salir nunca. Incluir `PENDING_APPROVAL` es la lectura
  // conservadora: falta autorizarlo, pero el compromiso existe, y subestimar
  // egresos es el error caro en una pantalla que responde "¿me alcanza?".
  const opExList = await db
    .select({
      id: operatingExpenses.id,
      dueDate: operatingExpenses.dueDate,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      category: operatingExpenses.category,
      status: operatingExpenses.status,
      branchId: operatingExpenses.branchId,
      payeeName: payees.name,
    })
    .from(operatingExpenses)
    .leftJoin(payees, eq(operatingExpenses.payeeId, payees.id))
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        ...(branchId ? [eq(operatingExpenses.branchId, branchId)] : []),
        inArray(operatingExpenses.status, [...OUTFLOW_PENDING_STATUSES]),
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
      branchId: operatingExpenses.branchId,
      payeeName: payees.name,
    })
    .from(operatingExpenses)
    .leftJoin(payees, eq(operatingExpenses.payeeId, payees.id))
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        ...(branchId ? [eq(operatingExpenses.branchId, branchId)] : []),
        sql`${operatingExpenses.dueDate} < ${startDateStr}`,
        // Era `!= 'PAID'`, así que un gasto RECHAZADO vencido se cobraba como
        // deuda. Mismo criterio que los proyectados: lo que todavía va a salir.
        inArray(operatingExpenses.status, [...OUTFLOW_PENDING_STATUSES])
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
      branchId: purchaseOrders.branchId,
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
        // Un gasto operativo tiene contraparte (`payees`), no proveedor. Es lo
        // que distingue "Renta" de "Renta" entre seis filas truncadas.
        supplierName: exp.payeeName || undefined,
        branchId: exp.branchId,
        branchName: nombreSucursal(exp.branchId),
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
        branchId: po.branchId,
        branchName: nombreSucursal(po.branchId),
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
        branchId: inv.branchId,
        branchName: nombreSucursal(inv.branchId),
      });
      admitido.invoicesCount += 1;
      admitido.invoicesTotalCents += inv.total;
    } else {
      fueraDeVentana.invoicesCount += 1;
      fueraDeVentana.invoicesTotalCents += inv.total;
    }
  }

  // 6d. Contratos recurrentes proyectados
  //
  // Se agregan aquí, después de gastos, OC y facturas, porque la supresión por
  // período ya se resolvió contra la base de datos dentro del proyector: un
  // recurrente cuyo recibo ya se capturó no llega hasta este punto.
  const recurrentes = incluirRecurrentes
    ? await projectRecurringContracts({
        companyId,
        branchId,
        startDate: startDateStr,
        endDate: endDateStr,
      })
    : { items: [], suppressed: { count: 0, totalCents: 0 } };

  let recurrentesTotal = 0;
  let recurrentesEstimados = 0;
  let recurrentesEstimadosTotal = 0;
  for (const r of recurrentes.items) {
    addItem({
      // El id lleva la fecha: un contrato mensual produce varias partidas en
      // una ventana de 30 días y `key={item.id}` en React las colapsaría.
      id: `recurring-${r.contractId}-${r.date}`,
      date: r.date,
      description: r.supplierName
        ? `${r.contractTitle} — ${r.supplierName}`
        : r.contractTitle,
      amountCents: r.amountCents,
      category: r.contractType,
      status: r.isEstimated ? "ESTIMADO" : "PROGRAMADO",
      isPayroll: false,
      source: "RECURRING_CONTRACT",
      isEstimated: r.isEstimated,
      supplierName: r.supplierName || undefined,
      branchId: r.branchId,
      branchName: nombreSucursal(r.branchId),
    });
    recurrentesTotal += r.amountCents;
    if (r.isEstimated) {
      recurrentesEstimados += 1;
      recurrentesEstimadosTotal += r.amountCents;
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
    supplierName: exp.payeeName || undefined,
    branchId: exp.branchId,
    branchName: nombreSucursal(exp.branchId),
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
    recurringProjection: {
      included: incluirRecurrentes,
      itemCount: recurrentes.items.length,
      totalCents: recurrentesTotal,
      estimatedCount: recurrentesEstimados,
      estimatedTotalCents: recurrentesEstimadosTotal,
      suppressedCount: recurrentes.suppressed.count,
      suppressedTotalCents: recurrentes.suppressed.totalCents,
    },
    payroll: payrollData,
  };
}
