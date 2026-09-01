/**
 * Desviación de facturas contra contratos recurrentes (renta, CFE, agua,
 * software). Implementación **única** de la regla: antes vivía duplicada en
 * `treasury-service.validateInvoiceAgainstContract` —que nadie llamaba— y en
 * `control-interno-service`, con criterios de severidad distintos. Dos
 * implementaciones de una regla de dinero, una sin ejecutar, es una invitación
 * a arreglar la equivocada.
 *
 * Este módulo decide *qué* se desvió; `control-interno-service` decide cómo se
 * redacta la excepción. Mismo reparto que `cash-variance-alert-service` con los
 * faltantes recurrentes.
 *
 * **Contra qué se compara** depende de lo que se contrató (Fase 2):
 *
 * - Una **renta** o una **licencia** tienen importe pactado. El
 *   `base_amount_cents` capturado es la verdad, y desviarse es un error de
 *   facturación o un aumento no avisado.
 * - Un **servicio medido** (`SERVICIO_BASICO`) no tiene importe pactado. Su
 *   referencia sale de su propio historial de recibos: mediana móvil. Un solo
 *   número capturado no puede describir el consumo eléctrico de un restaurante,
 *   y ensanchar la tolerancia hasta que calle el verano deja de detectar fugas.
 */

import { db } from "@/lib/db";
import { branches, invoices, recurringContracts } from "@/lib/db/schema";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { addCalendarDays, localDateString } from "@/lib/workflows/today";

// ---------------------------------------------------------------------------
// Ventanas y umbrales
// ---------------------------------------------------------------------------

/**
 * Días hacia atrás que mira la detección de desviaciones (V1.2).
 *
 * Antes eran "las últimas 5 facturas del proveedor" ordenadas por `created_at`
 * y sin filtro de fecha, así que un recibo de hace ocho meses seguía
 * apareciendo como excepción abierta para siempre — y una racha de facturas de
 * insumos del mismo proveedor empujaba el recibo de luz fuera de las cinco.
 *
 * 90 días y no 30: CFE factura bimestral, así que una ventana de un mes puede
 * no contener un solo recibo de luz. Con 90 cabe al menos uno de cada servicio
 * medido y unas tres rentas. Igual que `RECURRING_SHORTAGE`, un hallazgo se
 * cierra solo cuando su factura sale de la ventana: nadie tiene que marcarlo
 * como resuelto.
 */
export const CONTRACT_VARIANCE_WINDOW_DAYS = 90;

/**
 * Cuántos recibos entran en la mediana móvil de un servicio medido (V2.1).
 *
 * La ventana se mide en **recibos y no en meses** (D1): CFE factura bimestral y
 * el agua mensual, así que "los últimos seis meses" daría muestras de tamaño
 * distinto según el servicio y una de ellas demasiado chica para decir nada.
 * Seis recibos son un año de luz o medio de agua.
 */
export const ROLLING_REFERENCE_RECEIPTS = 6;

/**
 * Mínimo de recibos previos para que la mediana móvil sustituya a la base
 * capturada. Con menos se usa `base_amount_cents` y **se declara** que es el
 * capturado: un umbral que el sistema calculó solo y uno que el dueño capturó
 * no valen lo mismo, y la pantalla tiene que decir cuál está usando.
 *
 * Tres y no dos: la mediana de tres resiste un recibo de ajuste; la de dos es
 * el promedio de dos números y un solo outlier la mueve entera.
 */
export const MIN_ROLLING_RECEIPTS = 3;

/**
 * Historia que se lee para construir medianas y tendencia. Dos años cubren doce
 * recibos bimestrales, que es más de lo que cualquiera de los dos cálculos usa;
 * el resto se descarta para que un cambio de tarifa de 2024 no pese hoy.
 */
const HISTORY_LOOKBACK_DAYS = 730;

/**
 * Recibos por bloque en la comparación de tendencia (V2.3). Se compara la
 * mediana de los últimos 3 contra la de los 3 anteriores, así que hacen falta
 * 6 recibos para que la alerta exista.
 */
export const TREND_BLOCK_RECEIPTS = 3;

