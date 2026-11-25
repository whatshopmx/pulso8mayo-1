import { describe, expect, it } from "vitest";
import {
  calculateMinimumIntegrationFactor,
  IMSS_WORKER_RATES_2026,
  resolveUmaForDate,
  resolveWorkerImssForPeriod,
} from "../payroll-imss-service";
import { construirDesgloseNomina } from "../payroll-service";

/**
 * Oráculo independiente de cuotas obreras LSS 2026.
 * Calcula cada rama directamente desde las fórmulas legales sin usar el servicio bajo prueba.
 */
function independentWorkerImssOracle(params: {
  dailySalaryCents: number;
  umaDailyCents: number;
  minimumWageDailyCents: number;
  quotedDays: number;
}) {
  if (params.quotedDays <= 0 || params.dailySalaryCents <= params.minimumWageDailyCents) {
    return 0;
  }
  const factor = 1 + 15 / 365 + (12 * 0.25) / 365;
  const sbc = Math.min(
    Math.round(params.dailySalaryCents * factor),
    params.umaDailyCents * 25
  );
  const exc = Math.max(0, sbc - params.umaDailyCents * 3);
  const r1 = Math.round((exc * params.quotedDays * 0.4) / 100);
  const r2 = Math.round((sbc * params.quotedDays * 0.25) / 100);
  const r3 = Math.round((sbc * params.quotedDays * 0.375) / 100);
  const r4 = Math.round((sbc * params.quotedDays * 0.625) / 100);
  const r5 = Math.round((sbc * params.quotedDays * 1.125) / 100);
  return r1 + r2 + r3 + r4 + r5;
}

describe("NOM-02.d2 — Deducción obrera de seguridad social (IMSS LSS 2026)", () => {
  it("resuelve UMA diaria oficial por vigencia: enero 2026 ($113.14) vs feb-dic 2026 ($117.31)", () => {
    expect(resolveUmaForDate("2026-01-15")?.umaDailyCents).toBe(11_314);
    expect(resolveUmaForDate("2026-02-01")?.umaDailyCents).toBe(11_731);
    expect(resolveUmaForDate("2026-05-15")?.umaDailyCents).toBe(11_731);
    expect(resolveUmaForDate("2027-03-01")).toBeNull();
  });

  it("oráculo independiente: salario estándar ($500/día, 15 días, mayo 2026) coincide en todas las ramas", () => {
    const res = resolveWorkerImssForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });

    const expected = independentWorkerImssOracle({
      dailySalaryCents: 50_000,
      umaDailyCents: 11_731,
      minimumWageDailyCents: 31_504,
      quotedDays: 15,
    });

    expect(res.status).toBe("CALCULATED");
    expect(res.ruleVersion).toBe("LSS_2026_OBRERO_V1");
    expect(res.officialSource).toContain("Ley del Seguro Social");
    expect(res.umaDailyCents).toBe(11_731);
    expect(res.quotedDays).toBe(15);
    expect(res.isMinimumWageExempt).toBe(false);
    expect(res.concepts).toHaveLength(5);
    expect(res.totalWorkerImssCents).toBe(expected);
    // SBC ≈ 52,466¢ > 3 UMA (35,193¢), así que E&M excedente > 0
    const exc = res.concepts.find((c) => c.branch === "EYM_EXCEDENTE_3_UMA")!;
    expect(exc.amountCents).toBeGreaterThan(0);
  });

  it("Art. 36 LSS: salario mínimo ($315.04/día) queda exento de cuota obrera con justificación explícita", () => {
    const res = resolveWorkerImssForPeriod({
      dailySalaryCents: 31_504,
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });

    expect(res.status).toBe("CALCULATED");
    expect(res.isMinimumWageExempt).toBe(true);
    expect(res.totalWorkerImssCents).toBe(0);
    expect(res.justification).toBe("ART_36_LSS_SALARIO_MINIMO_EXENTO");
  });

  it("Art. 28 LSS: tope superior de 25 UMA limita SBC de salarios ejecutivos altos", () => {
    const res = resolveWorkerImssForPeriod({
      dailySalaryCents: 500_000, // $5,000/día > 25 UMA ($2,932.75/día)
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });

    const expectedCap = 11_731 * IMSS_WORKER_RATES_2026.maxUmaCap; // 293,275¢
    expect(res.sbcCapDailyCents).toBe(expectedCap);
    expect(res.sbcCappedDailyCents).toBe(expectedCap);
    expect(res.totalWorkerImssCents).toBe(
      independentWorkerImssOracle({
        dailySalaryCents: 500_000,
        umaDailyCents: 11_731,
        minimumWageDailyCents: 31_504,
        quotedDays: 15,
      })
    );
  });

  it("Art. 31 LSS: ausentismos sin goce descuentan días cotizados; 0 días cotizados = 0 justificado", () => {
    const partial = resolveWorkerImssForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      unpaidAbsenceDays: 3,
    });
    expect(partial.quotedDays).toBe(12);
    expect(partial.totalWorkerImssCents).toBe(
      independentWorkerImssOracle({
        dailySalaryCents: 50_000,
        umaDailyCents: 11_731,
        minimumWageDailyCents: 31_504,
        quotedDays: 12,
      })
    );

    const zero = resolveWorkerImssForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      unpaidAbsenceDays: 15,
    });
    expect(zero.status).toBe("CALCULATED");
    expect(zero.quotedDays).toBe(0);
    expect(zero.totalWorkerImssCents).toBe(0);
    expect(zero.justification).toBe("SIN_DIAS_COTIZADOS");
  });

  it("sin base salarial o sin UMA vigente no simula deducción cero (MISSING_BASE / MISSING_CONFIG)", () => {
    const noBase = resolveWorkerImssForPeriod({
      dailySalaryCents: 0,
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });
    expect(noBase.status).toBe("MISSING_BASE");
    expect(noBase.justification).toBe("MISSING_SALARY_BASE");
    expect(noBase.blockingReason).toBeTruthy();

    const noUma = resolveWorkerImssForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      periodStart: "2027-05-01",
      periodEnd: "2027-05-15",
    });
    expect(noUma.status).toBe("MISSING_CONFIG");
    expect(noUma.justification).toBe("MISSING_UMA_CONFIG");
    expect(noUma.blockingReason).toContain("2027-05-15");
  });

  it("factor mínimo de integración año 1 es 1.049315...", () => {
    expect(calculateMinimumIntegrationFactor()).toBeCloseTo(1 + 18 / 365, 6);
  });

  it("construirDesgloseNomina emite nodo SAT 001 Seguridad social cuando hay IMSS obrero", () => {
    const imss = resolveWorkerImssForPeriod({
      dailySalaryCents: 50_000,
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });
    const desglose = construirDesgloseNomina({
      baseSalaryCents: 750_000,
      propinasCents: 0,
      imssObreroCents: imss.totalWorkerImssCents,
    });
    const nodo001 = desglose.desgloseDeducciones.find((d) => d.deductionTypeCode === "001");
    expect(nodo001).toBeDefined();
    expect(nodo001?.amount).toBe(imss.totalWorkerImssCents);
  });
});
