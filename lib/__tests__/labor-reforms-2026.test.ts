import { describe, it, expect } from "vitest";
import { LaborCalendarRulesService } from "../services/labor-calendar-rules";
import { LeySillaService } from "../services/compliance/ley-silla-service";
import { calculateOvertime, validateOvertimeDistribution } from "../labor-validation";

describe("LaborCalendarRulesService (Mexico 2026-2030 Reforms)", () => {
  it("resolves dynamic weekly hours per effective year", () => {
    expect(LaborCalendarRulesService.getRulesForYear(2026).maxWeeklyHours).toBe(48);
    expect(LaborCalendarRulesService.getRulesForYear(2027).maxWeeklyHours).toBe(46);
    expect(LaborCalendarRulesService.getRulesForYear(2028).maxWeeklyHours).toBe(44);
    expect(LaborCalendarRulesService.getRulesForYear(2029).maxWeeklyHours).toBe(42);
    expect(LaborCalendarRulesService.getRulesForYear(2030).maxWeeklyHours).toBe(40);
  });

  it("HOTFIX DOF 1-may-2026: Art. 68 vigente ya permite 4h de triple en 2026 (antes mapa decía 0)", () => {
    expect(LaborCalendarRulesService.getRulesForYear(2026).maxWeeklyTripleOvertimeCap).toBe(4);
    expect(LaborCalendarRulesService.getRulesForYear(2026).maxExtraHoursPerDay).toBe(4);
    expect(LaborCalendarRulesService.getRulesForYear(2026).maxExtraDaysPerWeek).toBe(4);
    expect(LaborCalendarRulesService.getRulesForYear(2026).maxDailySumHours).toBe(12);
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

describe("validateOvertimeDistribution (Art. 66/68, DOF 1-may-2026)", () => {
  it("semana legal (extras dentro de 4h/día, 4 días, 13h senales) no produce violaciones", () => {
    // 2h+3h+4h+1h = 10h de extra en 4 días: dentro del tope doble+triple de 13h.
    expect(validateOvertimeDistribution([120, 180, 240, 60], 2026)).toEqual([]);
  });

  it("extra diaria mayor a 4h viola Art. 66 Y la suma de 12h (día de 13h = doble infracción)", () => {
    // 8h ordinarias + 5h extra = 13h: viola el tope de 4h/día (Art. 66)
    // y la suma máxima diaria de 12h (Art. 68) — dos violaciones de la
    // misma jornada.
    const violations = validateOvertimeDistribution([300, 0, 0, 0], 2026);
    expect(violations).toHaveLength(2);
    expect(violations.map(v => v.code).sort()).toEqual(["DAILY_EXTRA_EXCEEDED", "DAILY_SUM_EXCEEDED"]);
  });

  it("5 días con extra viola el tope de 4 días con extra (Art. 66)", () => {
    const violations = validateOvertimeDistribution([60, 60, 60, 60, 60], 2026);
    expect(violations.some(v => v.code === "TOO_MANY_EXTRA_DAYS")).toBe(true);
  });

  it("semana con total > doble+triple (13h en 2026) viola Art. 68", () => {
    // 5h + 5h + 4h = 14h de extra en 3 dias — todo ≤4h/día pero > 13h semanales.
    const violations = validateOvertimeDistribution([300, 300, 240], 2026);
    expect(violations.some(v => v.code === "TRIPLE_CAP_EXCEEDED")).toBe(true);
  });

  it("jornada de 13h (8h ordinarias + 5h extra) viola la suma maxima de 12h diarias", () => {
    const violations = validateOvertimeDistribution([300], 2026);
    expect(violations.some(v => v.code === "DAILY_SUM_EXCEEDED")).toBe(true);
  });

  it("escalones futuros: el tope semanal crece a doble 12h + triple 4 = 16h en 2030", () => {
    expect(validateOvertimeDistribution([240, 240, 240, 240], 2030)).toEqual([]);
    expect(validateOvertimeDistribution([240, 240, 240, 240], 2026).some(v => v.code === "TRIPLE_CAP_EXCEEDED")).toBe(true);
  });

  it("extras negativos (dato sucio) no cuentan", () => {
    expect(validateOvertimeDistribution([-60, 60], 2026)).toEqual([]);
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
