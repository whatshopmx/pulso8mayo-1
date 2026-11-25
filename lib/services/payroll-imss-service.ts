/**
 * NOM-02.d2 & NOM-02.e — Seguridad Social IMSS (Cuotas Obreras y Patronales),
 * INFONAVIT e ISN estatal con vigencias, topes en UMA y fuentes oficiales.
 *
 * Fuentes oficiales registradas:
 * - Ley del Seguro Social (LSS):
 *   - Art. 25 (2o párrafo): E&M Gastos Médicos Pensionados (Obrero 0.375%, Patrón 1.05%)
 *   - Art. 27 y 28: Salario Base de Cotización (SBC), tope superior 25 UMA
 *   - Art. 31: Ausentismos y días cotizados
 *   - Art. 36: Exención de cuota obrera para trabajadores de salario mínimo (paga el patrón)
 *   - Art. 71–73: Seguro de Riesgos de Trabajo (prima patronal por clase/siniestralidad)
 *   - Art. 106 fr. I y II: E&M Cuota Fija (Patrón 20.40% × 1 UMA) y Excedente 3 UMA (Obrero 0.40%, Patrón 1.10%)
 *   - Art. 107 fr. I: E&M Prestaciones en Dinero (Obrero 0.25%, Patrón 0.70%)
 *   - Art. 147: Invalidez y Vida (Obrero 0.625%, Patrón 1.75%)
 *   - Art. 168 fr. I y II: Retiro (Patrón 2.00%) y CEAV (Obrero 1.125%; Patrón tabla progresiva
 *     Decreto DOF 16-dic-2020 Transitorio Segundo, ejercicio 2026)
 *   - Art. 211: Guarderías y Prestaciones Sociales (Patrón 1.00%)
 * - Ley del INFONAVIT Art. 29 fr. II: Aportación patronal 5.00% sobre SBC topado a 25 UMA.
 * - UMA diaria (INEGI):
 *   - 2026-01-01..2026-01-31: $113.14 (11,314¢, UMA 2025 vigente en enero)
 *   - 2026-02-01..2026-12-31: $117.31 (11,731¢, Boletín INEGI 08-ene-2026)
 *
 * Garantías:
 * - Centavos enteros en todos los importes.
 * - Sin UMA vigente para la fecha del período -> `status: "MISSING_CONFIG"` (nunca simula 0).
 * - Sin base salarial / SBC válido -> `status: "MISSING_BASE"` (nunca simula 0).
 */

import { differenceInDays, parseISO } from "date-fns";

export interface UmaReference {
  effectiveFrom: string;
  effectiveTo: string;
  umaDailyCents: number;
  officialSource: string;
}

export const UMA_DAILY_CATALOG: readonly UmaReference[] = [
  {
    effectiveFrom: "2025-02-01",
    effectiveTo: "2026-01-31",
    umaDailyCents: 11_314, // $113.14 MXN
    officialSource: "INEGI Boletín UMA 2025 (publicado 09-ene-2025, vigente 01-feb-2025 a 31-ene-2026).",
  },
  {
    effectiveFrom: "2026-02-01",
    effectiveTo: "2026-12-31",
    umaDailyCents: 11_731, // $117.31 MXN
    officialSource: "INEGI Boletín UMA 2026 (publicado 08-ene-2026, vigente 01-feb-2026 a 31-ene-2027).",
  },
];

export const IMSS_WORKER_RATES_2026 = {
  eymExcedente3UmaPct: 0.4, // Art. 106 fr. II LSS
  eymDineroPct: 0.25, // Art. 107 fr. I LSS
  eymGastosMedicosPct: 0.375, // Art. 25 2o párrafo LSS
  invalidezVidaPct: 0.625, // Art. 147 LSS
  ceavPct: 1.125, // Art. 168 fr. II LSS
  maxUmaCap: 25, // Art. 28 LSS
  eymExcedenteThresholdUma: 3, // Art. 106 fr. II LSS
} as const;

