/**
 * Simulación de indemnización y prima de antigüedad.
 * La prima adicional por sustitución IA se identifica como proyección, no ley vigente.
 */

export interface SeveranceCalculationInput {
  dailyIntegratedSalaryMXN: number; // Salario Diario Integrado (SDI)
  /**
   * Task 12: salario diario de REGISTRO (lo timbrado), cuando exista gap sub-
   * registro. Opcional — se utiliza únicamente para declarar la fuente de la
   * cifra y el tamaño del gap demandable (J. 1a./J. 24/2023, prescripción 1 año
   * art. 516 LFT); el cálculo corre sobre el salario real recibido.
   */
  registeredSalaryMXN?: number | null;
  tenureYears: number;
  isAiReplacement: boolean; // True if termination is caused by AI substitution
  unpaidVacationDays?: number;
  proportionalAguinaldoDays?: number;
  /** Importe resuelto ANTES del cálculo puro; no admite un default por año. */
  minimumWageMxn: number;
}

export interface SeveranceCalculationResult {
  dailyIntegratedSalaryMXN: number;
  tenureYears: number;
  constitutionalIndemnityMXN: number; // 3 months (90 days)
  aiReplacementPremiumMXN: number; // 2 months (60 days) additional for AI replacement
  seniorityPremiumMXN: number; // Prima de antigüedad (12 days per year, capped at 2x minimum wage)
  totalSeveranceMXN: number;
  breakdown: {
    baseMonthsIndemnity: number; // 3 or 5 months
    isAiReplacement: boolean;
    legalNote: string;
    /** Estatus legal de la prima IA (catálogo reformas; NO es ley aún). */
    aiReplacementPremiumStatus: string;
    /** Salario mínimo usado para el tope de la prima de antigüedad. */
    minimumWageUsed: number;
    /** Task 12: salario de registro declarado cuando es MENOR al real usado; NULL = sin gap o sin dato. */
    registeredSalaryDeclared: number | null;
  };
}

import { getReformStatus } from '@/lib/company/labor-reform-status-catalog';
import { calculateSeniorityPremiumCents, resolveSeveranceMinimumWage, type MinimumWageZone } from './severance-minimum-wage';

export class AISeveranceCalculator {
  static minimumWageForDate(effectiveDate: string, zone: MinimumWageZone): number {
    return resolveSeveranceMinimumWage(effectiveDate, zone).dailyCents / 100;
  }

  /** Orquestación de la simulación: fecha/zona se resuelven antes del cálculo puro. */
  static calculateSeveranceForDate(input: Omit<SeveranceCalculationInput, 'minimumWageMxn'> & {
    effectiveDate: string; wageZone: MinimumWageZone;
  }) {
    const minimumWageRule = resolveSeveranceMinimumWage(input.effectiveDate, input.wageZone);
    return { ...this.calculateSeverance({ ...input, minimumWageMxn: minimumWageRule.dailyCents / 100 }), minimumWageRule };
  }

  /**
   * Cálculo puro con mínimo resuelto; la prima IA opcional conserva su estatus de proyección.
   */
  static calculateSeverance(input: SeveranceCalculationInput): SeveranceCalculationResult {
    const sdi = input.dailyIntegratedSalaryMXN;
    const years = input.tenureYears;
    const minimumWage = input.minimumWageMxn;
    if (!Number.isFinite(sdi) || sdi <= 0 || !Number.isFinite(minimumWage) || minimumWage <= 0) {
      throw new Error('El finiquito requiere salario diario y mínimo vigente válidos.');
    }
    const salaryCents = Math.round(sdi * 100);
    const seniorityCents = calculateSeniorityPremiumCents(salaryCents, years, Math.round(minimumWage * 100));

    // 1. Indemnización Constitucional (3 meses = 90 días)
    const constitutionalIndemnityCents = salaryCents * 90;

    // 2. Prima por Sustitución de Inteligencia Artificial (2 meses adicionales = 60 días)
    const aiReplacementPremiumCents = input.isAiReplacement ? salaryCents * 60 : 0;

    // 3. Prima de Antigüedad (12 días por año, topada a 2 salarios mínimos)
    // 4. Total
    const totalSeveranceCents = constitutionalIndemnityCents + aiReplacementPremiumCents + seniorityCents;
    if (!Number.isSafeInteger(totalSeveranceCents)) throw new Error('El importe del finiquito excede el límite de cálculo.');

    // Estatus legal de la prima IA: NO es ley (iniciativa Morena jul-2026).
    // El cálculo se ofrece como PROYECCIÓN, no como indemnización exigible.
    const primaIA = getReformStatus('PRIMA_SUSTITUCION_IA');
    const baseMonths = input.isAiReplacement ? 5 : 3;
    const legalNote = input.isAiReplacement
      ? 'Proyección: 3 meses constitucionales + 2 meses por sustitución por Inteligencia Artificial (propuesta en iniciativa congresional, NO vigente; total previsto hasta 5 meses). El finiquito legal en vigor es 3 meses + prima de antigüedad (Art. 50 LFT vigente).'
      : 'Indemnización constitucional de 3 meses y prima de antigüedad (Art. 50 LFT vigente).';

    return {
      dailyIntegratedSalaryMXN: sdi,
      tenureYears: years,
      constitutionalIndemnityMXN: constitutionalIndemnityCents / 100,
      aiReplacementPremiumMXN: aiReplacementPremiumCents / 100,
      seniorityPremiumMXN: seniorityCents / 100,
      totalSeveranceMXN: totalSeveranceCents / 100,
      breakdown: {
        baseMonthsIndemnity: baseMonths,
        isAiReplacement: input.isAiReplacement,
        legalNote,
        /** Estatuto del calendario de reformas: la prima IA NO es ley. */aiReplacementPremiumStatus: primaIA?.status ?? 'PENDING_INITIATIVE',
        minimumWageUsed: minimumWage,
        // Task 12: gap sub-registro declarado lado a lado (sin ocultamiento).
        registeredSalaryDeclared:
          input.registeredSalaryMXN != null && input.registeredSalaryMXN < sdi
            ? input.registeredSalaryMXN
            : null,
      },
    };
  }
}
