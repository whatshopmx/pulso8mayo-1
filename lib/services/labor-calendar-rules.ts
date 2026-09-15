/**
 * Labor Calendar Rules Service
 * 
 * Manages the progressive transition of Mexican Labor Law (LFT Art. 123 Reform)
 * for maximum weekly work hours, overtime allowances (double/triple banding),
 * and special employee safeguards (e.g., minors under 18).
 */

export interface LaborYearlyRule {
  year: number;
  maxWeeklyHours: number;
  maxWeeklyDoubleOvertimeHours: number;
  maxWeeklyTripleOvertimeCap: number; // Max triple overtime hours allowed
  minRestBetweenShiftsHours: number;
}

export const LFT_SCHEDULED_REFORMS: Record<number, LaborYearlyRule> = {
  2026: {
    year: 2026,
    maxWeeklyHours: 48,
    maxWeeklyDoubleOvertimeHours: 9,
    maxWeeklyTripleOvertimeCap: 0, // Unrestricted surplus prior to 2027-2030 cap rules
    minRestBetweenShiftsHours: 12,
  },
  2027: {
    year: 2027,
    maxWeeklyHours: 46,
    maxWeeklyDoubleOvertimeHours: 9,
    maxWeeklyTripleOvertimeCap: 4,
    minRestBetweenShiftsHours: 12,
  },
  2028: {
    year: 2028,
    maxWeeklyHours: 44,
    maxWeeklyDoubleOvertimeHours: 10,
    maxWeeklyTripleOvertimeCap: 4,
    minRestBetweenShiftsHours: 12,
  },
  2029: {
    year: 2029,
    maxWeeklyHours: 42,
    maxWeeklyDoubleOvertimeHours: 11,
    maxWeeklyTripleOvertimeCap: 4,
    minRestBetweenShiftsHours: 12,
  },
  2030: {
    year: 2030,
    maxWeeklyHours: 40,
    maxWeeklyDoubleOvertimeHours: 12,
    maxWeeklyTripleOvertimeCap: 4,
    minRestBetweenShiftsHours: 12,
  },
};

export class LaborCalendarRulesService {
  /**
   * Resolve the active yearly LFT labor rules.
   * If year is before 2026, defaults to 2026. If year > 2030, defaults to 2030.
   */
  static getRulesForYear(year: number = new Date().getFullYear()): LaborYearlyRule {
    if (year < 2026) return LFT_SCHEDULED_REFORMS[2026];
    if (year > 2030) return LFT_SCHEDULED_REFORMS[2030];
    return LFT_SCHEDULED_REFORMS[year] || LFT_SCHEDULED_REFORMS[2026];
  }

  /**
   * Check if employee is eligible for overtime (minors under 18 are prohibited).
   */
  static canScheduleOvertime(birthDate?: Date | string | null): { allowed: boolean; reason?: string } {
    if (!birthDate) return { allowed: true };
    const date = new Date(birthDate);
    if (isNaN(date.getTime())) return { allowed: true };

    const age = this.calculateAge(date);
    if (age < 18) {
      return {
        allowed: false,
        reason: `Menor de edad (${age} años): la LFT prohíbe el trabajo extraordinario a menores de 18 años.`,
      };
    }
    return { allowed: true };
  }

  private static calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }
}
