/**
 * Proyección de contratos recurrentes en el flujo de efectivo (Fase 3).
 *
 * Hasta aquí las salidas del proyector a 30 días venían sólo de gastos
 * operativos, órdenes de compra y facturas de compras. La nómina **sí** se
 * proyectaba desde contratos; la renta, la luz y el agua no. Así, la obligación
 * recurrente era invisible para "¿me alcanza?" hasta que alguien capturaba el
 * recibo — que en un servicio de monto variable es justo cuando ya no se puede
 * hacer nada al respecto.
 *
 * Dos cuidados que definen el módulo:
 *
 * 1. **Un recurrente proyectado no es un compromiso real.** Se marca con su
 *    propia procedencia para que la pantalla no lo sume como si lo fuera, y se
 *    puede apagar entero.
 * 2. **Nunca se cuenta dos veces.** En cuanto existe factura o gasto capturado
 *    de ese período, la proyección de ese período se apaga: proyectar y cobrar
 *    el mismo recibo miente al alza, que es la dirección peligrosa — hace creer
 *    que hay menos dinero del que hay y puede frenar una compra necesaria.
 */

import { db } from "@/lib/db";
import { invoices, operatingExpenses, recurringContracts, suppliers } from "@/lib/db/schema";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  esServicioMedido,
  getMeteredPeriodReferences,
  resolveContract,
} from "@/lib/services/recurring-contract-variance";

// ---------------------------------------------------------------------------
// Frecuencias
// ---------------------------------------------------------------------------

/**
 * Cada cuánto vuelve a caer el pago. El vocabulario es el que ya usan el alta
 * de contratos y el tablero de tesorería, alias en español incluidos: cambiarlo
 * aquí haría que la proyección y el KPI de compromiso describieran calendarios
 * distintos con los mismos datos.
 *
 * `days` para lo sub-mensual y `months` para el resto: sumar "medio mes" no es
 * una operación de calendario, y sumar 30 días doce veces no cae en el mismo
 * día del mes.
 */
const FRECUENCIAS: Record<string, { days?: number; months?: number }> = {
  WEEKLY: { days: 7 },
  SEMANAL: { days: 7 },
  BIWEEKLY: { days: 14 },
  QUINCENAL: { days: 14 },
  MONTHLY: { months: 1 },
  MENSUAL: { months: 1 },
  BIMONTHLY: { months: 2 },
  BIMESTRAL: { months: 2 },
  QUARTERLY: { months: 3 },
  TRIMESTRAL: { months: 3 },
  SEMIANNUAL: { months: 6 },
  SEMESTRAL: { months: 6 },
  ANNUAL: { months: 12 },
  ANUAL: { months: 12 },
};

/**
 * Tope de ocurrencias que se generan por contrato. La ventana del proyector es
 * de 30 días y la frecuencia más corta es semanal, así que cinco sobran; existe
 * para que un `startDate` corrupto no convierta el generador en un bucle
 * infinito en una pantalla de dinero.
 */
const MAX_OCURRENCIAS = 8;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * De dónde salió el importe proyectado.
 *
 * - `CONTRACT_BASE`: el monto capturado. En una renta es el importe pactado y
 *   por tanto un compromiso firme; en un servicio medido sin historia es lo
 *   único que hay, y entonces sí es una estimación.
 * - `ROLLING_MEDIAN`: la mediana de lo que ese contrato costó por período. Es
 *   siempre una estimación.
 */
export type RecurringProjectionBasis = "CONTRACT_BASE" | "ROLLING_MEDIAN";

export interface RecurringOutflow {
  contractId: string;
  contractTitle: string;
  contractType: string;
  supplierName: string | null;
  branchId: string | null;
  /** Fecha del pago proyectado, `YYYY-MM-DD`. */
  date: string;
  amountCents: number;
  basis: RecurringProjectionBasis;
  /**
   * `true` cuando el importe es una estimación y no un pactado. Un servicio
   * medido siempre lo es, con o sin historia: nadie pactó cuánta luz se va a
   * consumir el mes que viene.
   */
  isEstimated: boolean;
  /** Períodos que formaron la mediana. 0 cuando el importe es el capturado. */
  referenceSampleSize: number;
  paymentFrequency: string;
}