/**
 * Subida mínima entre bloques para llamarla tendencia, en %.
 *
 * Es el riesgo que introduce la base móvil: si el consumo sube y se queda
 * arriba, la mediana lo absorbe y la fuga se vuelve la nueva normalidad. La
 * tendencia mira la pendiente y no el recibo suelto, así que dispara aunque
 * cada factura caiga dentro de su tolerancia.
 */
export const TREND_RISE_PERCENT = 20;

/**
 * Qué contratos son de **servicio medido**.
 *
 * Sólo `SERVICIO_BASICO`. `MANTENIMIENTO` también es de monto variable —el
 * tablero de tesorería los agrupa juntos— pero no es medido: varía con lo que
 * se rompa, no con un consumo que el recibo anterior permita anticipar. Una
 * mediana de reparaciones no predice la siguiente reparación.
 */
function esServicioMedido(contractType: string): boolean {
  return contractType === "SERVICIO_BASICO";
}

/**
 * Fecha con la que se ubica una factura en el tiempo.
 *
 * `invoices.fecha` es la fecha del CFDI y es la correcta —es cuándo ocurrió el
 * consumo, no cuándo alguien lo capturó— pero es `text` y no siempre viene en
 * formato reconocible. Cuando no lo está se cae a `created_at`, que siempre
 * existe, en vez de dejar la factura fuera de toda ventana en silencio.
 */
const periodDateSql = sql`CASE
  WHEN substring(${invoices.fecha} from 1 for 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
  THEN substring(${invoices.fecha} from 1 for 10)::date
  ELSE ${invoices.createdAt}::date
END`;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Cómo se supo a qué contrato pertenece la factura.
 *
 * - `EXPLICIT`: la factura trae `recurring_contract_id`. Es la verdad capturada.
 * - `INFERRED`: se dedujo por (proveedor, sucursal) porque el candidato era
 *   único. Sirve para las facturas anteriores a la columna, pero es una
 *   deducción y el hallazgo la declara.
 */
export type ContractMatchBasis = "EXPLICIT" | "INFERRED";

/**
 * Contra qué se midió la desviación.
 *
 * - `CONTRACT_BASE`: el `base_amount_cents` que alguien capturó. Es lo correcto
 *   en un contrato pactado, y el arranque de un servicio medido sin historia.
 * - `ROLLING_MEDIAN`: la mediana de los recibos anteriores de ese contrato en
 *   esa sucursal. Es lo correcto en un servicio medido con historia.
 *
 * Se declara por el mismo motivo que el P&L declara `MEASURED`/`ESTIMATED`
 * renglón por renglón: un umbral calculado y uno capturado no valen igual.
 */
export type VarianceReferenceBasis = "CONTRACT_BASE" | "ROLLING_MEDIAN";

export interface ContractVarianceFinding {
  /** `ABOVE` = sobrecosto; `BELOW` = recibo anormalmente bajo. */
  kind: "ABOVE" | "BELOW";
  matchBasis: ContractMatchBasis;
  contractId: string;
  contractTitle: string;
  contractType: string;
  /** El monto capturado en el contrato. Se conserva aunque no sea la referencia. */
  baseAmountCents: number;
  /** Contra qué se comparó de verdad. */
  referenceCents: number;
  referenceBasis: VarianceReferenceBasis;
  /** Recibos que formaron la mediana. 0 cuando la referencia es la base capturada. */
  referenceSampleSize: number;
  toleranceAbovePercent: number;
  toleranceBelowPercent: number | null;
  invoiceId: string;
  invoiceFolio: string;
  invoiceTotalCents: number;
  /** Fecha con la que se ubicó la factura en la ventana (`YYYY-MM-DD`). */
  periodDate: string;
  /** Sucursal **de la factura**, no del contrato. Ver `getRecurringContractFindings`. */
  branchName: string;
  varianceCents: number;
  /** Desviación con un decimal. Positiva por arriba, negativa por abajo. */
  variancePercent: number;
  createdAt: Date;
}

