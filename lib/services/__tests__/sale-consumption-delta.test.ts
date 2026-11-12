import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { planSaleConsumptionDelta } from "../sale-consumption-delta";
import type { AppliedSaleAllocation } from "../sale-consumption-contract";

const allocation = (movementId: string, batchId: string, remainingQuantity: string): AppliedSaleAllocation =>
  ({ movementId, batchId, itemId: "ingredient", unit: "KG", remainingQuantity });
const demand = (quantity: string) => [{ itemId: "ingredient", unit: "KG", quantity }];

describe("INV-01.b1: diferencial exacto y procedencia", () => {
  it("10→12 requiere solo dos unidades adicionales", () => {
    const result = planSaleConsumptionDelta([allocation("m1", "b1", "10.0000")], demand("12"));
    expect(result.returns).toEqual([]);
    expect(result.consume).toEqual(demand("2.0000"));
    expect(result.retained).toEqual([allocation("m1", "b1", "10.0000")]);
  });
  it("12→8 devuelve cuatro al movimiento/lote original, empezando por la última asignación", () => {
    const result = planSaleConsumptionDelta([allocation("m1", "b1", "10"), allocation("m2", "b2", "2")], demand("8"));
    expect(result.consume).toEqual([]);
    expect(result.returns).toEqual([
      { ...allocation("m2", "b2", "2.0000"), quantity: "2.0000" },
      { ...allocation("m1", "b1", "10.0000"), quantity: "2.0000" },
    ]);
    expect(result.retained).toEqual([allocation("m1", "b1", "8.0000")]);
  });
  it("repetir no planea movimientos ni modifica las asignaciones de entrada", () => {
    const previous = [allocation("m1", "b1", "0.3000")];
    const before = structuredClone(previous);
    expect(planSaleConsumptionDelta(previous, demand("0.3"))).toEqual({ retained: before, returns: [], consume: [] });
    expect(previous).toEqual(before);
  });
  it("anular devuelve cada lote original, sin necesitar FEFO actual", () => {
    const result = planSaleConsumptionDelta([allocation("m1", "expired", "0.1"), allocation("m2", "empty", "0.2")], []);
    expect(result.retained).toEqual([]);
    expect(result.consume).toEqual([]);
    expect(result.returns.map(r => [r.batchId, r.movementId, r.quantity])).toEqual([["empty", "m2", "0.2000"], ["expired", "m1", "0.1000"]]);
  });
  it("cambio de receta revierte y aplica incluso con la misma demanda física", () => {
    const result = planSaleConsumptionDelta([allocation("m1", "b1", "10")], demand("10"), true);
    expect(result.retained).toEqual([]);
    expect(result.returns[0]).toMatchObject({ movementId: "m1", quantity: "10.0000" });
    expect(result.consume).toEqual(demand("10.0000"));
  });
  it("agrupa ingredientes repetidos y conserva precisión de cuatro decimales", () => {
    expect(planSaleConsumptionDelta([], [...demand("0.1"), ...demand("0.2")]).consume).toEqual(demand("0.3000"));
    expect(planSaleConsumptionDelta([allocation("m1", "b1", "0.3000")], demand("0.2999")).returns[0].quantity).toBe("0.0001");
  });
  it("usa demanda total redondeada por el snapshot, sin escalar asignaciones ya redondeadas", () => {
    expect(planSaleConsumptionDelta([allocation("m1", "b1", "0.3333")], demand("0.6667")).consume).toEqual(demand("0.3334"));
  });
  it("no mezcla ingredientes ni unidades de la procedencia", () => {
    expect(() => planSaleConsumptionDelta([allocation("m1", "b1", "1")], [{ itemId: "ingredient", unit: "G", quantity: "1000" }])).toThrow(/unidad/i);
    const result = planSaleConsumptionDelta([allocation("m1", "b1", "1")], [{ itemId: "other", unit: "KG", quantity: "1" }]);
    expect(result.returns).toHaveLength(1);
    expect(result.consume[0].itemId).toBe("other");
  });
  it.each(["-1", "NaN", "1e3", "0.00001", "100000000", "", " 1", ".5"])("rechaza cantidad física inválida %s", quantity => {
    expect(() => planSaleConsumptionDelta([], demand(quantity))).toThrow();
  });
  it("rechaza desbordamiento al sumar necesidades", () => {
    expect(() => planSaleConsumptionDelta([], [...demand("99999999.9999"), ...demand("0.0001")])).toThrow(/rango/i);
  });
  it("rechaza asignaciones duplicadas, agotadas o sin procedencia", () => {
    const a = allocation("m1", "b1", "1");
    expect(() => planSaleConsumptionDelta([a, a], [])).toThrow(/duplicad/i);
    for (const change of [{ remainingQuantity: "0" }, { movementId: "" }, { batchId: "" }, { itemId: "" }, { unit: "" }]) {
      expect(() => planSaleConsumptionDelta([{ ...a, ...change }], [])).toThrow();
    }
  });
  it("conserva demanda cero sin crear movimientos vacíos", () => {
    expect(planSaleConsumptionDelta([], demand("0"))).toEqual({ retained: [], returns: [], consume: [] });
  });
  it("conserva saldo y procedencia en secuencias de correcciones y cambios de receta", () => {
    const fmt = (quantity: number) => (quantity / 10000).toFixed(4);
    const ticks = (quantity: string) => Math.round(Number(quantity) * 10000);
    fc.assert(fc.property(fc.array(fc.record({ quantity: fc.integer({ min: 0, max: 1000000 }), changed: fc.boolean() }), { minLength: 2, maxLength: 30 }), steps => {
      let applied: AppliedSaleAllocation[] = [];
      let totalConsumed = 0, totalReturned = 0, sequence = 0;
      for (const step of steps) {
        const before = new Map(applied.map(row => [row.movementId, row]));
        const plan = planSaleConsumptionDelta(applied, demand(fmt(step.quantity)), step.changed);
        for (const returned of plan.returns) {
          expect(returned.batchId).toBe(before.get(returned.movementId)?.batchId);
          expect(ticks(returned.quantity)).toBeLessThanOrEqual(ticks(before.get(returned.movementId)!.remainingQuantity));
          totalReturned += ticks(returned.quantity);
        }
        if (step.changed) expect(plan.retained).toEqual([]);
        applied = [...plan.retained];
        for (const row of plan.consume) {
          totalConsumed += ticks(row.quantity);
          applied.push(allocation(`movement-${++sequence}`, `batch-${sequence}`, row.quantity));
        }
        expect(totalConsumed - totalReturned).toBe(step.quantity);
        expect(applied.reduce((sum, row) => sum + ticks(row.remainingQuantity), 0)).toBe(step.quantity);
      }
    }), { numRuns: 150, seed: 11012026 });
  });
});