export interface RecurringProjection {
  items: RecurringOutflow[];
  /**
   * Períodos que NO se proyectaron porque ya existe factura o gasto capturado.
   * Se cuentan y se declaran en vez de desaparecer: que un recurrente no
   * aparezca en el calendario tiene dos causas muy distintas —ya se capturó, o
   * el contrato no toca este mes— y la pantalla debe poder decir cuál.
   */
  suppressed: { count: number; totalCents: number };
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

/** Suma meses conservando el día, recortando al último día del mes destino. */
function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const totalMes = m - 1 + months;
  const anio = y + Math.floor(totalMes / 12);
  const mes = ((totalMes % 12) + 12) % 12;
  // El 31 de enero + 1 mes no existe. Recortar al 28/29/30 es lo que hace
  // cualquier arrendador; desbordar a marzo movería el pago de mes.
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Suma días de calendario a un `YYYY-MM-DD`, anclando al mediodía UTC. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fechas de pago de un contrato que caen dentro de `[desde, hasta]`.
 *
 * `start_date` es la fecha del próximo vencimiento —así la rotula el alta de
 * contratos— y el día del mes que lleva es el día de pago. Desde ahí se avanza
 * por la frecuencia; si la fecha viene de hace años, se avanza hasta alcanzar
 * la ventana antes de empezar a emitir.
 */
export function occurrencesBetween(
  startDate: string,
  paymentFrequency: string,
  desde: string,
  hasta: string,
  endDate?: string | null
): string[] {
  const paso = FRECUENCIAS[(paymentFrequency || "").toUpperCase()] ?? { months: 1 };
  const avanzar = (fecha: string) =>
    paso.days ? addDays(fecha, paso.days) : addMonths(fecha, paso.months ?? 1);

  let cursor = startDate;
  // Un contrato con fecha vieja: se salta hacia adelante sin emitir. El tope
  // por frecuencia evita recorrer década a década en pasos semanales.
  let saltos = 0;
  while (cursor < desde && saltos < 2000) {
    const siguiente = avanzar(cursor);
    // Frecuencia que no avanza (fecha corrupta): se aborta en vez de colgarse.
    if (siguiente <= cursor) return [];
    cursor = siguiente;
    saltos += 1;
  }

  const fechas: string[] = [];
  while (cursor <= hasta && fechas.length < MAX_OCURRENCIAS) {
    if (endDate && cursor > endDate) break;
    if (cursor >= desde) fechas.push(cursor);
    const siguiente = avanzar(cursor);
    if (siguiente <= cursor) break;
    cursor = siguiente;
  }
  return fechas;
}

// ---------------------------------------------------------------------------
// Proyección
// ---------------------------------------------------------------------------

/**
 * Pagos recurrentes que caen en la ventana, con el período ya capturado
 * excluido.
 */
export async function projectRecurringContracts(opts: {
  companyId: string;
  branchId?: string;
  /** Primer día de la ventana, `YYYY-MM-DD`. */
  startDate: string;
  /** Último día de la ventana, `YYYY-MM-DD`. */
  endDate: string;
}): Promise<RecurringProjection> {
  const vacio: RecurringProjection = { items: [], suppressed: { count: 0, totalCents: 0 } };

  const contratos = await db
    .select({
      id: recurringContracts.id,
      title: recurringContracts.title,
      contractType: recurringContracts.contractType,
      supplierId: recurringContracts.supplierId,
      branchId: recurringContracts.branchId,
      baseAmountCents: recurringContracts.baseAmountCents,
      paymentFrequency: recurringContracts.paymentFrequency,
      startDate: recurringContracts.startDate,
      endDate: recurringContracts.endDate,
      supplierName: suppliers.name,
      payeeId: suppliers.payeeId,
    })
    .from(recurringContracts)
    .leftJoin(suppliers, eq(recurringContracts.supplierId, suppliers.id))
    .where(
      and(
        eq(recurringContracts.companyId, opts.companyId),
        eq(recurringContracts.active, true),
        // Con alcance de sucursal entran los suyos y los corporativos: la renta
        // del local se paga aunque el contrato esté a nombre del grupo.
        ...(opts.branchId
          ? [
              or(
                eq(recurringContracts.branchId, opts.branchId),
                isNull(recurringContracts.branchId)
              ),
            ]
          : [])
      )
    );

  if (contratos.length === 0) return vacio;

  // Ocurrencias primero: si ninguna cae en la ventana no hace falta leer
  // referencias ni consultar lo ya capturado.
  const candidatos: { contrato: (typeof contratos)[number]; fecha: string }[] = [];
  for (const c of contratos) {
    const inicio = fechaISO(c.startDate);
    if (!inicio) continue;
    for (const fecha of occurrencesBetween(
      inicio,
      c.paymentFrequency,
      opts.startDate,
      opts.endDate,
      fechaISO(c.endDate)
    )) {
      candidatos.push({ contrato: c, fecha });
    }
  }

  if (candidatos.length === 0) return vacio;

  const periodos = [...new Set(candidatos.map((x) => x.fecha.slice(0, 7)))].sort();
  const [referencias, capturados] = await Promise.all([
    getMeteredPeriodReferences(opts.companyId, opts.branchId),
    periodosYaCapturados(opts.companyId, opts.branchId, contratos, periodos),
  ]);

  const items: RecurringOutflow[] = [];
  const suppressed = { count: 0, totalCents: 0 };

  for (const { contrato, fecha } of candidatos) {
    const medido = esServicioMedido(contrato.contractType);
    const referencia = medido ? referencias.get(contrato.id) : undefined;
    const amountCents = referencia?.referenceCents ?? contrato.baseAmountCents;

    if (capturados.has(`${contrato.id}|${fecha.slice(0, 7)}`)) {
      suppressed.count += 1;
      suppressed.totalCents += amountCents;
      continue;
    }

    items.push({
      contractId: contrato.id,
      contractTitle: contrato.title,
      contractType: contrato.contractType,
      supplierName: contrato.supplierName ?? null,
      branchId: contrato.branchId,
      date: fecha,
      amountCents,
      basis: referencia ? "ROLLING_MEDIAN" : "CONTRACT_BASE",
      // Un servicio medido es estimación aunque el importe salga de la base
      // capturada: nadie pactó cuánta luz se va a consumir. Una renta con su
      // importe pactado, en cambio, no lo es.
      isEstimated: medido,
      referenceSampleSize: referencia?.periodCount ?? 0,
      paymentFrequency: contrato.paymentFrequency,
    });
  }

  return { items, suppressed };
}

/**
 * `contratoId|YYYY-MM` de los períodos que ya tienen documento capturado.
 *
 * Dos fuentes, porque la renta puede llegar por cualquiera de las dos:
 *
 * - **Factura**: se liga al contrato con la misma resolución que usa la
 *   detección de desviaciones, así que un CFDI ambiguo no apaga nada.
 * - **Gasto operativo**: no existe columna que lo ligue a un contrato, así que
 *   se cruza por la contraparte del proveedor (`suppliers.payee_id`). Un
 *   proveedor sin contraparte capturada no puede apagar nada — se prefiere
 *   proyectar de más a apagar el recurrente equivocado.
 */
async function periodosYaCapturados(
  companyId: string,
  branchId: string | undefined,
  contratos: {
    id: string;
    supplierId: string;
    branchId: string | null;
    payeeId: string | null;
  }[],
  periodos: string[]
): Promise<Set<string>> {
  const capturados = new Set<string>();
  if (periodos.length === 0) return capturados;

  const desde = `${periodos[0]}-01`;
  const hasta = finDeMes(periodos[periodos.length - 1]);

  // --- Facturas -----------------------------------------------------------
  const contratoIds = contratos.map((c) => c.id);
  const proveedores = [...new Set(contratos.map((c) => c.supplierId).filter(Boolean))];

  const facturas = await db
    .select({
      branchId: invoices.branchId,
      supplierId: invoices.supplierId,
      recurringContractId: invoices.recurringContractId,
      total: invoices.total,
      periodDate: sql<string>`to_char(CASE
        WHEN substring(${invoices.fecha} from 1 for 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
        THEN substring(${invoices.fecha} from 1 for 10)::date
        ELSE ${invoices.createdAt}::date
      END, 'YYYY-MM-DD')`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        ...(branchId ? [eq(invoices.branchId, branchId)] : []),
        sql`CASE
          WHEN substring(${invoices.fecha} from 1 for 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
          THEN substring(${invoices.fecha} from 1 for 10)::date
          ELSE ${invoices.createdAt}::date
        END BETWEEN ${desde}::date AND ${hasta}::date`,
        proveedores.length > 0
          ? or(
              inArray(invoices.recurringContractId, contratoIds),
              and(isNull(invoices.recurringContractId), inArray(invoices.supplierId, proveedores))
            )
          : inArray(invoices.recurringContractId, contratoIds)
      )
    );

  for (const f of facturas) {
    const match = resolveContract(f, contratos);
    if (!match) continue;
    capturados.add(`${match.contract.id}|${f.periodDate.slice(0, 7)}`);
  }

  // --- Gastos operativos --------------------------------------------------
  const payeeIds = [...new Set(contratos.map((c) => c.payeeId).filter(Boolean))] as string[];
  if (payeeIds.length === 0) return capturados;

  const gastos = await db
    .select({
      payeeId: operatingExpenses.payeeId,
      branchId: operatingExpenses.branchId,
      dueDate: operatingExpenses.dueDate,
    })
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        ...(branchId ? [eq(operatingExpenses.branchId, branchId)] : []),
        inArray(operatingExpenses.payeeId, payeeIds),
        gte(operatingExpenses.dueDate, desde),
        lte(operatingExpenses.dueDate, hasta),
        // Un gasto rechazado no capturó nada: no debe apagar la proyección.
        sql`${operatingExpenses.status} <> 'REJECTED'`
      )
    );

  for (const g of gastos) {
    if (!g.dueDate || !g.payeeId) continue;
    const periodo = g.dueDate.slice(0, 7);
    for (const c of contratos) {
      if (c.payeeId !== g.payeeId) continue;
      // Un gasto de sucursal sólo apaga el contrato de esa sucursal o el
      // corporativo; nunca el de la sucursal de al lado.
      if (c.branchId && g.branchId && c.branchId !== g.branchId) continue;
      capturados.add(`${c.id}|${periodo}`);
    }
  }

  return capturados;
}

/** `YYYY-MM-DD` de un `Date`/`string` del esquema, o `null` si no se puede leer. */
function fechaISO(valor: Date | string | null | undefined): string | null {
  if (!valor) return null;
  if (typeof valor === "string") return valor.slice(0, 10);
  const t = valor.getTime();
  return Number.isNaN(t) ? null : valor.toISOString().slice(0, 10);
}

/** Último día de un `YYYY-MM`, en `YYYY-MM-DD`. */
function finDeMes(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const dia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${periodo}-${String(dia).padStart(2, "0")}`;
}