/** Consumo que subió y se quedó arriba (V2.3). */
export interface ContractTrendFinding {
  contractId: string;
  contractTitle: string;
  contractType: string;
  /** Sucursal cuyos recibos formaron la serie. `null` en facturas sin asignar. */
  branchId: string | null;
  branchName: string;
  /** Mediana de los `TREND_BLOCK_RECEIPTS` recibos anteriores al bloque reciente. */
  previousMedianCents: number;
  /** Mediana de los `TREND_BLOCK_RECEIPTS` recibos más recientes. */
  recentMedianCents: number;
  /** Subida entre bloques, con un decimal. */
  risePercent: number;
  blockSize: number;
  /** Período del recibo más reciente del bloque. */
  latestPeriodDate: string;
  createdAt: Date;
}

export interface RecurringContractFindings {
  /** Desviaciones de una factura concreta contra su referencia. */
  variance: ContractVarianceFinding[];
  /** Consumos al alza sostenida, que ningún recibo suelto delata. */
  trend: ContractTrendFinding[];
}

/** Lo mínimo que la regla necesita de un contrato para evaluarse. */
interface ContractRule {
  baseAmountCents: number;
  varianceTolerancePercent: number;
  varianceToleranceBelowPercent: number | null;
}

/** Lo mínimo que el emparejador necesita de un contrato. */
interface ContractKey {
  id: string;
  supplierId: string;
  branchId: string | null;
}

/** Un recibo ya ligado a su contrato y a su sucursal. */
interface Recibo {
  invoiceId: string;
  contractId: string;
  branchId: string | null;
  periodDate: string;
  totalCents: number;
}

// ---------------------------------------------------------------------------
// La regla
// ---------------------------------------------------------------------------

/**
 * Compara un importe facturado contra su referencia.
 *
 * Pura y sin I/O a propósito: es la única definición de "esto se desvió" y
 * tiene que poder leerse completa de un vistazo. `referenceCents` se omite en
 * los contratos pactados, donde la referencia es la base capturada.
 */
export function evaluateContractVariance(
  contract: ContractRule,
  invoicedAmountCents: number,
  referenceCents: number = contract.baseAmountCents
): { kind: "ABOVE" | "BELOW" | "WITHIN"; varianceCents: number; variancePercent: number } {
  const varianceCents = invoicedAmountCents - referenceCents;
  // Referencia en cero: no hay porcentaje que calcular y ninguna desviación que
  // afirmar. Se devuelve "dentro" en vez de dividir entre cero.
  const variancePercent =
    referenceCents > 0 ? Math.round((varianceCents / referenceCents) * 1000) / 10 : 0;

  if (variancePercent > contract.varianceTolerancePercent) {
    return { kind: "ABOVE", varianceCents, variancePercent };
  }

  // `null` = el contrato no pidió alerta por debajo, que es lo correcto en una
  // renta. Sólo se evalúa cuando alguien la configuró a propósito.
  if (
    contract.varianceToleranceBelowPercent !== null &&
    variancePercent < -contract.varianceToleranceBelowPercent
  ) {
    return { kind: "BELOW", varianceCents, variancePercent };
  }

  return { kind: "WITHIN", varianceCents, variancePercent };
}

/**
 * A qué contrato pertenece una factura, o `null` si no se puede saber.
 *
 * El orden importa y no es arbitrario:
 *
 * 1. Si la factura trae contrato capturado, ése es y no se discute.
 * 2. Si no, se buscan contratos del mismo proveedor cuya sucursal sea
 *    exactamente la de la factura. El contrato de sucursal gana sobre el
 *    corporativo: es el más específico.
 * 3. Si no hay ninguno de sucursal, se admite el corporativo (`branchId` null).
 * 4. **Ante empate no se elige.** Dos contratos del mismo proveedor y sucursal
 *    con bases distintas —una renta y un mantenimiento— no se pueden separar
 *    sin la columna, y adivinar es exactamente lo que producía el falso
 *    positivo. Sin hallazgo es mejor que con hallazgo falso.
 */