export const IMSS_EMPLOYER_FIXED_RATES_2026 = {
  eymCuotaFijaUmaPct: 20.4, // Art. 106 fr. I LSS (sobre 1 UMA)
  eymExcedente3UmaPct: 1.1, // Art. 106 fr. II LSS
  eymDineroPct: 0.7, // Art. 107 fr. I LSS
  eymGastosMedicosPct: 1.05, // Art. 25 2o párrafo LSS
  invalidezVidaPct: 1.75, // Art. 147 LSS
  retiroPct: 2.0, // Art. 168 fr. I LSS
  guarderiasPct: 1.0, // Art. 211 LSS
  infonavitPct: 5.0, // Art. 29 fr. II Ley del INFONAVIT
} as const;

/**
 * Tabla progresiva CEAV patronal 2026 (Art. 168 fr. II LSS, Transitorio Segundo
 * Decreto DOF 16-dic-2020 — 4o año de transición 2023..2030).
 */
export interface CeavEmployerBracket {
  label: string;
  maxUmaMultiple: number; // Infinity para último rango
  ratePct: number;
}

export const CEAV_EMPLOYER_TABLE_2026: readonly CeavEmployerBracket[] = [
  { label: "1.00 SM", maxUmaMultiple: 0, ratePct: 3.15 }, // Se aplica cuando SBC <= salario mínimo
  { label: "1.01 a 1.50 UMA", maxUmaMultiple: 1.5, ratePct: 3.544 },
  { label: "1.51 a 2.00 UMA", maxUmaMultiple: 2.0, ratePct: 4.434 },
  { label: "2.01 a 2.50 UMA", maxUmaMultiple: 2.5, ratePct: 5.106 },
  { label: "2.51 a 3.00 UMA", maxUmaMultiple: 3.0, ratePct: 5.554 },
  { label: "3.01 a 3.50 UMA", maxUmaMultiple: 3.5, ratePct: 5.874 },
  { label: "3.51 a 4.00 UMA", maxUmaMultiple: 4.0, ratePct: 6.115 },
  { label: "4.01 UMA en adelante", maxUmaMultiple: Infinity, ratePct: 7.513 },
];

export const LSS_OFFICIAL_SOURCE_2026 =
  "Ley del Seguro Social (Arts. 25, 27, 28, 31, 36, 71-73, 106, 107, 147, 168 y 211; Decreto DOF 16-dic-2020 Transitorio Segundo CEAV 2026) y Ley del INFONAVIT Art. 29 fr. II.";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function resolveUmaForDate(dateStr: string): UmaReference | null {
  if (!ISO_DATE_REGEX.test(dateStr)) {
    throw new RangeError(`Fecha inválida para resolver UMA: ${dateStr}. Formato esperado YYYY-MM-DD.`);
  }
  return (
    UMA_DAILY_CATALOG.find(
      (entry) => dateStr >= entry.effectiveFrom && dateStr <= entry.effectiveTo
    ) ?? null
  );
}

/**
 * Calcula el factor mínimo de integración legal (Art. 27 LSS + Arts. 76, 80 y 87 LFT).
 * Default año 1: 15 días aguinaldo + 12 días vacaciones × 25% prima = 1 + 18/365 = 1.049315...
 */
export function calculateMinimumIntegrationFactor(options?: {
  aguinaldoDays?: number;
  vacationDays?: number;
  vacationBonusPercent?: number;
}): number {
  const aguinaldoDays = options?.aguinaldoDays ?? 15;
  const vacationDays = options?.vacationDays ?? 12;
  const vacationBonusPercent = options?.vacationBonusPercent ?? 25;
  if (aguinaldoDays < 0 || vacationDays < 0 || vacationBonusPercent < 0) {
    throw new RangeError("Parámetros de factor de integración no pueden ser negativos.");
  }
  return 1 + aguinaldoDays / 365 + (vacationDays * (vacationBonusPercent / 100)) / 365;
}

