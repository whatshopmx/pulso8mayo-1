import { describe, expect, it } from "vitest";
import { AISeveranceCalculator } from "@/lib/services/ai-severance-calculator";
import { minimumWageFixtures } from "@/tests/fixtures/fiscal-2026";

describe("FIS-03 — mínimo del finiquito", () => {
  it.each(minimumWageFixtures)("resuelve $from/$zone sin extrapolar", (fixture) => {
    for (const date of [fixture.from, fixture.to]) {
      expect(AISeveranceCalculator.minimumWageForDate(date, fixture.zone)).toBe(fixture.dailyCents / 100);
    }
  });

  it.each(["2024-12-31", "2027-01-01", "", "2026-02-30", "2026-01-01T00:00:00Z"])(
    "bloquea fecha sin vigencia publicada o inválida: %s", (date) => {
      expect(() => AISeveranceCalculator.minimumWageForDate(date, "GENERAL")).toThrow();
    },
  );

  it("no infiere una zona ausente o un estado completo", () => {
    for (const zone of [undefined, null, "", "Nuevo León"]) {
      expect(() => AISeveranceCalculator.minimumWageForDate("2026-01-01", zone as "GENERAL")).toThrow();
    }
  });

  it.each([undefined, null, 0, -1, NaN, Infinity])("rechaza mínimo sin resolver: %s", (minimum) => {
    expect(() => AISeveranceCalculator.calculateSeverance({
      dailyIntegratedSalaryMXN: 1_000, tenureYears: 2, isAiReplacement: false,
      minimumWageMxn: minimum as number,
    })).toThrow();
  });

  it.each([0, -1, NaN, Infinity, undefined])("bloquea salario inválido: %s", (salary) => {
    expect(() => AISeveranceCalculator.calculateSeverance({
      dailyIntegratedSalaryMXN: salary as number, tenureYears: 2,
      isAiReplacement: false, minimumWageMxn: 315.04,
    })).toThrow();
  });

  it.each([
    ["2025-12-31", "GENERAL", 13_382.40], ["2026-01-01", "GENERAL", 15_121.92],
    ["2025-12-31", "ZLFN", 20_154.24], ["2026-01-01", "ZLFN", 21_161.76],
  ] as const)("aplica tope 2 × mínimo %s/%s antes de 12 días/año", (date, zone, expected) => {
    const result = AISeveranceCalculator.calculateSeveranceForDate({
      effectiveDate: date, wageZone: zone,
      dailyIntegratedSalaryMXN: 1_000, tenureYears: 2, isAiReplacement: false,
    });
    expect(result.seniorityPremiumMXN).toBe(expected);
    expect(result.totalSeveranceMXN).toBe(90_000 + expected);
    expect(result.minimumWageRule).toMatchObject({ zone, effectiveFrom: `${date.slice(0, 4)}-01-01` });
    expect(result.minimumWageRule.sourceUrl).toMatch(/^https:\/\/sidof\.segob\.gob\.mx\//);
  });

  it("conserva el caso formal y declara el gap sin reducir el salario efectivo", () => {
    const input = { effectiveDate: "2026-12-31", wageZone: "GENERAL" as const,
      dailyIntegratedSalaryMXN: 600, tenureYears: 2, isAiReplacement: false };
    const formal = AISeveranceCalculator.calculateSeveranceForDate(input);
    const gap = AISeveranceCalculator.calculateSeveranceForDate({ ...input, registeredSalaryMXN: 315.04 });
    expect(formal.seniorityPremiumMXN).toBe(14_400);
    expect(formal.totalSeveranceMXN).toBe(68_400);
    expect(formal.breakdown.registeredSalaryDeclared).toBeNull();
    expect(gap.totalSeveranceMXN).toBe(formal.totalSeveranceMXN);
    expect(gap.breakdown.registeredSalaryDeclared).toBe(315.04);
  });
});