export function resolveContract<T extends ContractKey>(
  invoice: { supplierId: string | null; branchId: string | null; recurringContractId: string | null },
  contracts: T[]
): { contract: T; basis: ContractMatchBasis } | null {
  if (invoice.recurringContractId) {
    const explicito = contracts.find((c) => c.id === invoice.recurringContractId);
    // Si el contrato capturado ya no está activo no se cae a la inferencia: la
    // factura ya declaró a cuál pertenece, y deducirle otro sería contradecirla.
    return explicito ? { contract: explicito, basis: "EXPLICIT" } : null;
  }

  if (!invoice.supplierId) return null;

  const delProveedor = contracts.filter((c) => c.supplierId === invoice.supplierId);
  const deSucursal = invoice.branchId
    ? delProveedor.filter((c) => c.branchId === invoice.branchId)
    : [];
  const candidatos =
    deSucursal.length > 0 ? deSucursal : delProveedor.filter((c) => c.branchId === null);

  return candidatos.length === 1 ? { contract: candidatos[0], basis: "INFERRED" } : null;
}

/** Mediana entera de una muestra no vacía. */
export function medianaCentavos(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 1
    ? orden[medio]
    : Math.round((orden[medio - 1] + orden[medio]) / 2);
}

/**
 * Referencia contra la que se juzga una factura.
 *
 * **Mediana y no promedio:** un recibo de ajuste al doble arrastra el promedio
 * y deja de detectar el siguiente.
 *
 * **Sólo recibos anteriores al que se juzga.** Es lo que congela el hallazgo:
 * releerlo un mes después devuelve el mismo número aunque hayan llegado recibos
 * nuevos, porque los posteriores nunca entran. Es también lo que evita que un
 * pico eleve su propia referencia y se absuelva solo. (Un recibo capturado
 * tarde pero con fecha anterior sí mueve la referencia — es el único caso, y es
 * el correcto: la historia cambió.)
 */
export function rollingReference(
  contract: { contractType: string; baseAmountCents: number },
  historial: Recibo[],
  hasta: { periodDate: string }
): { referenceCents: number; basis: VarianceReferenceBasis; sampleSize: number } {
  if (!esServicioMedido(contract.contractType)) {
    return { referenceCents: contract.baseAmountCents, basis: "CONTRACT_BASE", sampleSize: 0 };
  }

  const previos = historial
    .filter((r) => r.periodDate < hasta.periodDate)
    .sort((a, b) => a.periodDate.localeCompare(b.periodDate))
    .slice(-ROLLING_REFERENCE_RECEIPTS);

  if (previos.length < MIN_ROLLING_RECEIPTS) {
    return { referenceCents: contract.baseAmountCents, basis: "CONTRACT_BASE", sampleSize: 0 };
  }

  return {
    referenceCents: medianaCentavos(previos.map((r) => r.totalCents)),
    basis: "ROLLING_MEDIAN",
    sampleSize: previos.length,
  };
}

/**
 * ¿El consumo subió y se quedó arriba?
 *
 * Compara la mediana de los últimos `TREND_BLOCK_RECEIPTS` recibos contra la de
 * los `TREND_BLOCK_RECEIPTS` anteriores. Además de la subida se exige que
 * **todos** los recibos del bloque reciente estén por encima de la mediana
 * previa: si sólo uno la rebasa, es un pico y ya lo reporta la desviación por
 * factura; lo que esta alerta busca es el escalón que la mediana móvil va a
 * absorber si nadie lo mira.
 */
export function risingTrend(
  historial: Recibo[]
): { previousMedianCents: number; recentMedianCents: number; risePercent: number; latestPeriodDate: string } | null {
  const necesarios = TREND_BLOCK_RECEIPTS * 2;
  if (historial.length < necesarios) return null;

  const orden = [...historial].sort((a, b) => a.periodDate.localeCompare(b.periodDate));
  const bloque = orden.slice(-necesarios);
  const previos = bloque.slice(0, TREND_BLOCK_RECEIPTS).map((r) => r.totalCents);
  const recientes = bloque.slice(TREND_BLOCK_RECEIPTS).map((r) => r.totalCents);

  const previousMedianCents = medianaCentavos(previos);
  const recentMedianCents = medianaCentavos(recientes);
  if (previousMedianCents <= 0) return null;

  const risePercent =
    Math.round(((recentMedianCents - previousMedianCents) / previousMedianCents) * 1000) / 10;
  if (risePercent <= TREND_RISE_PERCENT) return null;
  if (!recientes.every((c) => c > previousMedianCents)) return null;

  return {
    previousMedianCents,
    recentMedianCents,
    risePercent,
    latestPeriodDate: bloque[bloque.length - 1].periodDate,
  };
}

