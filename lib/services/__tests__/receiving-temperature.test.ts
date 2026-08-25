// lib/services/__tests__/receiving-temperature.test.ts
// Task 1 (plan loteprod-gaps): validación de temperatura en recepción por tipo
// de almacenamiento — manual loteprod.md §5.2.
//
// Contratos congelados aquí:
//   - Congelado: ≤ -18°C (frío extra OK, más templado que -18 rechaza)
//   - Refrigerado: 0–4°C AMBOS extremos inclusive
//   - Seco explícito: sin requisito (30°C pasa)
//   - Sin clasificar (null): regla legacy > 4°C (retrocompatibilidad con el
//     chequeo genérico previo — no debe desaparecer para datos sin clasificar)
//   - Temperatura no capturada: nunca cuarentena

import { describe, expect, it } from "vitest";
import {
    evaluateReceivingTemperature,
    expectedTemperatureRange,
} from "../receiving-temperature";

describe("expectedTemperatureRange", () => {
    it("congelado exige ≤ -18°C sin mínimo", () => {
        expect(expectedTemperatureRange("FROZEN")).toEqual({
            minC: null,
            maxC: -18,
            label: "≤ -18°C",
        });
    });

    it("refrigerado exige 0–4°C", () => {
        expect(expectedTemperatureRange("REFRIGERATED")).toEqual({
            minC: 0,
            maxC: 4,
            label: "0–4°C",
        });
    });

    it("seco y sin clasificar no tienen rango", () => {
        expect(expectedTemperatureRange("DRY")).toBeNull();
        expect(expectedTemperatureRange(null)).toBeNull();
        expect(expectedTemperatureRange(undefined)).toBeNull();
    });
});

describe("evaluateReceivingTemperature — refrigerado (0–4°C)", () => {
    it("2°C dentro de rango → disponible", () => {
        const e = evaluateReceivingTemperature(2, "REFRIGERATED");
        expect(e.quarantined).toBe(false);
        expect(e.violation).toBeUndefined();
    });

    it("0°C y 4°C exactos son inclusive → disponibles", () => {
        expect(evaluateReceivingTemperature(0, "REFRIGERATED").quarantined).toBe(false);
        expect(evaluateReceivingTemperature(4, "REFRIGERATED").quarantined).toBe(false);
    });

    it("7°C sobre el máximo → cuarentena con etiqueta de rango", () => {
        const e = evaluateReceivingTemperature(7, "REFRIGERATED");
        expect(e.quarantined).toBe(true);
        expect(e.violation).toContain("0–4°C");
    });

    it("-2°C bajo el mínimo → cuarentena (ambos extremos)", () => {
        const e = evaluateReceivingTemperature(-2, "REFRIGERATED");
        expect(e.quarantined).toBe(true);
        expect(e.violation).toContain("0–4°C");
    });
});

describe("evaluateReceivingTemperature — congelado (≤ -18°C)", () => {
    it("-20°C más frío que el límite → disponible", () => {
        const e = evaluateReceivingTemperature(-20, "FROZEN");
        expect(e.quarantined).toBe(false);
    });

    it("-18°C exacto es inclusive → disponible", () => {
        expect(evaluateReceivingTemperature(-18, "FROZEN").quarantined).toBe(false);
    });

    it("-10°C descongelándose → cuarentena + incidente", () => {
        const e = evaluateReceivingTemperature(-10, "FROZEN");
        expect(e.quarantined).toBe(true);
        expect(e.violation).toContain("-18°C");
    });
});

describe("evaluateReceivingTemperature — seco y sin clasificar", () => {
    it("seco explícito: cualquier temperatura pasa (30°C incluido)", () => {
        expect(evaluateReceivingTemperature(30, "DRY").quarantined).toBe(false);
    });

    it("sin clasificar conserva la regla legacy: 8°C → cuarentena", () => {
        const e = evaluateReceivingTemperature(8, null);
        expect(e.quarantined).toBe(true);
        expect(e.violation).toContain("4°C");
    });

    it("sin clasificar: 3°C → disponible", () => {
        expect(evaluateReceivingTemperature(3, null).quarantined).toBe(false);
    });
});

describe("evaluateReceivingTemperature — sin lectura", () => {
    it("undefined / null / NaN nunca cuarentenan (flujos legacy)", () => {
        for (const temp of [undefined, null, NaN]) {
            expect(evaluateReceivingTemperature(temp as number | undefined, "FROZEN").quarantined).toBe(false);
            expect(evaluateReceivingTemperature(temp as number | undefined, "REFRIGERATED").quarantined).toBe(false);
            expect(evaluateReceivingTemperature(temp as number | undefined, null).quarantined).toBe(false);
        }
    });
});