export interface ResolveWorkerImssInput {
  /** Salario diario del contrato en centavos. */
  dailySalaryCents: number;
  /** SBC diario explícito en centavos (opcional; si falta se calcula con factor mínimo de integración). */
  sbcDailyCents?: number | null;
  /** Salario mínimo diario vigente de la zona geográfica en centavos (para exención Art. 36 LSS). */
  minimumWageDailyCents: number;
  periodStart: string;
  periodEnd: string;
  /** Días calendario del período (opcional; se deriva de periodStart..periodEnd). */
  periodDays?: number;
  /** Ausentismos sin goce que reducen días cotizados (Art. 31 LSS). */
  unpaidAbsenceDays?: number;
  /** Parámetros opcionales de integración salarial si sbcDailyCents no viene explícito. */
  aguinaldoDays?: number;
  vacationDays?: number;
  vacationBonusPercent?: number;
}

export interface WorkerImssConceptLine {
  branch:
    | "EYM_EXCEDENTE_3_UMA"
    | "EYM_DINERO"
    | "EYM_GASTOS_MEDICOS_PENSIONADOS"
    | "INVALIDEZ_Y_VIDA"
    | "CEAV";
  legalBasis: string;
  ratePct: number;
  baseDailyCents: number;
  quotedDays: number;
  amountCents: number;
}

export interface WorkerImssBreakdown {
  status: "CALCULATED" | "MISSING_CONFIG" | "MISSING_BASE";
  blockingReason: string | null;
  ruleVersion: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  officialSource: string | null;
  umaDailyCents: number | null;
  sbcDailyCents: number;
  sbcCappedDailyCents: number;
  sbcCapDailyCents: number;
  integrationFactor: number;
  quotedDays: number;
  isMinimumWageExempt: boolean;
  totalWorkerImssCents: number;
  concepts: WorkerImssConceptLine[];
  justification:
    | "LSS_CUOTAS_OBRERAS_2026"
    | "ART_36_LSS_SALARIO_MINIMO_EXENTO"
    | "SIN_DIAS_COTIZADOS"
    | "MISSING_UMA_CONFIG"
    | "MISSING_SALARY_BASE";
}

function resolvePeriodDays(periodStart: string, periodEnd: string, explicit?: number): number {
  if (!ISO_DATE_REGEX.test(periodStart) || !ISO_DATE_REGEX.test(periodEnd) || periodStart > periodEnd) {
    throw new RangeError("Período inválido para cálculo de IMSS.");
  }
  const derived = differenceInDays(parseISO(periodEnd), parseISO(periodStart)) + 1;
  const days = explicit ?? derived;
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`periodDays inválido para IMSS: ${days}`);
  }
  return days;
}