// ---------------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------------

/**
 * Hallazgos de contratos recurrentes: desviaciones por factura y consumos al
 * alza sostenida.
 *
 * Cada factura se mide contra **un** contrato como máximo. Los contratos
 * corporativos (`branchId` null) sí se evalúan cuando el alcance es una
 * sucursal —el recibo de luz de esa sucursal es su desviación aunque el
 * contrato esté a nombre del grupo— pero el hallazgo se atribuye a la sucursal
 * **de la factura**, no al contrato. Rotular "Corporativo / Cadena" una
 * desviación que ocurrió en Condesa manda a revisar el medidor equivocado.
 *
 * Por la misma razón el historial se agrupa por (contrato, sucursal): la
 * mediana de un contrato corporativo mezclaría el consumo de locales de tamaños
 * distintos y no describiría ninguno.
 */
export async function getRecurringContractFindings(
  companyId: string,
  branchId?: string
): Promise<RecurringContractFindings> {
  const vacio: RecurringContractFindings = { variance: [], trend: [] };
  const hoy = localDateString(new Date(), null);
  const desdeVentana = addCalendarDays(hoy, -CONTRACT_VARIANCE_WINDOW_DAYS);
  const desdeHistoria = addCalendarDays(hoy, -HISTORY_LOOKBACK_DAYS);

  const contratos = await db.query.recurringContracts.findMany({
    where: and(
      eq(recurringContracts.companyId, companyId),
      eq(recurringContracts.active, true),
      // Con alcance de sucursal entran los suyos y los corporativos; los de
      // otras sucursales no. Antes el corporativo quedaba fuera y un gerente
      // nunca veía la desviación de su propio recibo.
      ...(branchId
        ? [or(eq(recurringContracts.branchId, branchId), isNull(recurringContracts.branchId))]
        : [])
    ),
  });

  if (contratos.length === 0) return vacio;

  const medidos = contratos.filter((c) => esServicioMedido(c.contractType));
  const [enVentana, historia] = await Promise.all([
    leerFacturas(companyId, branchId, desdeVentana, hoy, contratos),
    medidos.length > 0
      ? leerFacturas(companyId, branchId, desdeHistoria, hoy, medidos)
      : Promise.resolve([]),
  ]);

  if (enVentana.length === 0 && historia.length === 0) return vacio;

  const nombrePorSucursal = await sucursalNombres(companyId);
  const nombreDe = (id: string | null) =>
    id ? nombrePorSucursal.get(id) ?? "Sucursal" : "Sin sucursal asignada";

  // Historial agrupado por (contrato, sucursal de la factura).
  const historialPorBucket = new Map<string, Recibo[]>();
  for (const f of historia) {
    const match = resolveContract(f, contratos);
    if (!match) continue;
    const clave = bucket(match.contract.id, f.branchId);
    const lista = historialPorBucket.get(clave);
    const recibo: Recibo = {
      invoiceId: f.id,
      contractId: match.contract.id,
      branchId: f.branchId,
      periodDate: f.periodDate,
      totalCents: f.total,
    };
    if (lista) lista.push(recibo);
    else historialPorBucket.set(clave, [recibo]);
  }

  // --- Desviaciones por factura -------------------------------------------
  const variance: ContractVarianceFinding[] = [];
  for (const f of enVentana) {
    const match = resolveContract(f, contratos);
    if (!match) continue;

    const contrato = match.contract;
    const historial = historialPorBucket.get(bucket(contrato.id, f.branchId)) ?? [];
    const referencia = rollingReference(contrato, historial, { periodDate: f.periodDate });
    const { kind, varianceCents, variancePercent } = evaluateContractVariance(
      contrato,
      f.total,
      referencia.referenceCents
    );
    if (kind === "WITHIN") continue;

    variance.push({
      kind,
      matchBasis: match.basis,
      contractId: contrato.id,
      contractTitle: contrato.title,
      contractType: contrato.contractType,
      baseAmountCents: contrato.baseAmountCents,
      referenceCents: referencia.referenceCents,
      referenceBasis: referencia.basis,
      referenceSampleSize: referencia.sampleSize,
      toleranceAbovePercent: contrato.varianceTolerancePercent,
      toleranceBelowPercent: contrato.varianceToleranceBelowPercent,
      invoiceId: f.id,
      invoiceFolio: f.folio || f.uuid.slice(0, 8),
      invoiceTotalCents: f.total,
      periodDate: f.periodDate,
      branchName: nombreDe(f.branchId),
      varianceCents,
      variancePercent,
      createdAt: f.createdAt,
    });
  }

  // --- Tendencia -----------------------------------------------------------
  const trend: ContractTrendFinding[] = [];
  const contratoPorId = new Map(contratos.map((c) => [c.id, c]));
  for (const [clave, historial] of historialPorBucket) {
    const subida = risingTrend(historial);
    if (!subida) continue;
    // Igual que las desviaciones, la tendencia sale de la lista cuando su
    // recibo más nuevo sale de la ventana: si nadie factura en tres meses, el
    // hallazgo ya no describe lo que está pasando.
    if (subida.latestPeriodDate < desdeVentana) continue;

    const contrato = contratoPorId.get(historial[0].contractId);
    if (!contrato) continue;

    const sucursal = sucursalDeBucket(clave);
    trend.push({
      contractId: contrato.id,
      contractTitle: contrato.title,
      contractType: contrato.contractType,
      branchId: sucursal,
      branchName: nombreDe(sucursal),
      previousMedianCents: subida.previousMedianCents,
      recentMedianCents: subida.recentMedianCents,
      risePercent: subida.risePercent,
      blockSize: TREND_BLOCK_RECEIPTS,
      latestPeriodDate: subida.latestPeriodDate,
      createdAt: new Date(`${subida.latestPeriodDate}T12:00:00Z`),
    });
  }

  return { variance, trend };
}

