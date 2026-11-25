/**
 * NOM-02.d1 — Cálculo de ISR ordinario por período (Art. 96 LISR + Art. 175 RLISR).
 *
 * Reutiliza la tarifa mensual oficial y el subsidio al empleo registrados en
 * `lib/services/isr-annual-withholding.ts`:
 * - Anexo 8 RMF 2026 (DOF 28-dic-2025), apartado B fr. V (Tarifa mensual Art. 96 LISR).
 * - Decreto Subsidio para el Empleo (DOF 31-dic-2025): 15.02% × UMA mensual feb–dic ($535.65),
 *   15.59% × UMA mensual 2025 enero ($536.21), tope de ingreso mensual $11,492.66.
 * - Períodos sub-mensuales (semanal 7d, decenal 10d, catorcenal 14d, quincenal 15d):
 *   procedimiento proporcional de Art. 175 RLISR / factor 30.4 días por mes.
 *
 * Garantías:
 * - Nunca inventa ni extrapola tarifas para ejercicios sin tabla oficial publicada:
 *   devuelve `status: "MISSING_CONFIG"` para bloquear aprobación/timbrado.
 * - Todos los montos en centavos enteros.
 */

import { differenceInDays, parseISO } from "date-fns";
import {
  calcularISRMensual96,
  FACTOR_NOTIONAL_174,
  resolverTarifaParaAnio,
} from "./isr-annual-withholding";

export type PayrollPeriodicity = "WEEKLY" | "BIWEEKLY" | "QUINCENAL" | "MONTHLY" | "CUSTOM";

export interface ResolveOrdinaryIsrInput {
  /** Base gravable de ISR del período en centavos enteros (>= 0). */
  taxableBaseCents: number;
  /** Fecha de inicio del período (YYYY-MM-DD). */
  periodStart: string;
  /** Fecha de fin / pago del período (YYYY-MM-DD). Define año y mes de vigencia. */
  periodEnd: string;
  /** Días calendario del período (opcional; se deriva de periodStart..periodEnd). */
  periodDays?: number;
  /** Periodicidad declarada del contrato/nómina (opcional). */
  periodicity?: PayrollPeriodicity;
}

export interface OrdinaryIsrBreakdown {
  status: "CALCULATED" | "MISSING_CONFIG";
  blockingReason: string | null;
  tableVersion: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  officialSource: string | null;
  method: "ART_96_MENSUAL" | "ART_175_RLISR_PROPORCIONAL" | null;
  fiscalYear: number;
  fiscalMonth: number;
  periodDays: number;
  taxableBaseCents: number;
  monthlyEquivalentBaseCents: number;
  renglon: number | null;
  limiteInferiorMensualCents: number | null;
  cuotaFijaMensualCents: number | null;
  tasaPorcentaje: number | null;
  impuestoAntesSubsidioCents: number;
  subsidioCausadoCents: number;
  subsidioAplicadoCents: number;
  isrRetenidoCents: number;
  justification:
    | "ART_96_LISR"
    | "ART_96_LISR_CON_SUBSIDIO"
    | "CUBIERTO_POR_SUBSIDIO_EMPLEO"
    | "BASE_GRAVABLE_CERO"
    | "ISR_TABLE_NOT_CONFIGURED";
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const FACTOR_DIAS_MES_RLISR = FACTOR_NOTIONAL_174; // 30.4 días/mes

function resolveEffectivePeriodDays(
  periodStart: string,
  periodEnd: string,
  explicitDays?: number
): number {
  if (!ISO_DATE_REGEX.test(periodStart) || !ISO_DATE_REGEX.test(periodEnd)) {
    throw new RangeError("Período inválido para ISR: las fechas deben tener formato YYYY-MM-DD.");
  }
  const start = parseISO(periodStart);
  const end = parseISO(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || periodStart > periodEnd) {
    throw new RangeError("Período inválido para ISR: periodStart no puede ser posterior a periodEnd.");
  }
  const derived = differenceInDays(end, start) + 1;
  const days = explicitDays ?? derived;
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`periodDays inválido para ISR: ${days}. Debe ser entero >= 1.`);
  }
  return days;
}

