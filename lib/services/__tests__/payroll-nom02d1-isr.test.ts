import { describe, expect, it } from "vitest";
import {
  FACTOR_DIAS_MES_RLISR,
  resolveOrdinaryIsrForPeriod,
} from "../payroll-isr-service";
import { construirDesgloseNomina } from "../payroll-service";
import {
  SUBSIDIO_EMPLEO_2026,
  TARIFA_MENSUAL_2026,
} from "../isr-annual-withholding";

/**
 * Oráculo independiente de Anexo 8 RMF 2026 (DOF 28-dic-2025) y Decreto DOF 31-dic-2025.
 * Calcula manualmente sin invocar funciones internas del servicio bajo prueba.
 */
function independentMonthlyOracle(baseCents: number, month: number) {
  const row = TARIFA_MENSUAL_2026.find(
    (r) => baseCents >= r.limiteInferiorCents && baseCents <= r.limiteSuperiorCents
  )!;
  const excessPesos = (baseCents - row.limiteInferiorCents) / 100;
  const taxBeforeSubsidyCents = Math.round(
    (row.cuotaFijaCents / 100 + excessPesos * (row.tasaPorcentaje / 100)) * 100
  );
  const subsidyCents =
    baseCents <= SUBSIDIO_EMPLEO_2026.topeIngresoMensualCents
      ? month === 1
        ? SUBSIDIO_EMPLEO_2026.subsidioEneroCents
        : SUBSIDIO_EMPLEO_2026.subsidioMensualCents
      : 0;
  const applied = Math.min(taxBeforeSubsidyCents, subsidyCents);
  const net = Math.max(0, taxBeforeSubsidyCents - applied);
  return { taxBeforeSubsidyCents, subsidyCents, applied, net };
}

