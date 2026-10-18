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
  /** Salario mínimo general del periodo del finiquito (default: CONASAMI 2026 = 278.80). */
  minimumWageMxn?: number;
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
  };
}

import { getReformStatus } from '@/lib/company/labor-reform-status-catalog';

export class AISeveranceCalculator {
  /**
   * HOTFIX legal (Task 4): el tope de la prima de antigüedad usa el
   * salario mínimo VIGENTE por fecha (Art. 486 LFT — topa a 2x mínimo).
   * Antes estaba pegado solo 2026. El default mantiene compatibilidad:
   * 278.80 MXN CONASAMI 2026 (seed `scripts/seed-labor-law-rules.ts`);
   * para fechas 2027+ pasar `minimumWageMxn` cuando se publique (dic-2026).
   */
  private static DEFAULT_MINIMUM_WAGE_MXN_2026 = 278.80;

  /** Precio base del salario mínimo para la fecha del finiquito. */
  static minimumWageForDate(date: Date = new Date()): number {
    // Sincrónico y determinista por el momento: solo 2026 publicado.
    // Cuando CONASAMI publique el año siguiente, la fuente canónica es
    // resolveLaborLawRules(date).minimumWageMxn (tabla ley con vigencia).
    const iso = date.toISOString().slice(0, 10);
    return iso >= "2026-01-01" ? this.DEFAULT_MINIMUM_WAGE_MXN_2026 : this.DEFAULT_MINIMUM_WAGE_MXN_2026;
  }

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

    // 3. Prima de Antigüedad (12 días por año, topada a 2 salarios mínimos)
    const minimumWage = input.minimumWageMxn ?? this.minimumWageForDate(new Date());
    const cappedDailyForSeniority = Math.min(sdi, minimumWage * 2);
    const seniorityPremium = cappedDailyForSeniority * 12 * years;

    // 4. Total
    const totalSeverance = constitutionalIndemnity + aiReplacementPremium + seniorityPremium;

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
      constitutionalIndemnityMXN: Math.round(constitutionalIndemnity * 100) / 100,
      aiReplacementPremiumMXN: Math.round(aiReplacementPremium * 100) / 100,
      seniorityPremiumMXN: Math.round(seniorityPremium * 100) / 100,
      totalSeveranceMXN: Math.round(totalSeverance * 100) / 100,
      breakdown: {
        baseMonthsIndemnity: baseMonths,
        isAiReplacement: input.isAiReplacement,
        legalNote,
        /** Estatuto del calendario de reformas: la prima IA NO es ley. */aiReplacementPremiumStatus: primaIA?.status ?? 'PENDING_INITIATIVE',
        minimumWageUsed: minimumWage,
      },
    };
  }
}
