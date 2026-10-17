// lib/services/__tests__/receiving-cost.test.ts
// H07 (reporte de cumplimiento 2026-10-17): la conversión de unidades en
// recepción debe conservar el valor total recibido.
//
// Bug corregido: receiving-service multiplicaba el costo por `quantity / convertedQty`
// —un factor que ya es 1 después de convertir— dejando el costo por unidad base
// sin corregir (2 cajas @ $1,000 con factor 10 quedaban 20 kg @ $1,000/kg).

import { describe, expect, it } from "vitest";
import { convertReceivedAmount } from "../receiving-cost";

describe("convertReceivedAmount", () => {
    it("convierte cantidad y corrige el costo inversamente (caja → kg)", () => {
        const r = convertReceivedAmount({
            quantity: 2,
            unitCostCents: 100_000, // $1,000 por caja
            factor: 10, // 1 caja = 10 kg
        });
        expect(r.quantity).toBe(20);
        expect(r.unitCostCents).toBe(10_000); // $100/kg
    });

    it("conserva el valor total en ambos sentidos de conversión", () => {
        const r = convertReceivedAmount({
            quantity: 2,
            unitCostCents: 100_000,
            factor: 10,
        });
        expect(r.totalCents).toBe(200_000);
        expect(r.quantity * (r.unitCostCents ?? 0)).toBe(r.totalCents);
    });

    it("factor < 1 (kg → g) también conserva el total", () => {
        const r = convertReceivedAmount({
            quantity: 1.5,
            unitCostCents: 12_000, // $120/kg
            factor: 1_000, // 1 kg = 1000 g
        });
        expect(r.quantity).toBe(1_500);
        expect(r.unitCostCents).toBe(12); // $0.12/g
        expect(r.totalCents).toBe(18_000);
    });

    it("sin costo unitario devuelve null de costo y conserva la cantidad", () => {
        const r = convertReceivedAmount({
            quantity: 3,
            unitCostCents: null,
            factor: 10,
        });
        expect(r.quantity).toBe(30);
        expect(r.unitCostCents).toBeNull();
        expect(r.totalCents).toBe(0);
    });

    it("factor 1 (misma unidad) no altera nada", () => {
        const r = convertReceivedAmount({
            quantity: 4,
            unitCostCents: 2_500,
            factor: 1,
        });
        expect(r).toEqual({
            quantity: 4,
            unitCostCents: 2_500,
            totalCents: 10_000,
        });
    });

    it("factor inválido no convierte ni corrompe el total", () => {
        for (const factor of [0, NaN, Infinity]) {
            const r = convertReceivedAmount({
                quantity: 5,
                unitCostCents: 1_000,
                factor,
            });
            expect(r.quantity).toBe(5);
            expect(r.unitCostCents).toBe(1_000);
            expect(r.totalCents).toBe(5_000);
        }
    });

    it("redondea a centavos enteros", () => {
        const r = convertReceivedAmount({
            quantity: 3,
            unitCostCents: 3_333,
            factor: 2,
        });
        expect(Number.isInteger(r.unitCostCents)).toBe(true);
        expect(r.unitCostCents).toBe(1_667); // 1666.5 → 1667
    });
});