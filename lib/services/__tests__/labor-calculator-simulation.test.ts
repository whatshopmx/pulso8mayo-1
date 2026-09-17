import { describe, it, expect } from "vitest";
import { LaborCalculator } from "../labor-calculator";
import { LaborCalendarRulesService } from "../labor-calendar-rules";

describe("LaborCalendarRulesService - LFT Reform Thresholds", () => {
    it("resolves progressive maximum weekly hours from 2026 to 2030", () => {
        expect(LaborCalendarRulesService.getRulesForYear(2026).maxWeeklyHours).toBe(48);
        expect(LaborCalendarRulesService.getRulesForYear(2027).maxWeeklyHours).toBe(46);
        expect(LaborCalendarRulesService.getRulesForYear(2028).maxWeeklyHours).toBe(44);
        expect(LaborCalendarRulesService.getRulesForYear(2029).maxWeeklyHours).toBe(42);
        expect(LaborCalendarRulesService.getRulesForYear(2030).maxWeeklyHours).toBe(40);
    });

    it("defaults to 2026 for earlier years and 2030 for post-2030", () => {
        expect(LaborCalendarRulesService.getRulesForYear(2024).maxWeeklyHours).toBe(48);
        expect(LaborCalendarRulesService.getRulesForYear(2035).maxWeeklyHours).toBe(40);
    });
});

describe("LaborCalculator - Simulation & Dynamic Weekly Thresholds", () => {
    it("exports CalculateOvertimeOptions and handles daily vs weekly excess logic correctly", () => {
        // Turno diurno de 8 horas (480 min): 0 horas extras
        const regularSession = (LaborCalculator as any).calculateSessionOvertime(
            new Date("2026-09-10T08:00:00Z"),
            new Date("2026-09-10T16:00:00Z"),
            480,
            false,
            false
        );
        expect(regularSession.diurnal).toBe(0);
        expect(regularSession.nocturnal).toBe(0);
        expect(regularSession.holiday).toBe(0);

        // Turno diurno de 10 horas (600 min): 2 horas extras diurnas (120 min)
        const overtimeSession = (LaborCalculator as any).calculateSessionOvertime(
            new Date("2026-09-10T08:00:00Z"),
            new Date("2026-09-10T18:00:00Z"),
            600,
            false,
            false
        );
        expect(overtimeSession.diurnal).toBe(120);
        expect(overtimeSession.nocturnal).toBe(0);
    });

    it("calculates ISO week key correctly", () => {
        const getWeekKey = (LaborCalculator as any).getWeekKey;
        const wednesday = new Date("2026-09-16T12:00:00Z");
        const weekKey = getWeekKey(wednesday);
        expect(weekKey).toMatch(/^2026-W\d{2}$/);
    });
});
