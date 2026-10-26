import { describe, expect, it } from "vitest";
import { LABOR_LAW_SEED_RULES, assertLawCalendarRanges } from "@/lib/services/labor-law-seed-data";
import { minimumWageFixtures, umaFixtures } from "@/tests/fixtures/fiscal-2026";

describe("FIS-02A — catálogo fiscal canónico", () => {
    it("cubre el historial sin huecos ni solapamientos", () => {
        expect(() => assertLawCalendarRanges(LABOR_LAW_SEED_RULES)).not.toThrow();
        expect(LABOR_LAW_SEED_RULES[0].effectiveFrom).toBe("2020-01-01");
    });
    it.each(["2025-01-01", "2025-12-31", "2026-01-01", "2026-01-31", "2026-02-01", "2026-04-30", "2026-05-01", "2026-12-31"])("%s concuerda con los oráculos oficiales", (date) => {
        const matching = LABOR_LAW_SEED_RULES.filter((r) => r.effectiveFrom <= date && (!r.effectiveTo || date <= r.effectiveTo));
        expect(matching).toHaveLength(1);
        const minimum = minimumWageFixtures.find((f) => f.zone === "GENERAL" && f.from <= date && date <= f.to);
        const uma = umaFixtures.find((f) => f.from <= date && date <= f.to);
        expect(Math.round(Number(matching[0].minimumWageMxn) * 100)).toBe(minimum?.dailyCents);
        expect(matching[0].umaDailyMxn === null ? null : Math.round(Number(matching[0].umaDailyMxn) * 100)).toBe(uma?.dailyCents ?? null);
    });
    it("no inventa cifras históricas ni futuras", () => {
        const historical = LABOR_LAW_SEED_RULES.find((r) => r.effectiveFrom === "2020-01-01")!;
        expect(historical).toMatchObject({ minimumWageMxn: null, umaDailyMxn: null });
        expect(LABOR_LAW_SEED_RULES.find((r) => r.effectiveFrom === "2027-01-01")).toMatchObject({ minimumWageMxn: null, umaDailyMxn: "117.31", effectiveTo: "2027-01-31" });
        expect(LABOR_LAW_SEED_RULES.find((r) => r.effectiveFrom === "2027-02-01")).toMatchObject({ minimumWageMxn: null, umaDailyMxn: null });
    });
    it("rechaza intervalos ambiguos, huecos y rangos invertidos", () => {
        const base = { effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" };
        for (const second of [
            { effectiveFrom: "2026-01-31", effectiveTo: null },
            { effectiveFrom: "2026-02-02", effectiveTo: null },
            { effectiveFrom: "2026-02-01", effectiveTo: "2026-01-31" },
        ]) expect(() => assertLawCalendarRanges([base, second])).toThrow();
    });
});
