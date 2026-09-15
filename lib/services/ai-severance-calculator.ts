/**
 * AI Severance Calculator (LFT Reform 2026 - Art. 50 & 439 Reform)
 * 
 * Computes statutory severance and special AI replacement indemnity (+2 months additional salary)
 * when employee position reduction or termination is directly caused by AI automation or AI substitution.
 */

export interface SeveranceCalculationInput {
  dailyIntegratedSalaryMXN: number; // Salario Diario Integrado (SDI)
  tenureYears: number;
  isAiReplacement: boolean; // True if termination is caused by AI substitution
  unpaidVacationDays?: number;
  proportionalAguinaldoDays?: number;
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
  };
}

export class AISeveranceCalculator {
  private static MINIMUM_WAGE_MXN = 278.80; // Zona general 2026

  /**
   * Calculate statutory severance including the LFT 2026 AI substitution premium.
   */
  static calculateSeverance(input: SeveranceCalculationInput): SeveranceCalculationResult {
    const sdi = input.dailyIntegratedSalaryMXN;
    const years = input.tenureYears;

    // 1. Indemnización Constitucional (3 meses = 90 días)
    const constitutionalIndemnity = sdi * 90;

    // 2. Prima por Sustitución de Inteligencia Artificial (2 meses adicionales = 60 días)
    const aiReplacementPremium = input.isAiReplacement ? sdi * 60 : 0;

    // 3. Prima de Antigüedad (12 días por año trabajado, topado a 2 salarios mínimos)
    const cappedDailyForSeniority = Math.min(sdi, this.MINIMUM_WAGE_MXN * 2);
    const seniorityPremium = cappedDailyForSeniority * 12 * years;

    // 4. Total
    const totalSeverance = constitutionalIndemnity + aiReplacementPremium + seniorityPremium;

    const baseMonths = input.isAiReplacement ? 5 : 3;
    const legalNote = input.isAiReplacement
      ? 'Indemnización incluye 3 meses constitucionales + 2 meses especiales por sustitución por Inteligencia Artificial (LFT 2026 Reform Art. 50/439).'
      : 'Indemnización constitucional estándar de 3 meses.';

    return {
      dailyIntegratedSalaryMXN: sdi,
      tenureYears: years,
      constitutionalIndemnityMXN: Math.round(constitutionalIndemnity * 100) / 100,
      aiReplacementPremiumMXN: Math.round(aiReplacementPremium * 100) / 100,
      seniorityPremiumMXN: Math.round(seniorityPremium * 100) / 100,
      totalSeveranceMXN: Math.round(totalSeverance * 100) / 100,
      breakdown: {
        baseMonthsIndemnity: baseMonths,
        isAiReplacement: input.isAiReplacement,
        legalNote,
      },
    };
  }
}