describe("NOM-02.d1 — ISR ordinario (Art. 96 LISR + Art. 175 RLISR, RMF 2026)", () => {
  it("declara versión, vigencia y fuente oficial DOF en cada resultado 2026", () => {
    const res = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 1_500_000, // $15,000.00 mensual
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      periodicity: "MONTHLY",
    });

    expect(res.status).toBe("CALCULATED");
    expect(res.tableVersion).toBe("RMF_2026_ANEXO_8_ART_96");
    expect(res.effectiveFrom).toBe("2026-01-01");
    expect(res.effectiveTo).toBe("2026-12-31");
    expect(res.officialSource).toContain("Anexo 8 RMF 2026");
    expect(res.officialSource).toContain("DOF 28-dic-2025");
    expect(res.method).toBe("ART_96_MENSUAL");
  });

  it("oráculo mensual 2026: coincide centavo a centavo en los 11 tramos y sus fronteras", () => {
    const boundaryBases: number[] = [];
    for (const row of TARIFA_MENSUAL_2026) {
      boundaryBases.push(row.limiteInferiorCents);
      if (row.limiteInferiorCents > 0) boundaryBases.push(row.limiteInferiorCents - 1);
      if (Number.isFinite(row.limiteSuperiorCents)) {
        boundaryBases.push(row.limiteSuperiorCents);
        boundaryBases.push(row.limiteSuperiorCents + 1);
      }
    }
    boundaryBases.push(50_000_000); // $500,000.00 último tramo (35%)

    for (const baseCents of boundaryBases) {
      if (baseCents === 0) continue;
      const actual = resolveOrdinaryIsrForPeriod({
        taxableBaseCents: baseCents,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        periodicity: "MONTHLY",
      });
      const expected = independentMonthlyOracle(baseCents, 5);
      expect(actual.impuestoAntesSubsidioCents).toBe(expected.taxBeforeSubsidyCents);
      expect(actual.subsidioCausadoCents).toBe(expected.subsidyCents);
      expect(actual.subsidioAplicadoCents).toBe(expected.applied);
      expect(actual.isrRetenidoCents).toBe(expected.net);
    }
  });

  it("oráculo subsidio al empleo 2026: frontera exacta del tope ($11,492.66 vs $11,492.67) y enero especial", () => {
    // Tope exacto en mayo (15.02% UMA 2026 = $535.65 = 53,565¢)
    const atCapMay = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 1_149_266,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      periodicity: "MONTHLY",
    });
    expect(atCapMay.subsidioCausadoCents).toBe(53_565);
    expect(atCapMay.subsidioAplicadoCents).toBe(53_565);
    expect(atCapMay.justification).toBe("ART_96_LISR_CON_SUBSIDIO");
    expect(atCapMay.isrRetenidoCents).toBe(
      independentMonthlyOracle(1_149_266, 5).net
    );

    // Un centavo arriba del tope ($11,492.67): subsidio = 0
    const aboveCapMay = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 1_149_267,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      periodicity: "MONTHLY",
    });
    expect(aboveCapMay.subsidioCausadoCents).toBe(0);
    expect(aboveCapMay.subsidioAplicadoCents).toBe(0);
    expect(aboveCapMay.justification).toBe("ART_96_LISR");

    // Enero 2026 especial (15.59% UMA 2025 = $536.21 = 53,621¢)
    const atCapJan = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 1_149_266,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      periodicity: "MONTHLY",
    });
    expect(atCapJan.subsidioCausadoCents).toBe(53_621);
    expect(atCapJan.isrRetenidoCents).toBe(
      independentMonthlyOracle(1_149_266, 1).net
    );
  });

  it("salario bajo cubierto 100% por subsidio al empleo nunca entrega efectivo (piso 0)", () => {
    // Salario mínimo mensual aprox $9,451.20 (945,120¢): impuesto antes subsidio > 0,
    // pero probamos $5,000.00 (500,000¢) donde ISR bruto ~$282.16 < subsidio $535.65
    const low = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 500_000,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      periodicity: "MONTHLY",
    });
    const expected = independentMonthlyOracle(500_000, 5);
    expect(expected.taxBeforeSubsidyCents).toBeGreaterThan(0);
    expect(expected.taxBeforeSubsidyCents).toBeLessThan(53_565);
    expect(low.isrRetenidoCents).toBe(0);
    expect(low.subsidioAplicadoCents).toBe(low.impuestoAntesSubsidioCents);
    expect(low.justification).toBe("CUBIERTO_POR_SUBSIDIO_EMPLEO");
  });

  it("oráculo sub-mensual (semanal 7d, catorcenal 14d, quincenal 15d) con factor 30.4 Art. 175 RLISR", () => {
    const cases: Array<{ days: number; start: string; end: string; base: number; periodicity: "WEEKLY" | "BIWEEKLY" | "QUINCENAL" }> = [
      { days: 7, start: "2026-05-04", end: "2026-05-10", base: 350_000, periodicity: "WEEKLY" },
      { days: 14, start: "2026-05-01", end: "2026-05-14", base: 700_000, periodicity: "BIWEEKLY" },
      { days: 15, start: "2026-05-01", end: "2026-05-15", base: 750_000, periodicity: "QUINCENAL" },
    ];

    for (const c of cases) {
      const res = resolveOrdinaryIsrForPeriod({
        taxableBaseCents: c.base,
        periodStart: c.start,
        periodEnd: c.end,
        periodDays: c.days,
        periodicity: c.periodicity,
      });
      const eqMonthly = Math.round((c.base / c.days) * FACTOR_DIAS_MES_RLISR);
      const oracleM = independentMonthlyOracle(eqMonthly, 5);
      const expTax = Math.round((oracleM.taxBeforeSubsidyCents / FACTOR_DIAS_MES_RLISR) * c.days);
      const expSub = Math.round((oracleM.subsidyCents / FACTOR_DIAS_MES_RLISR) * c.days);
      const expApplied = Math.min(expTax, expSub);
      const expNet = Math.max(0, expTax - expApplied);

      expect(res.status).toBe("CALCULATED");
      expect(res.method).toBe("ART_175_RLISR_PROPORCIONAL");
      expect(res.monthlyEquivalentBaseCents).toBe(eqMonthly);
      expect(res.impuestoAntesSubsidioCents).toBe(expTax);
      expect(res.subsidioCausadoCents).toBe(expSub);
      expect(res.subsidioAplicadoCents).toBe(expApplied);
      expect(res.isrRetenidoCents).toBe(expNet);
    }
  });

  it("base gravable cero produce ISR 0 con justificación BASE_GRAVABLE_CERO", () => {
    const res = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 0,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });
    expect(res.status).toBe("CALCULATED");
    expect(res.isrRetenidoCents).toBe(0);
    expect(res.justification).toBe("BASE_GRAVABLE_CERO");
  });

  it("ejercicio sin tabla oficial publicada (2025, 2027) devuelve MISSING_CONFIG sin fallback silencioso", () => {
    for (const year of [2025, 2027]) {
      const res = resolveOrdinaryIsrForPeriod({
        taxableBaseCents: 750_000,
        periodStart: `${year}-05-01`,
        periodEnd: `${year}-05-15`,
      });
      expect(res.status).toBe("MISSING_CONFIG");
      expect(res.tableVersion).toBeNull();
      expect(res.officialSource).toBeNull();
      expect(res.blockingReason).toContain(String(year));
      expect(res.justification).toBe("ISR_TABLE_NOT_CONFIGURED");
    }
  });

  it("rechaza entradas inválidas con RangeError", () => {
    expect(() =>
      resolveOrdinaryIsrForPeriod({
        taxableBaseCents: -100,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
      })
    ).toThrow(RangeError);
    expect(() =>
      resolveOrdinaryIsrForPeriod({
        taxableBaseCents: 100.5,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
      })
    ).toThrow(RangeError);
    expect(() =>
      resolveOrdinaryIsrForPeriod({
        taxableBaseCents: 100_000,
        periodStart: "2026-05-15",
        periodEnd: "2026-05-01",
      })
    ).toThrow(RangeError);
  });

  it("construirDesgloseNomina incluye nodo SAT 002 ISR cuando hay ISR retenido", () => {
    const isr = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 750_000,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      periodicity: "QUINCENAL",
    });
    expect(isr.isrRetenidoCents).toBeGreaterThan(0);

    const desglose = construirDesgloseNomina({
      baseSalaryCents: 750_000,
      propinasCents: 0,
      isrBreakdown: isr,
    });
    const nodo002 = desglose.desgloseDeducciones.find((d) => d.deductionTypeCode === "002");
    expect(nodo002).toBeDefined();
    expect(nodo002?.amount).toBe(isr.isrRetenidoCents);
  });
});