/** Facturas de la empresa que pueden pertenecer a alguno de esos contratos. */
async function leerFacturas(
  companyId: string,
  branchId: string | undefined,
  desde: string,
  hasta: string,
  contratos: { id: string; supplierId: string }[]
) {
  const proveedores = [...new Set(contratos.map((c) => c.supplierId).filter(Boolean))];
  const contratoIds = contratos.map((c) => c.id);

  return db
    .select({
      id: invoices.id,
      folio: invoices.folio,
      uuid: invoices.uuid,
      total: invoices.total,
      branchId: invoices.branchId,
      supplierId: invoices.supplierId,
      recurringContractId: invoices.recurringContractId,
      createdAt: invoices.createdAt,
      periodDate: sql<string>`to_char(${periodDateSql}, 'YYYY-MM-DD')`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        ...(branchId ? [eq(invoices.branchId, branchId)] : []),
        gte(periodDateSql, sql`${desde}::date`),
        // Cota superior además de la inferior: una factura con fecha en el
        // futuro es un error de captura, y sin techo se reportaría para
        // siempre — el mismo defecto que la ventana viene a quitar.
        lte(periodDateSql, sql`${hasta}::date`),
        // Sólo lo que puede pertenecer a uno de estos contratos: o lo declara,
        // o es de un proveedor con contrato. Sin esto la consulta barre todos
        // los CFDI del período para descartarlos en memoria.
        proveedores.length > 0
          ? or(
              inArray(invoices.recurringContractId, contratoIds),
              and(isNull(invoices.recurringContractId), inArray(invoices.supplierId, proveedores))
            )
          : inArray(invoices.recurringContractId, contratoIds)
      )
    );
}

/**
 * Clave del historial. Contrato **y** sucursal: la mediana de un contrato
 * corporativo que mezclara locales de tamaños distintos no describiría ninguno.
 */
function bucket(contractId: string, branchId: string | null): string {
  return `${contractId}|${branchId ?? ""}`;
}

function sucursalDeBucket(clave: string): string | null {
  const sucursal = clave.slice(clave.indexOf("|") + 1);
  return sucursal === "" ? null : sucursal;
}

async function sucursalNombres(companyId: string): Promise<Map<string, string>> {
  const filas = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));
  return new Map(filas.map((b) => [b.id, b.name]));
}