export function resolveWorkerImssForPeriod(input: ResolveWorkerImssInput): WorkerImssBreakdown {
  const periodDays = resolvePeriodDays(input.periodStart, input.periodEnd, input.periodDays);
  const unpaidAbsenceDays = input.unpaidAbsenceDays ?? 0;
  if (!Number.isInteger(unpaidAbsenceDays) || unpaidAbsenceDays < 0) {
    throw new RangeError(`unpaidAbsenceDays inválido: ${unpaidAbsenceDays}`);
  }

  const uma = resolveUmaForDate(input.periodEnd);
  if (!uma) {
    return {
      status: "MISSING_CONFIG",
      blockingReason: `No existe UMA oficial registrada para la fecha ${input.periodEnd}; no se puede calcular IMSS obrero.`,
      ruleVersion: null,
      effectiveFrom: null,
      effectiveTo: null,
      officialSource: null,
      umaDailyCents: null,
      sbcDailyCents: 0,
      sbcCappedDailyCents: 0,
      sbcCapDailyCents: 0,
      integrationFactor: 0,
      quotedDays: 0,
      isMinimumWageExempt: false,
      totalWorkerImssCents: 0,
      concepts: [],
      justification: "MISSING_UMA_CONFIG",
    };
  }

  const hasValidSalary =
    typeof input.dailySalaryCents === "number" &&
    Number.isSafeInteger(input.dailySalaryCents) &&
    input.dailySalaryCents > 0;
  const hasValidMinWage =
    typeof input.minimumWageDailyCents === "number" &&
    Number.isSafeInteger(input.minimumWageDailyCents) &&
    input.minimumWageDailyCents > 0;

  if (!hasValidSalary || !hasValidMinWage) {
    return {
      status: "MISSING_BASE",
      blockingReason:
        "Falta salario diario o salario mínimo vigente válido para determinar el Salario Base de Cotización (SBC).",
      ruleVersion: "LSS_2026_OBRERO_V1",
      effectiveFrom: uma.effectiveFrom,
      effectiveTo: uma.effectiveTo,
      officialSource: `${LSS_OFFICIAL_SOURCE_2026} ${uma.officialSource}`,
      umaDailyCents: uma.umaDailyCents,
      sbcDailyCents: 0,
      sbcCappedDailyCents: 0,
      sbcCapDailyCents: uma.umaDailyCents * IMSS_WORKER_RATES_2026.maxUmaCap,
      integrationFactor: 0,
      quotedDays: 0,
      isMinimumWageExempt: false,
      totalWorkerImssCents: 0,
      concepts: [],
      justification: "MISSING_SALARY_BASE",
    };
  }

  const integrationFactor = calculateMinimumIntegrationFactor({
    aguinaldoDays: input.aguinaldoDays,
    vacationDays: input.vacationDays,
    vacationBonusPercent: input.vacationBonusPercent,
  });
  const sbcDailyCents =
    input.sbcDailyCents !== undefined && input.sbcDailyCents !== null
      ? Math.round(input.sbcDailyCents)
      : Math.round(input.dailySalaryCents * integrationFactor);
  const sbcCapDailyCents = uma.umaDailyCents * IMSS_WORKER_RATES_2026.maxUmaCap;
  const sbcCappedDailyCents = Math.min(sbcDailyCents, sbcCapDailyCents);
  const quotedDays = Math.max(0, periodDays - unpaidAbsenceDays);
  const officialSource = `${LSS_OFFICIAL_SOURCE_2026} ${uma.officialSource}`;

  if (quotedDays === 0) {
    return {
      status: "CALCULATED",
      blockingReason: null,
      ruleVersion: "LSS_2026_OBRERO_V1",
      effectiveFrom: uma.effectiveFrom,
      effectiveTo: uma.effectiveTo,
      officialSource,
      umaDailyCents: uma.umaDailyCents,
      sbcDailyCents,
      sbcCappedDailyCents,
      sbcCapDailyCents,
      integrationFactor,
      quotedDays: 0,
      isMinimumWageExempt: false,
      totalWorkerImssCents: 0,
      concepts: [],
      justification: "SIN_DIAS_COTIZADOS",
    };
  }

  // Art. 36 LSS: trabajadores con salario mínimo están exentos de cuota obrera
  if (input.dailySalaryCents <= input.minimumWageDailyCents) {
    return {
      status: "CALCULATED",
      blockingReason: null,
      ruleVersion: "LSS_2026_OBRERO_V1",
      effectiveFrom: uma.effectiveFrom,
      effectiveTo: uma.effectiveTo,
      officialSource,
      umaDailyCents: uma.umaDailyCents,
      sbcDailyCents,
      sbcCappedDailyCents,
      sbcCapDailyCents,
      integrationFactor,
      quotedDays,
      isMinimumWageExempt: true,
      totalWorkerImssCents: 0,
      concepts: [],
      justification: "ART_36_LSS_SALARIO_MINIMO_EXENTO",
    };
  }

  const excedente3UmaDailyCents = Math.max(
    0,
    sbcCappedDailyCents - uma.umaDailyCents * IMSS_WORKER_RATES_2026.eymExcedenteThresholdUma
  );

  const concepts: WorkerImssConceptLine[] = [
    {
      branch: "EYM_EXCEDENTE_3_UMA",
      legalBasis: "Art. 106 fr. II LSS (0.40% sobre excedente de 3 UMA)",
      ratePct: IMSS_WORKER_RATES_2026.eymExcedente3UmaPct,
      baseDailyCents: excedente3UmaDailyCents,
      quotedDays,
      amountCents: Math.round(
        (excedente3UmaDailyCents * quotedDays * IMSS_WORKER_RATES_2026.eymExcedente3UmaPct) / 100
      ),
    },
    {
      branch: "EYM_DINERO",
      legalBasis: "Art. 107 fr. I LSS (0.25% sobre SBC)",
      ratePct: IMSS_WORKER_RATES_2026.eymDineroPct,
      baseDailyCents: sbcCappedDailyCents,
      quotedDays,
      amountCents: Math.round(
        (sbcCappedDailyCents * quotedDays * IMSS_WORKER_RATES_2026.eymDineroPct) / 100
      ),
    },
    {
      branch: "EYM_GASTOS_MEDICOS_PENSIONADOS",
      legalBasis: "Art. 25 2o párrafo LSS (0.375% sobre SBC)",
      ratePct: IMSS_WORKER_RATES_2026.eymGastosMedicosPct,
      baseDailyCents: sbcCappedDailyCents,
      quotedDays,
      amountCents: Math.round(
        (sbcCappedDailyCents * quotedDays * IMSS_WORKER_RATES_2026.eymGastosMedicosPct) / 100
      ),
    },
    {
      branch: "INVALIDEZ_Y_VIDA",
      legalBasis: "Art. 147 LSS (0.625% sobre SBC)",
      ratePct: IMSS_WORKER_RATES_2026.invalidezVidaPct,
      baseDailyCents: sbcCappedDailyCents,
      quotedDays,
      amountCents: Math.round(
        (sbcCappedDailyCents * quotedDays * IMSS_WORKER_RATES_2026.invalidezVidaPct) / 100
      ),
    },
    {
      branch: "CEAV",
      legalBasis: "Art. 168 fr. II LSS (1.125% sobre SBC)",
      ratePct: IMSS_WORKER_RATES_2026.ceavPct,
      baseDailyCents: sbcCappedDailyCents,
      quotedDays,
      amountCents: Math.round(
        (sbcCappedDailyCents * quotedDays * IMSS_WORKER_RATES_2026.ceavPct) / 100
      ),
    },
  ];

  const totalWorkerImssCents = concepts.reduce((acc, c) => acc + c.amountCents, 0);

  return {
    status: "CALCULATED",
    blockingReason: null,
    ruleVersion: "LSS_2026_OBRERO_V1",
    effectiveFrom: uma.effectiveFrom,
    effectiveTo: uma.effectiveTo,
    officialSource,
    umaDailyCents: uma.umaDailyCents,
    sbcDailyCents,
    sbcCappedDailyCents,
    sbcCapDailyCents,
    integrationFactor,
    quotedDays,
    isMinimumWageExempt: false,
    totalWorkerImssCents,
    concepts,
    justification: "LSS_CUOTAS_OBRERAS_2026",
  };
}

