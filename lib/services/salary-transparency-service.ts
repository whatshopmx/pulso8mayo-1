/**
 * Salary Transparency & Equal Pay Service (LFT Art. 86 Reform)
 * 
 * Manages salary range tabulators for job vacancy publishing and validates
 * equal pay compliance across gender and age tiers for equal-value roles.
 */

export interface SalaryBand {
  id: string;
  companyId: string;
  roleName: string; // Cocinero, Mesero, Cajero, Gerente
  tierLevel: string; // JUNIOR, MID, SENIOR, LEAD
  minMonthlySalary: number; // In MXN
  maxMonthlySalary: number; // In MXN
  currency: string;
  isPublicInVacancies: boolean;
}

export interface GenderPayGapReport {
  companyId: string;
  generatedAt: string;
  overallGapPercentage: number; // Positive means men earn more, negative means women earn more
  roleBreakdown: Array<{
    roleName: string;
    maleAvgSalary: number;
    femaleAvgSalary: number;
    gapPercentage: number;
    isCompliant: boolean;
    maleCount: number;
    femaleCount: number;
  }>;
  stpsAuditStatus: 'COMPLIANT' | 'WARNING_AUDIT_REQUIRED' | 'HIGH_RISK';
}

export class SalaryTransparencyService {
  /**
   * Validate if a job posting contains transparent salary bands as required by 2026 LFT reform.
   */
  static validateVacancySalaryVisibility(vacancy: {
    title: string;
    salaryBandMin?: number;
    salaryBandMax?: number;
  }): { isValid: boolean; message: string } {
    if (!vacancy.salaryBandMin || !vacancy.salaryBandMax || vacancy.salaryBandMin <= 0) {
      return {
        isValid: false,
        message: 'La vacante incumple la Reforma de Transparencia Salarial (LFT): Debe incluir el tabulador salarial visible desde la publicación.',
      };
    }
    return { isValid: true, message: 'Vacante cumple con transparencia salarial LFT.' };
  }

  /**
   * Calculate gender pay gap metrics for STPS Article 86 inspections.
   */
  static calculateGenderPayGap(employees: Array<{
    userId: string;
    roleName: string;
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    monthlySalary: number;
  }>): GenderPayGapReport {
    const roleMap: Record<string, { maleSalaries: number[]; femaleSalaries: number[] }> = {};

    employees.forEach(emp => {
      if (!roleMap[emp.roleName]) {
        roleMap[emp.roleName] = { maleSalaries: [], femaleSalaries: [] };
      }
      if (emp.gender === 'MALE') roleMap[emp.roleName].maleSalaries.push(emp.monthlySalary);
      if (emp.gender === 'FEMALE') roleMap[emp.roleName].femaleSalaries.push(emp.monthlySalary);
    });

    let totalMaleSum = 0;
    let totalMaleCount = 0;
    let totalFemaleSum = 0;
    let totalFemaleCount = 0;

    const roleBreakdown = Object.entries(roleMap).map(([roleName, data]) => {
      const maleAvg = data.maleSalaries.length > 0 ? data.maleSalaries.reduce((a, b) => a + b, 0) / data.maleSalaries.length : 0;
      const femaleAvg = data.femaleSalaries.length > 0 ? data.femaleSalaries.reduce((a, b) => a + b, 0) / data.femaleSalaries.length : 0;

      totalMaleSum += data.maleSalaries.reduce((a, b) => a + b, 0);
      totalMaleCount += data.maleSalaries.length;
      totalFemaleSum += data.femaleSalaries.reduce((a, b) => a + b, 0);
      totalFemaleCount += data.femaleSalaries.length;

      let gapPercentage = 0;
      if (maleAvg > 0) {
        gapPercentage = Math.round(((maleAvg - femaleAvg) / maleAvg) * 10000) / 100;
      }

      // Compliant if gap is <= 5%
      const isCompliant = Math.abs(gapPercentage) <= 5;

      return {
        roleName,
        maleAvgSalary: Math.round(maleAvg),
        femaleAvgSalary: Math.round(femaleAvg),
        gapPercentage,
        isCompliant,
        maleCount: data.maleSalaries.length,
        femaleCount: data.femaleSalaries.length,
      };
    });

    const overallMaleAvg = totalMaleCount > 0 ? totalMaleSum / totalMaleCount : 0;
    const overallFemaleAvg = totalFemaleCount > 0 ? totalFemaleSum / totalFemaleCount : 0;
    const overallGapPercentage = overallMaleAvg > 0 ? Math.round(((overallMaleAvg - overallFemaleAvg) / overallMaleAvg) * 10000) / 100 : 0;

    let stpsAuditStatus: 'COMPLIANT' | 'WARNING_AUDIT_REQUIRED' | 'HIGH_RISK' = 'COMPLIANT';
    if (Math.abs(overallGapPercentage) > 15) {
      stpsAuditStatus = 'HIGH_RISK';
    } else if (Math.abs(overallGapPercentage) > 5) {
      stpsAuditStatus = 'WARNING_AUDIT_REQUIRED';
    }

    return {
      companyId: 'current-company',
      generatedAt: new Date().toISOString(),
      overallGapPercentage,
      roleBreakdown,
      stpsAuditStatus,
    };
  }
}
