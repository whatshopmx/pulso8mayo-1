import { describe, it, expect } from "vitest";
import { MentalHealthLeaveService } from "../services/mental-health-leave-service";
import { SalaryTransparencyService } from "../services/salary-transparency-service";
import leySillaTemplate from "../../templates/compliance/ley-silla-inspection-v1.json";

describe("Batch 2: Task 4 - Ley Silla Audit Template", () => {
  it("validates Ley Silla inspection template structure and compliance fields", () => {
    expect(leySillaTemplate.id).toBe("tpl-ley-silla-inspection-v1");
    expect(leySillaTemplate.complianceConfig.complianceType).toBe("LEY-SILLA-STPS-2026");
    expect(leySillaTemplate.pasos.length).toBeGreaterThanOrEqual(5);
    expect(leySillaTemplate.pasos.some(p => p.titulo.toLowerCase().includes("respaldo"))).toBe(true);
  });
});

describe("Batch 2: Task 5 - Mental Health Leave Service", () => {
  it("approves valid mental health leave up to 7 days with privacy shield", () => {
    const result = MentalHealthLeaveService.requestMentalHealthLeave({
      userId: "user-123",
      companyId: "company-456",
      daysRequested: 5,
      startDate: new Date("2026-09-20"),
      hasMedicalCertificate: true,
      priorDaysUsedThisYear: 0,
    });

    expect(result.success).toBe(true);
    expect(result.request?.daysRequested).toBe(5);
    expect(result.request?.privacyShielded).toBe(true);
    expect(result.message).toContain("privacidad de diagnóstico");
  });

  it("rejects mental health leave requests exceeding the annual 7-day limit", () => {
    const result = MentalHealthLeaveService.requestMentalHealthLeave({
      userId: "user-123",
      companyId: "company-456",
      daysRequested: 4,
      startDate: new Date("2026-10-01"),
      hasMedicalCertificate: true,
      priorDaysUsedThisYear: 5, // Already used 5 days (only 2 left)
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("excede los días disponibles");
  });
});

describe("Batch 2: Task 6 - Salary Transparency & Gender Pay Gap", () => {
  it("validates mandatory salary bands in job vacancies", () => {
    const invalidVacancy = SalaryTransparencyService.validateVacancySalaryVisibility({
      title: "Cocinero",
    });
    expect(invalidVacancy.isValid).toBe(false);
    expect(invalidVacancy.message).toContain("Transparencia Salarial");

    const validVacancy = SalaryTransparencyService.validateVacancySalaryVisibility({
      title: "Cocinero",
      salaryBandMin: 12000,
      salaryBandMax: 16000,
    });
    expect(validVacancy.isValid).toBe(true);
  });

  it("calculates gender pay gap and STPS Article 86 compliance status", () => {
    const employees = [
      { userId: "1", roleName: "Mesero", gender: "MALE" as const, monthlySalary: 10000 },
      { userId: "2", roleName: "Mesero", gender: "FEMALE" as const, monthlySalary: 10000 },
      { userId: "3", roleName: "Cocinero", gender: "MALE" as const, monthlySalary: 14000 },
      { userId: "4", roleName: "Cocinero", gender: "FEMALE" as const, monthlySalary: 14000 },
    ];

    const report = SalaryTransparencyService.calculateGenderPayGap(employees);
    expect(report.overallGapPercentage).toBe(0);
    expect(report.stpsAuditStatus).toBe("COMPLIANT");
  });
});
