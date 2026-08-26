// Task 11 (plan-loteprod-gaps §8.1): merma por preparación vs rendimiento de ficha.
import { describe, expect, it } from "vitest";
import {
  compareYield,
  expectedPreparationWaste,
  YIELD_DEVIATION_THRESHOLD,
} from "../waste-yield";

describe("expectedPreparationWaste", () => {
  it("aplica el rendimiento de la ficha (crudo→cocido 87% deja 13% de merma)", () => {
    expect(expectedPreparationWaste(10, 87)).toBeCloseTo(1.3, 6);
  });

  it("rendimiento 100 o null no predice merma", () => {
    expect(expectedPreparationWaste(10, 100)).toBe(0);
    expect(expectedPreparationWaste(10, null)).toBe(0);
    expect(expectedPreparationWaste(10, undefined)).toBe(0);
  });

  it("procesado no positivo o inválido devuelve 0", () => {
    expect(expectedPreparationWaste(0, 87)).toBe(0);
    expect(expectedPreparationWaste(-5, 87)).toBe(0);
    expect(expectedPreparationWaste(Number.NaN, 87)).toBe(0);
  });

  it("acota rendimientos fuera de rango en vez de devolver negativos", () => {
    expect(expectedPreparationWaste(10, 120)).toBe(0);
    expect(expectedPreparationWaste(10, -20)).toBe(10);
  });
});

describe("compareYield", () => {
  it("merma dentro de lo esperado no se marca", () => {
    const r = compareYield({ processedQuantity: 100, actualWaste: 13, yieldPercent: 87 });
    expect(r.expectedQuantity).toBeCloseTo(13, 6);
    expect(r.flagged).toBe(false);
  });

  it("rendir de más nunca se marca", () => {
    const r = compareYield({ processedQuantity: 100, actualWaste: 8, yieldPercent: 87 });
    expect(r.flagged).toBe(false);
    expect(r.deviationRatio).toBeLessThan(0);
  });

  it("merma muy por encima del rendimiento se marca para revisión", () => {
    const r = compareYield({ processedQuantity: 100, actualWaste: 20, yieldPercent: 87 });
    expect(r.deviationRatio).toBeCloseTo(7 / 13, 6);
    expect(r.deviationRatio! > YIELD_DEVIATION_THRESHOLD).toBe(true);
    expect(r.flagged).toBe(true);
  });

  it("excedente por debajo del mínimo absoluto es ruido de báscula", () => {
    // 1.6 contra 1.3 esperados es +23% (sobre el umbral) pero solo 0.3 kg.
    const r = compareYield({ processedQuantity: 10, actualWaste: 1.6, yieldPercent: 87 });
    expect(r.deviationRatio! > YIELD_DEVIATION_THRESHOLD).toBe(true);
    expect(r.flagged).toBe(false);
  });

  it("ficha sin merma declarada: cualquier merma relevante se marca", () => {
    expect(compareYield({ processedQuantity: 10, actualWaste: 2, yieldPercent: 100 }).flagged).toBe(true);
    expect(compareYield({ processedQuantity: 10, actualWaste: 0.4, yieldPercent: 100 }).flagged).toBe(false);
  });

  it("deviationRatio es null cuando no hay esperada contra la cual medir", () => {
    const r = compareYield({ processedQuantity: 10, actualWaste: 2, yieldPercent: 100 });
    expect(r.deviationRatio).toBeNull();
  });

  it("umbral y mínimo son parametrizables", () => {
    const estricto = compareYield({
      processedQuantity: 100,
      actualWaste: 15,
      yieldPercent: 87,
      threshold: 0.1,
      minAbsolute: 0.1,
    });
    expect(estricto.flagged).toBe(true);
    const laxo = compareYield({
      processedQuantity: 100,
      actualWaste: 15,
      yieldPercent: 87,
      threshold: 0.5,
    });
    expect(laxo.flagged).toBe(false);
  });
});