export function resolveOrdinaryIsrForPeriod(input: ResolveOrdinaryIsrInput): OrdinaryIsrBreakdown {
  const { taxableBaseCents, periodStart, periodEnd, periodicity } = input;
  if (
    typeof taxableBaseCents !== "number" ||
    !Number.isSafeInteger(taxableBaseCents) ||
    taxableBaseCents < 0
  ) {
    throw new RangeError(
      `taxableBaseCents inválido para ISR: ${taxableBaseCents}; se requieren centavos enteros no negativos.`
    );
  }

  const periodDays = resolveEffectivePeriodDays(periodStart, periodEnd, input.periodDays);
  const fiscalYear = Number(periodEnd.slice(0, 4));
  const fiscalMonth = Number(periodEnd.slice(5, 7));

  let tarifa: ReturnType<typeof resolverTarifaParaAnio>;
  try {
    tarifa = resolverTarifaParaAnio(fiscalYear);
  } catch {
    return {
      status: "MISSING_CONFIG",
      blockingReason: `No existe tarifa oficial de ISR (Art. 96 LISR) ni subsidio configurados para el ejercicio ${fiscalYear}.`,
      tableVersion: null,
      effectiveFrom: null,
      effectiveTo: null,
      officialSource: null,
      method: null,
      fiscalYear,
      fiscalMonth,
      periodDays,
      taxableBaseCents,
      monthlyEquivalentBaseCents: 0,
      renglon: null,
      limiteInferiorMensualCents: null,
      cuotaFijaMensualCents: null,
      tasaPorcentaje: null,
      impuestoAntesSubsidioCents: 0,
      subsidioCausadoCents: 0,
      subsidioAplicadoCents: 0,
      isrRetenidoCents: 0,
      justification: "ISR_TABLE_NOT_CONFIGURED",
    };
  }

  const tableVersion = `RMF_${fiscalYear}_ANEXO_8_ART_96`;
  const effectiveFrom = `${fiscalYear}-01-01`;
  const effectiveTo = `${fiscalYear}-12-31`;
  const isMonthly =
    periodicity === "MONTHLY" ||
    (periodicity !== "CUSTOM" &&
      periodicity !== "WEEKLY" &&
      periodicity !== "BIWEEKLY" &&
      periodicity !== "QUINCENAL" &&
      periodDays >= 28 &&
      periodDays <= 31);
  const method: OrdinaryIsrBreakdown["method"] = isMonthly
    ? "ART_96_MENSUAL"
    : "ART_175_RLISR_PROPORCIONAL";

  if (taxableBaseCents === 0) {
    return {
      status: "CALCULATED",
      blockingReason: null,
      tableVersion,
      effectiveFrom,
      effectiveTo,
      officialSource: tarifa.fuente,
      method,
      fiscalYear,
      fiscalMonth,
      periodDays,
      taxableBaseCents: 0,
      monthlyEquivalentBaseCents: 0,
      renglon: 1,
      limiteInferiorMensualCents: tarifa.mensual[0].limiteInferiorCents,
      cuotaFijaMensualCents: tarifa.mensual[0].cuotaFijaCents,
      tasaPorcentaje: tarifa.mensual[0].tasaPorcentaje,
      impuestoAntesSubsidioCents: 0,
      subsidioCausadoCents: 0,
      subsidioAplicadoCents: 0,
      isrRetenidoCents: 0,
      justification: "BASE_GRAVABLE_CERO",
    };
  }

  const monthlyEquivalentBaseCents = isMonthly
    ? taxableBaseCents
    : Math.round((taxableBaseCents / periodDays) * FACTOR_DIAS_MES_RLISR);

  const monthlyResult = calcularISRMensual96(monthlyEquivalentBaseCents, fiscalYear, fiscalMonth);
  const tramo = tarifa.mensual[monthlyResult.renglon - 1];

  const impuestoAntesSubsidioCents = isMonthly
    ? monthlyResult.impuestoCents
    : Math.round((monthlyResult.impuestoCents / FACTOR_DIAS_MES_RLISR) * periodDays);

  const subsidioCausadoCents = isMonthly
    ? monthlyResult.subsidioCents
    : Math.round((monthlyResult.subsidioCents / FACTOR_DIAS_MES_RLISR) * periodDays);

  const subsidioAplicadoCents = Math.min(impuestoAntesSubsidioCents, subsidioCausadoCents);
  const isrRetenidoCents = Math.max(0, impuestoAntesSubsidioCents - subsidioAplicadoCents);

  let justification: OrdinaryIsrBreakdown["justification"];
  if (isrRetenidoCents === 0 && subsidioAplicadoCents > 0) {
    justification = "CUBIERTO_POR_SUBSIDIO_EMPLEO";
  } else if (subsidioAplicadoCents > 0) {
    justification = "ART_96_LISR_CON_SUBSIDIO";
  } else {
    justification = "ART_96_LISR";
  }

  return {
    status: "CALCULATED",
    blockingReason: null,
    tableVersion,
    effectiveFrom,
    effectiveTo,
    officialSource: tarifa.fuente,
    method,
    fiscalYear,
    fiscalMonth,
    periodDays,
    taxableBaseCents,
    monthlyEquivalentBaseCents,
    renglon: monthlyResult.renglon,
    limiteInferiorMensualCents: tramo.limiteInferiorCents,
    cuotaFijaMensualCents: tramo.cuotaFijaCents,
    tasaPorcentaje: tramo.tasaPorcentaje,
    impuestoAntesSubsidioCents,
    subsidioCausadoCents,
    subsidioAplicadoCents,
    isrRetenidoCents,
    justification,
  };
}
