import { describe, expect, it } from "vitest";
import {
    calcularISRMensual96,
    calcularRetencionAguinaldoArt174,
    resolverTarifaParaAnio,
    SUBSIDIO_EMPLEO_2026,
    TARIFA_ANUAL_2026,
    TARIFA_MENSUAL_2026,
} from "@/lib/services/isr-annual-withholding";

/**
 * Task 13 plan-aguinaldo — retención de ISR del aguinaldo, Art. 174 RLISR.
 *
 * Casos de estudio con fuentes: los números provienen del Anexo 8 de la RMF
 * 2026 (DOF 28-dic-2025), el ejemplo resuelto del SAT-servicio ($15,000 →
 * $1,402.82) y la mecánica textual del Art. 174 RLISR (fr. I–V).
 */
describe("Art. 96 LISR — tarifa mensual 2026 (Anexo 8 RMF 2026)", () => {
    it("los 11 renglones son contiguos (verificación aritmética de la tabla fuente)", () => {
        expect(TARIFA_MENSUAL_2026).toHaveLength(11);
        expect(TARIFA_ANUAL_2026).toHaveLength(11);
        for (const [i, t] of TARIFA_MENSUAL_2026.slice(0, -1).entries()) {
            expect(t.limiteSuperiorCents + 1).toBe(TARIFA_MENSUAL_2026[i + 1].limiteInferiorCents);
        }
        for (const [i, t] of TARIFA_ANUAL_2026.slice(0, -1).entries()) {
            expect(t.limiteSuperiorCents + 1).toBe(TARIFA_ANUAL_2026[i + 1].limiteInferiorCents);
        }
    });

    it("caso de estudio documentado: base \$15,000/mes → \$1,402.82 (renglón 5, sin subsidio)", () => {
        // Ejemplo resuelto SAT: 1,339.14 + (15,000 − 14,644.65) × 17.92% = 1,402.82.
        const r = calcularISRMensual96(1_500_000, 2026, 12);
        expect(r.renglon).toBe(5);
        expect(r.impuestoNetoCents).toBe(140_282);
        expect(r.subsidioCents).toBe(0);
    });

    it("salario bajo (\$3,000): el subsidio deja ISR neto en 0 (el excedente del subsidio no se entrega en efectivo)", () => {
        const r = calcularISRMensual96(300_000, 2026, 12);
        expect(r.impuestoCents).toBe(15_417);
        expect(r.subsidioCents).toBe(SUBSIDIO_EMPLEO_2026.subsidioMensualCents);
        expect(r.impuestoNetoCents).toBe(0);
    });

    it("subsidio: enero con el porcentaje especial (15.59%), febrero–diciembre con 15.02%", () => {
        const enero = calcularISRMensual96(500_000, 2026, 1);
        const febrero = calcularISRMensual96(500_000, 2026, 2);
        expect(enero.subsidioCents).toBe(SUBSIDIO_EMPLEO_2026.subsidioEneroCents);
        expect(febrero.subsidioCents).toBe(SUBSIDIO_EMPLEO_2026.subsidioMensualCents);
    });

    it("mes inválido o base negativa → RangeError", () => {
        expect(() => calcularISRMensual96(-1, 2026, 12)).toThrow(RangeError);
        expect(() => calcularISRMensual96(100, 2026, 0)).toThrow(RangeError);
        expect(() => calcularISRMensual96(100, 2026, 13)).toThrow(RangeError);
    });
});

