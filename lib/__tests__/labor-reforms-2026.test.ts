import { describe, it, expect } from "vitest";
import { LaborCalendarRulesService } from "../services/labor-calendar-rules";
import { LeySillaService } from "../services/compliance/ley-silla-service";
import { calculateOvertime } from "../labor-validation";

describe("LaborCalendarRulesService (Mexico 2026-2030 Reforms)", () => {
  it("resolves dynamic weekly hours per effective year", () => {
    expect(LaborCalendarRulesService.getRulesForYear(2026).maxWeeklyHours).toBe(48);
    expect(LaborCalendarRulesService.getRulesForYear(2027).maxWeeklyHours).toBe(46);
    expect(LaborCalendarRulesService.getRulesForYear(2028).maxWeeklyHours).toBe(44);
    expect(LaborCalendarRulesService.getRulesForYear(2029).maxWeeklyHours).toBe(42);
    expect(LaborCalendarRulesService.getRulesForYear(2030).maxWeeklyHours).toBe(40);
  });

  it("prohibits overtime for minors under 18 years old", () => {
    const minorBirthDate = new Date();
    minorBirthDate.setFullYear(minorBirthDate.getFullYear() - 17); // 17 years old

    const adultBirthDate = new Date();
    adultBirthDate.setFullYear(adultBirthDate.getFullYear() - 25); // 25 years old

    expect(LaborCalendarRulesService.canScheduleOvertime(minorBirthDate).allowed).toBe(false);
    expect(LaborCalendarRulesService.canScheduleOvertime(minorBirthDate).reason).toContain("Menor de edad");
    expect(LaborCalendarRulesService.canScheduleOvertime(adultBirthDate).allowed).toBe(true);
  });

  it("scales double overtime allowances according to the active year", () => {
    // 8h regular + 10h extra (18h shift = 1080 min total)
    const overtime2030 = calculateOvertime(8 * 60 + 10 * 60, 0, 2030);
    expect(overtime2030.rate2Minutes).toBe(600); // 10 hours at double (within 12h = 720 min allowance)
    expect(overtime2030.rate3Minutes).toBe(0);
  });
});

describe("LeySillaService", () => {
  it("detects non-compliance when chairs with backrests are missing", () => {
    const evaluation = LeySillaService.evaluateRoleCompliance({
      companyId: "test-company",
      jobRole: "Cocinero",
      standingRiskType: "PROLONGADA",
      hoursStandingPerShift: 7,
      hasBackrestChair: false,
      seatLocation: "WORKSTATION",
      ritPausesConfigured: false,
      pauseIntervalMinutes: 180,
    });

    expect(evaluation.isCompliant).toBe(false);
    expect(evaluation.status).toBe("NON_COMPLIANT");
    expect(evaluation.violations.some(v => v.includes("Ley Silla"))).toBe(true);
  });

  it("approves compliant HORECA role setup with backrest chairs and RIT pauses", () => {
    const evaluation = LeySillaService.evaluateRoleCompliance({
      companyId: "test-company",
      jobRole: "Cajero",
      standingRiskType: "DINAMICA",
      hoursStandingPerShift: 3,
      hasBackrestChair: true,
      seatLocation: "WORKSTATION",
      ritPausesConfigured: true,
      pauseIntervalMinutes: 90,
    });

    expect(evaluation.isCompliant).toBe(true);
    expect(evaluation.status).toBe("COMPLIANT");
  });
});
