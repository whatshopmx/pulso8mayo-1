import { describe, expect, it } from "vitest";
import {
  confidencePercent,
  isAiPassed,
  normalizeConfidence,
} from "@/lib/ai/evidence-confidence";

describe("contrato de confianza de evidencia IA", () => {
  it("acepta la escala canónica 0–1", () => {
    expect(normalizeConfidence(0.92)).toBeCloseTo(0.92);
    expect(confidencePercent(0.92)).toBe(92);
    expect(confidencePercent(0)).toBe(0);
    expect(confidencePercent(1)).toBe(100);
  });

  it("normaliza el formato histórico 60–100 sin producir 9900 %", () => {
    expect(normalizeConfidence(99)).toBeCloseTo(0.99);
    expect(confidencePercent(99)).toBe(99);
    expect(confidencePercent("88")).toBe(88);
  });

  it("descarta valores fuera de rango en vez de inventar un porcentaje", () => {
    expect(normalizeConfidence(101)).toBeNull();
    expect(normalizeConfidence(-0.2)).toBeNull();
    expect(normalizeConfidence("no-es-numero")).toBeNull();
    expect(confidencePercent(null)).toBeNull();
  });

  it("sólo considera aprobado un true explícito", () => {
    expect(isAiPassed(true)).toBe(true);
    expect(isAiPassed("true")).toBe(true);
    expect(isAiPassed(false)).toBe(false);
    expect(isAiPassed(1)).toBe(false);
    expect(isAiPassed(undefined)).toBe(false);
  });
});