describe("Art. 174 RLISR — retención del aguinaldo", () => {
    it(
        "CASO DE ESTUDIO documentado: SD \$600 (mensual \$18,240), aguinaldo \$9,000, pago en dic-2026 → retención \$1,922.37",
        () => {
            // fr. I: 9,000 / 365 × 30.4 = 749.59
            // fr. II: Art. 96(749.59 + 18,240) = 2,167.83 (base en renglón 6)
            // fr. III: Art. 96(18,240) = 2,007.72
            // atribuible = 160.11 → fr. V tasa = 160.11 / 749.59 = 21.3597%
            // fr. IV: retención = 21.3597% × 9,000 ÍNTEGRO = 1,922.37
            const r = calcularRetencionAguinaldoArt174({
                anioPago: 2026,
                mesPago: 12,
                aguinaldoBrutoCents: 900_000,
                salarioDiarioCents: 60_000,
            });
            expect(r.metodo).toBe("ART174_RLISR");
            expect(r.ingresoHipoteticoCents).toBe(74_959);
            expect(r.ingresoOrdinarioMensualCents).toBe(1_824_000);
            expect(r.impuestoConRemuneracionCents).toBe(216_783);
            expect(r.impuestoOrdinarioCents).toBe(200_772);
            expect(r.tasaEfectivaPct).toBeCloseTo(21.3597, 4);
            expect(r.retencionCents).toBe(192_237); // $1,922.37 — va sobre el aguinaldo ÍNTEGRO
            expect(r.fuente).toContain("Art. 174 RLISR");
        }
    );

    it("la retención aplica SIN deducción alguna: también sobre la parte exenta de 30 UMA (fr. IV)", () => {
        // $600/365×30.4 → un aguinaldo de $9,000 retiene por el total, no por el gravado.
        const r = calcularRetencionAguinaldoArt174({
            anioPago: 2026,
            mesPago: 12,
            aguinaldoBrutoCents: 900_000,
            salarioDiarioCents: 60_000,
        });
        expect(r.retencionCents).toBeGreaterThan(0);
    });

    it("empleados con salario bajo: subsidio al empleo hace la retención 0 (favorable al trabajador)", () => {
        // SD \$150 → mensual \$4,560. Aguinaldo \$2,250.
        const r = calcularRetencionAguinaldoArt174({
            anioPago: 2026,
            mesPago: 12,
            aguinaldoBrutoCents: 225_000,
            salarioDiarioCents: 15_000,
        });
        expect(r.impuestoConRemuneracionCents).toBe(0);
        expect(r.retencionCents).toBe(0);
    });

    it("aguinaldo en 0 → retención 0, sin romper (re-run idempotente)", () => {
        const r = calcularRetencionAguinaldoArt174({
            anioPago: 2026,
            mesPago: 12,
            aguinaldoBrutoCents: 0,
            salarioDiarioCents: 60_000,
        });
        expect(r.ingresoHipoteticoCents).toBe(0);
        expect(r.retencionCents).toBe(0);
    });

    it("mensual ordinario explícito prevalece sobre el fallback del salario diario", () => {
        const explicito = calcularRetencionAguinaldoArt174({
            anioPago: 2026,
            mesPago: 12,
            aguinaldoBrutoCents: 900_000,
            salarioDiarioCents: 60_000,
            salarioOrdinarioMensualCents: 2_000_000, // \$20,000
        });
        expect(explicito.ingresoOrdinarioMensualCents).toBe(2_000_000);
    });

    it("inputs imposibles → RangeError; año sin tarifa publicada usa la última con anioFuente declarado", () => {
        expect(() =>
            calcularRetencionAguinaldoArt174({ anioPago: 2026, mesPago: 1, aguinaldoBrutoCents: -1 })
        ).toThrow(RangeError);
        expect(() =>
            calcularRetencionAguinaldoArt174({ anioPago: 2026, mesPago: 13, aguinaldoBrutoCents: 100 })
        ).toThrow(RangeError);

        const futuro = calcularRetencionAguinaldoArt174({
            anioPago: 2027,
            mesPago: 1,
            aguinaldoBrutoCents: 900_000,
            salarioDiarioCents: 60_000,
        });
        expect(resolverTarifaParaAnio(2027).anio).toBe(2026);
        expect(futuro.anioFuente).toBe(2026);
        expect(futuro.fuente).toContain("RMF 2026");
    });
});