export function resolveCeavEmployerRate2026(
  sbcCappedDailyCents: number,
  umaDailyCents: number,
  minimumWageDailyCents: number
): CeavEmployerBracket {
  if (sbcCappedDailyCents <= minimumWageDailyCents) {
    return CEAV_EMPLOYER_TABLE_2026[0];
  }
  const ratio = sbcCappedDailyCents / umaDailyCents;
  for (let i = 1; i < CEAV_EMPLOYER_TABLE_2026.length; i++) {
    if (ratio <= CEAV_EMPLOYER_TABLE_2026[i].maxUmaMultiple) {
      return CEAV_EMPLOYER_TABLE_2026[i];
    }
  }
  return CEAV_EMPLOYER_TABLE_2026[CEAV_EMPLOYER_TABLE_2026.length - 1];
}

export interface ResolveEmployerSocialSecurityInput {
  dailySalaryCents: number;
  sbcDailyCents?: number | null;
  minimumWageDailyCents: number;
  /** Percepciones gravables para ISN estatal (en centavos). */
  isnTaxableBaseCents: number;
  periodStart: string;
  periodEnd: string;
  periodDays?: number;
  unpaidAbsenceDays?: number;
  /** Prima de Riesgo de Trabajo de la empresa en % (ej. 0.54355 Clase I). null/undefined = no configurada. */
  workRiskPremiumPercent?: number | null;
  /** Tasa estatal de ISN en % (ej. 3.0 para NL, 4.0 para CDMX). null/undefined = no configurada. */
  statePayrollTaxPercent?: number | null;
  /** Si se permite estimar prima de riesgo de trabajo con Clase I (0.54355%) — etiqueta resultado como ESTIMATED. */
  allowEstimatedWorkRisk?: boolean;
  aguinaldoDays?: number;
  vacationDays?: number;
  vacationBonusPercent?: number;
}

