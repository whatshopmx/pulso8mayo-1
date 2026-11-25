import { describe, expect, it } from "vitest";
import {
  CEAV_EMPLOYER_TABLE_2026,
  DEFAULT_CLASS_I_WORK_RISK_PCT,
  resolveCeavEmployerRate2026,
  resolveEmployerSocialSecurityForPeriod,
} from "../payroll-imss-service";

describe("NOM-02.e — Carga patronal por ramas LSS + INFONAVIT + ISN (sustituye 35% fijo)", () => {
  it("clasifica correctamente los 8 rangos de CEAV patronal 2026 (Decreto DOF 16-dic-2020)", () => {
    const uma = 11_731;
    const minWage = 31_504;
    expect(resolveCeavEmployerRate2026(31_504, uma, minWage).ratePct).toBe(3.15);
    expect(resolveCeavEmployerRate2026(Math.round(uma * 3.1), uma, minWage).ratePct).toBe(5.874);
    expect(resolveCeavEmployerRate2026(Math.round(uma * 3.8), uma, minWage).ratePct).toBe(6.115);
    expect(resolveCeavEmployerRate2026(Math.round(uma * 4.5), uma, minWage).ratePct).toBe(7.513);
    expect(CEAV_EMPLOYER_TABLE_2026).toHaveLength(8);
  });

  it("con prima de riesgo de trabajo e ISN explícitos devuelve MEASURED y cuadra rama por rama", () => {
    const res = resolveEmployerSocialSecurityForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      isnTaxableBaseCents: 750_000,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      workRiskPremiumPercent: 1.13065, // Clase II
      statePayrollTaxPercent: 3.0, // 3% ISN estatal
    });

    expect(res.status).toBe("MEASURED");
    expect(res.missingParameters).toEqual([]);
    expect(res.officialSource).toContain("Ley del Seguro Social");
    expect(res.stateTaxIsnCents).toBe(Math.round((750_000 * 3.0) / 100)); // 22,500¢
    expect(res.infonavitCents).toBe(Math.round((res.sbcCappedDailyCents * 15 * 5.0) / 100));
    expect(res.totalEmployerBurdenCents).toBe(
      res.imssEmployerCents + res.infonavitCents + res.stateTaxIsnCents
    );
    // Ya no es 35% fijo de 750,000 (= 262,500¢)
    expect(res.totalEmployerBurdenCents).not.toBe(Math.round(750_000 * 0.35));
    expect(res.concepts.every((c) => !c.isEstimated)).toBe(true);
  });

  it("sin prima de riesgo o sin ISN conserva etiqueta ESTIMATED y nunca acredita MEASURED", () => {
    const res = resolveEmployerSocialSecurityForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      isnTaxableBaseCents: 750_000,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      allowEstimatedWorkRisk: true,
    });

    expect(res.status).toBe("ESTIMATED");
    expect(res.missingParameters).toEqual([
      "WORK_RISK_PREMIUM_PERCENT",
      "STATE_PAYROLL_TAX_PERCENT",
    ]);
    expect(res.stateTaxIsnCents).toBe(0);
    const rt = res.concepts.find((c) => c.branch === "RIESGO_DE_TRABAJO")!;
    expect(rt.ratePct).toBe(DEFAULT_CLASS_I_WORK_RISK_PCT);
    expect(rt.isEstimated).toBe(true);
  });

  it("sin UMA vigente para 2027 devuelve MISSING_CONFIG sin inventar 35%", () => {
    const res = resolveEmployerSocialSecurityForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      isnTaxableBaseCents: 750_000,
      periodStart: "2027-05-01",
      periodEnd: "2027-05-15",
      workRiskPremiumPercent: 0.54355,
      statePayrollTaxPercent: 3.0,
    });

    expect(res.status).toBe("MISSING_CONFIG");
    expect(res.totalEmployerBurdenCents).toBe(0);
    expect(res.missingParameters).toContain("UMA_DAILY");
  });
});
