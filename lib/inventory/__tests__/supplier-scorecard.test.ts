// lib/inventory/__tests__/supplier-scorecard.test.ts
import { describe, expect, it } from "vitest";
import {
  computeNom251Score,
  computePunctualityScore,
  computeQualityScore,
  computeSupplierScorecard,
  resolveScorecardTier,
} from "../supplier-scorecard";

describe("computePunctualityScore", () => {
  it("sin entregas retorna 100", () => {
    expect(computePunctualityScore(0, 0)).toBe(100);
  });

  it("10 de 10 a tiempo retorna 100", () => {
    expect(computePunctualityScore(10, 10)).toBe(100);
  });

  it("8 de 10 a tiempo retorna 80", () => {
    expect(computePunctualityScore(8, 10)).toBe(80);
  });

  it("0 de 5 a tiempo retorna 0", () => {
    expect(computePunctualityScore(0, 5)).toBe(0);
  });
});

describe("computeQualityScore", () => {
  it("sin recepciones ni reclamos retorna 100", () => {
    expect(computeQualityScore(0, 0, 0)).toBe(100);
  });

  it("sin recepciones pero con reclamos aplica penalización", () => {
    expect(computeQualityScore(0, 0, 2)).toBe(60);
  });

  it("10 recepciones perfectas sin reclamos retorna 100", () => {
    expect(computeQualityScore(10, 10, 0)).toBe(100);
  });

  it("10 recepciones, 8 sin discrepancia y 1 reclamo aplica deducción", () => {
    // 8/10 = 80 - (1 * 5) = 75
    expect(computeQualityScore(8, 10, 1)).toBe(75);
  });
});

describe("computeNom251Score", () => {
  it("sin lecturas térmicas requeridas retorna 100", () => {
    expect(computeNom251Score(0, 0)).toBe(100);
  });

  it("todas conformes retorna 100", () => {
    expect(computeNom251Score(20, 20)).toBe(100);
  });

  it("18 conformes de 20 retorna 90", () => {
    expect(computeNom251Score(18, 20)).toBe(90);
  });
});

describe("resolveScorecardTier", () => {
  it(">=90 es EXCELENTE", () => {
    expect(resolveScorecardTier(95)).toBe("EXCELENTE");
    expect(resolveScorecardTier(90)).toBe("EXCELENTE");
  });

  it("75 a 89 es ACEPTABLE", () => {
    expect(resolveScorecardTier(85)).toBe("ACEPTABLE");
    expect(resolveScorecardTier(75)).toBe("ACEPTABLE");
  });

  it("60 a 74 es EN_RIESGO", () => {
    expect(resolveScorecardTier(65)).toBe("EN_RIESGO");
    expect(resolveScorecardTier(60)).toBe("EN_RIESGO");
  });

  it("<60 es CRITICO", () => {
    expect(resolveScorecardTier(59)).toBe("CRITICO");
    expect(resolveScorecardTier(0)).toBe("CRITICO");
  });
});

describe("computeSupplierScorecard — Ponderación Integral", () => {
  it("proveedor perfecto obtiene 100 y tier EXCELENTE", () => {
    const result = computeSupplierScorecard({
      onTimeDeliveries: 10,
      totalDeliveries: 10,
      flawlessReceivings: 10,
      totalReceivings: 10,
      claimsCount: 0,
      compliantTempReadings: 10,
      totalTempReadings: 10,
    });

    expect(result.punctualityScore).toBe(100);
    expect(result.qualityScore).toBe(100);
    expect(result.nom251ComplianceScore).toBe(100);
    expect(result.totalScore).toBe(100);
    expect(result.tier).toBe("EXCELENTE");
  });

  it("proveedor con fallas térmicas y tardanzas calcula correctamente pesos (35/35/30)", () => {
    // Puntualidad: 80% (* 0.35 = 28)
    // Calidad: 80% (* 0.35 = 28)
    // NOM-251: 50% (* 0.30 = 15)
    // Total = 28 + 28 + 15 = 71 -> EN_RIESGO
    const result = computeSupplierScorecard({
      onTimeDeliveries: 8,
      totalDeliveries: 10,
      flawlessReceivings: 8,
      totalReceivings: 10,
      claimsCount: 0,
      compliantTempReadings: 5,
      totalTempReadings: 10,
    });

    expect(result.punctualityScore).toBe(80);
    expect(result.qualityScore).toBe(80);
    expect(result.nom251ComplianceScore).toBe(50);
    expect(result.totalScore).toBe(71);
    expect(result.tier).toBe("EN_RIESGO");
  });
});