export interface EmployerSocialSecurityConceptLine {
  branch:
    | "EYM_CUOTA_FIJA"
    | "EYM_EXCEDENTE_3_UMA"
    | "EYM_DINERO"
    | "EYM_GASTOS_MEDICOS_PENSIONADOS"
    | "INVALIDEZ_Y_VIDA"
    | "RETIRO_SAR"
    | "CEAV_PATRONAL"
    | "GUARDERIAS"
    | "RIESGO_DE_TRABAJO"
    | "INFONAVIT"
    | "ISN_ESTATAL";
  legalBasis: string;
  ratePct: number;
  baseCents: number;
  amountCents: number;
  isEstimated: boolean;
}

export interface EmployerSocialSecurityBreakdown {
  status: "MEASURED" | "ESTIMATED" | "MISSING_CONFIG" | "MISSING_BASE";
  blockingReason: string | null;
  ruleVersion: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  officialSource: string | null;
  umaDailyCents: number | null;
  sbcDailyCents: number;
  sbcCappedDailyCents: number;
  quotedDays: number;
  ceavBracketLabel: string | null;
  imssEmployerCents: number;
  infonavitCents: number;
  stateTaxIsnCents: number;
  totalEmployerBurdenCents: number;
  missingParameters: string[];
  concepts: EmployerSocialSecurityConceptLine[];
}

export const DEFAULT_CLASS_I_WORK_RISK_PCT = 0.54355; // Art. 73 LSS Clase I

