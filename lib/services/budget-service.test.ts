import { describe, expect, it } from "vitest";
import { computeBudgetStatus, evaluateEmergencyCap } from "./budget-service";

describe("computeBudgetStatus", () => {
    it("disponible = presupuestado − comprometido con múltiples partidas", () => {
        const s = computeBudgetStatus(1000000, [300000, 200000, 150000]);
        expect(s).toEqual({ budgeted: 1000000, committed: 650000, available: 350000 });
    });

    it("sin presupuesto capturado → 0 disponible", () => {
        expect(computeBudgetStatus(null, [50000])).toEqual({
            budgeted: 0,
            committed: 50000,
            available: -50000,
        });
    });

    it("presupuesto cero es un valor legítimo, no ausencia", () => {
        expect(computeBudgetStatus(0, []).available).toBe(0);
    });

    it("compromisos negativos se ignoran (defensa)", () => {
        expect(computeBudgetStatus(1000, [-500, 300]).committed).toBe(300);
    });
});

describe("evaluateEmergencyCap", () => {
    it("cap null = sin tope, siempre permite", () => {
        const d = evaluateEmergencyCap(null, 99999999, 100);
        expect(d.allowed).toBe(true);
        expect(d.cap).toBeNull();
        expect(d.usedAfter).toBe(100000099);
    });

    it("cabe dentro del tope", () => {
        const d = evaluateEmergencyCap(1000000, 600000, 300000);
        expect(d).toMatchObject({ allowed: true, usedAfter: 900000, overBy: 0 });
    });

    it("excede el tope → bloqueado con monto excedido", () => {
        const d = evaluateEmergencyCap(1000000, 800000, 500000);
        expect(d.allowed).toBe(false);
        expect(d.overBy).toBe(300000);
    });

    it("caber exacto al tope está permitido (límite inclusivo)", () => {
        expect(evaluateEmergencyCap(1000000, 400000, 600000).allowed).toBe(true);
        expect(evaluateEmergencyCap(1000000, 400001, 600000).allowed).toBe(false);
    });

    it("primer gasto del mes con tope pequeño", () => {
        const d = evaluateEmergencyCap(500000, 0, 600000);
        expect(d.allowed).toBe(false);
        expect(d.overBy).toBe(100000);
    });
});
