/** Catálogo geográfico de CONASAMI. La tabla laboral global solo representa GENERAL. */
export type MinimumWageZone = "GENERAL" | "ZLFN";

const publishedWages = [
  { effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", GENERAL: 27_880, ZLFN: 41_988,
    sourceUrl: "https://sidof.segob.gob.mx/notas/docFuente/5745678" },
  { effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", GENERAL: 31_504, ZLFN: 44_087,
    sourceUrl: "https://sidof.segob.gob.mx/notas/docFuente/5775534" },
] as const;

/** Fecha civil explícita: no depende del reloj ni de la zona horaria del proceso. */
export function resolveSeveranceMinimumWage(effectiveDate: string, zone: MinimumWageZone) {
  if (typeof effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new Error("Indica la fecha efectiva del finiquito (AAAA-MM-DD).");
  }
  const parsed = new Date(`${effectiveDate}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== effectiveDate) {
    throw new Error("La fecha efectiva del finiquito no es válida.");
  }
  if (zone !== "GENERAL" && zone !== "ZLFN") {
    throw new Error("Selecciona la zona salarial del lugar de trabajo: GENERAL o ZLFN.");
  }
  const rule = publishedWages.find((row) => row.effectiveFrom <= effectiveDate && effectiveDate <= row.effectiveTo);
  if (!rule) throw new Error(`No hay salario mínimo publicado para ${effectiveDate}; cálculo bloqueado.`);
  return { effectiveDate, zone, effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo,
    dailyCents: rule[zone], sourceUrl: rule.sourceUrl };
}

/** Art. 162-II y 486 LFT: factor legal independiente del importe mínimo publicado. */
const SENIORITY_MINIMUM_WAGE_CAP_FACTOR = 2;
export function calculateSeniorityPremiumCents(dailySalaryCents: number, tenureYears: number, minimumWageCents: number) {
  if (!Number.isSafeInteger(dailySalaryCents) || dailySalaryCents <= 0) {
    throw new Error("Falta un salario diario válido en centavos para el finiquito.");
  }
  if (!Number.isSafeInteger(minimumWageCents) || minimumWageCents <= 0) {
    throw new Error("Falta resolver el salario mínimo vigente para el finiquito.");
  }
  if (!Number.isFinite(tenureYears) || tenureYears < 0) {
    throw new Error("La antigüedad del finiquito no es válida.");
  }
  const cappedDaily = Math.min(dailySalaryCents, minimumWageCents * SENIORITY_MINIMUM_WAGE_CAP_FACTOR);
  const cents = Math.round(cappedDaily * 12 * tenureYears);
  if (!Number.isSafeInteger(cents)) throw new Error("El importe de prima de antigüedad excede el límite de cálculo.");
  return cents;
}