export function resolveEmployerSocialSecurityForPeriod(
  input: ResolveEmployerSocialSecurityInput
): EmployerSocialSecurityBreakdown {
  const periodDays = resolvePeriodDays(input.periodStart, input.periodEnd, input.periodDays);
  const unpaidAbsenceDays = input.unpaidAbsenceDays ?? 0;
  const uma = resolveUmaForDate(input.periodEnd);

  if (!uma) {
    return {
      status: "MISSING_CONFIG",
      blockingReason: `No existe UMA oficial registrada para la fecha ${input.periodEnd}; no se puede calcular carga patronal.`,
      ruleVersion: null,
      effectiveFrom: null,
      effectiveTo: null,
      officialSource: null,
      umaDailyCents: null,
      sbcDailyCents: 0,
      sbcCappedDailyCents: 0,
      quotedDays: 0,
      ceavBracketLabel: null,
      imssEmployerCents: 0,
      infonavitCents: 0,
      stateTaxIsnCents: 0,
      totalEmployerBurdenCents: 0,
      missingParameters: ["UMA_DAILY"],
      concepts: [],
    };
  }

  if (
    !Number.isSafeInteger(input.dailySalaryCents) ||
    input.dailySalaryCents <= 0 ||
    !Number.isSafeInteger(input.minimumWageDailyCents) ||
    input.minimumWageDailyCents <= 0
  ) {
    return {
      status: "MISSING_BASE",
      blockingReason: "Falta salario diario o salario mínimo válido para calcular carga patronal.",
      ruleVersion: "LSS_2026_PATRONAL_V1",
      effectiveFrom: uma.effectiveFrom,
      effectiveTo: uma.effectiveTo,
      officialSource: `${LSS_OFFICIAL_SOURCE_2026} ${uma.officialSource}`,
      umaDailyCents: uma.umaDailyCents,
      sbcDailyCents: 0,
      sbcCappedDailyCents: 0,
      quotedDays: 0,
      ceavBracketLabel: null,
      imssEmployerCents: 0,
      infonavitCents: 0,
      stateTaxIsnCents: 0,
      totalEmployerBurdenCents: 0,
      missingParameters: ["SALARY_BASE"],
      concepts: [],
    };
  }

  const integrationFactor = calculateMinimumIntegrationFactor({
    aguinaldoDays: input.aguinaldoDays,
    vacationDays: input.vacationDays,
    vacationBonusPercent: input.vacationBonusPercent,
  });
  const sbcDailyCents =
    input.sbcDailyCents !== undefined && input.sbcDailyCents !== null
      ? Math.round(input.sbcDailyCents)
      : Math.round(input.dailySalaryCents * integrationFactor);
  const sbcCapDailyCents = uma.umaDailyCents * IMSS_WORKER_RATES_2026.maxUmaCap;
  const sbcCappedDailyCents = Math.min(sbcDailyCents, sbcCapDailyCents);
  const quotedDays = Math.max(0, periodDays - unpaidAbsenceDays);
  const officialSource = `${LSS_OFFICIAL_SOURCE_2026} ${uma.officialSource}`;

  const missingParameters: string[] = [];
  const hasExplicitWorkRisk =
    typeof input.workRiskPremiumPercent === "number" &&
    Number.isFinite(input.workRiskPremiumPercent) &&
    input.workRiskPremiumPercent > 0;
  const hasExplicitIsn =
    typeof input.statePayrollTaxPercent === "number" &&
    Number.isFinite(input.statePayrollTaxPercent) &&
    input.statePayrollTaxPercent >= 0;

  if (!hasExplicitWorkRisk) missingParameters.push("WORK_RISK_PREMIUM_PERCENT");
  if (!hasExplicitIsn) missingParameters.push("STATE_PAYROLL_TAX_PERCENT");

  const effectiveWorkRiskPct = hasExplicitWorkRisk
    ? input.workRiskPremiumPercent!
    : input.allowEstimatedWorkRisk
      ? DEFAULT_CLASS_I_WORK_RISK_PCT
      : 0;
  const workRiskIsEstimated = !hasExplicitWorkRisk && Boolean(input.allowEstimatedWorkRisk);

  const ceavBracket = resolveCeavEmployerRate2026(
    sbcCappedDailyCents,
    uma.umaDailyCents,
    input.minimumWageDailyCents
  );

  const umaBaseCents = uma.umaDailyCents * quotedDays;
  const sbcBaseCents = sbcCappedDailyCents * quotedDays;
  const excedenteBaseCents =
    Math.max(0, sbcCappedDailyCents - uma.umaDailyCents * IMSS_WORKER_RATES_2026.eymExcedenteThresholdUma) *
    quotedDays;

  const concepts: EmployerSocialSecurityConceptLine[] = [
    {
      branch: "EYM_CUOTA_FIJA",
      legalBasis: "Art. 106 fr. I LSS (20.40% sobre 1 UMA)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.eymCuotaFijaUmaPct,
      baseCents: umaBaseCents,
      amountCents: Math.round(
        (umaBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.eymCuotaFijaUmaPct) / 100
      ),
      isEstimated: false,
    },
    {
      branch: "EYM_EXCEDENTE_3_UMA",
      legalBasis: "Art. 106 fr. II LSS (1.10% sobre excedente de 3 UMA)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.eymExcedente3UmaPct,
      baseCents: excedenteBaseCents,
      amountCents: Math.round(
        (excedenteBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.eymExcedente3UmaPct) / 100
      ),
      isEstimated: false,
    },
    {
      branch: "EYM_DINERO",
      legalBasis: "Art. 107 fr. I LSS (0.70% sobre SBC)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.eymDineroPct,
      baseCents: sbcBaseCents,
      amountCents: Math.round((sbcBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.eymDineroPct) / 100),
      isEstimated: false,
    },
    {
      branch: "EYM_GASTOS_MEDICOS_PENSIONADOS",
      legalBasis: "Art. 25 2o párrafo LSS (1.05% sobre SBC)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.eymGastosMedicosPct,
      baseCents: sbcBaseCents,
      amountCents: Math.round(
        (sbcBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.eymGastosMedicosPct) / 100
      ),
      isEstimated: false,
    },
    {
      branch: "INVALIDEZ_Y_VIDA",
      legalBasis: "Art. 147 LSS (1.75% sobre SBC)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.invalidezVidaPct,
      baseCents: sbcBaseCents,
      amountCents: Math.round(
        (sbcBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.invalidezVidaPct) / 100
      ),
      isEstimated: false,
    },
    {
      branch: "RETIRO_SAR",
      legalBasis: "Art. 168 fr. I LSS (2.00% sobre SBC)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.retiroPct,
      baseCents: sbcBaseCents,
      amountCents: Math.round((sbcBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.retiroPct) / 100),
      isEstimated: false,
    },
    {
      branch: "CEAV_PATRONAL",
      legalBasis: `Art. 168 fr. II LSS 2026 (${ceavBracket.label}: ${ceavBracket.ratePct}% sobre SBC)`,
      ratePct: ceavBracket.ratePct,
      baseCents: sbcBaseCents,
      amountCents: Math.round((sbcBaseCents * ceavBracket.ratePct) / 100),
      isEstimated: false,
    },
    {
      branch: "GUARDERIAS",
      legalBasis: "Art. 211 LSS (1.00% sobre SBC)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.guarderiasPct,
      baseCents: sbcBaseCents,
      amountCents: Math.round(
        (sbcBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.guarderiasPct) / 100
      ),
      isEstimated: false,
    },
    {
      branch: "RIESGO_DE_TRABAJO",
      legalBasis: workRiskIsEstimated
        ? "Art. 73 LSS (Clase I estimada 0.54355% — sin prima patronal registrada)"
        : "Arts. 71–73 LSS (prima de riesgo de trabajo configurada)",
      ratePct: effectiveWorkRiskPct,
      baseCents: sbcBaseCents,
      amountCents: Math.round((sbcBaseCents * effectiveWorkRiskPct) / 100),
      isEstimated: workRiskIsEstimated,
    },
    {
      branch: "INFONAVIT",
      legalBasis: "Art. 29 fr. II Ley del INFONAVIT (5.00% sobre SBC)",
      ratePct: IMSS_EMPLOYER_FIXED_RATES_2026.infonavitPct,
      baseCents: sbcBaseCents,
      amountCents: Math.round(
        (sbcBaseCents * IMSS_EMPLOYER_FIXED_RATES_2026.infonavitPct) / 100
      ),
      isEstimated: false,
    },
  ];

  const stateTaxIsnCents = hasExplicitIsn
    ? Math.round((Math.max(0, input.isnTaxableBaseCents) * input.statePayrollTaxPercent!) / 100)
    : 0;

  if (hasExplicitIsn) {
    concepts.push({
      branch: "ISN_ESTATAL",
      legalBasis: `ISN estatal configurado (${input.statePayrollTaxPercent}%)`,
      ratePct: input.statePayrollTaxPercent!,
      baseCents: Math.max(0, input.isnTaxableBaseCents),
      amountCents: stateTaxIsnCents,
      isEstimated: false,
    });
  }

  const infonavitCents = concepts.find((c) => c.branch === "INFONAVIT")!.amountCents;
  const imssEmployerCents = concepts
    .filter((c) => c.branch !== "INFONAVIT" && c.branch !== "ISN_ESTATAL")
    .reduce((acc, c) => acc + c.amountCents, 0);
  const totalEmployerBurdenCents = imssEmployerCents + infonavitCents + stateTaxIsnCents;

  const status: EmployerSocialSecurityBreakdown["status"] =
    missingParameters.length === 0 ? "MEASURED" : "ESTIMATED";

  return {
    status,
    blockingReason: null,
    ruleVersion: "LSS_2026_PATRONAL_V1",
    effectiveFrom: uma.effectiveFrom,
    effectiveTo: uma.effectiveTo,
    officialSource,
    umaDailyCents: uma.umaDailyCents,
    sbcDailyCents,
    sbcCappedDailyCents,
    quotedDays,
    ceavBracketLabel: ceavBracket.label,
    imssEmployerCents,
    infonavitCents,
    stateTaxIsnCents,
    totalEmployerBurdenCents,
    missingParameters,
    concepts,
  };
}
