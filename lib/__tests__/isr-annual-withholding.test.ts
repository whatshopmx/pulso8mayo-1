import { describe, expect, it } from "vitest";
import {
    calcularISRMensual96, calcularRetencionAguinaldoArt174, resolverTarifaParaAnio,
    TARIFA_ANUAL_2026, TARIFA_MENSUAL_2026,
} from "@/lib/services/isr-annual-withholding";
import { art174Fixtures, art174SubsidyFixtures, monthlyIsrFixtures, unsupportedTaxYears } from "@/tests/fixtures/fiscal-2026";

const input = {
    anioPago: 2026, mesPago: 12, aguinaldoBrutoCents: 900_000,
    aguinaldoGravadoCents: 548_070, salarioDiarioCents: 60_000,
};

describe("Art. 96 LISR — tarifa mensual 2026", () => {
    it("las tarifas tienen 11 tramos contiguos; la anual no implementa un ajuste anual", () => {
        for (const tarifa of [TARIFA_MENSUAL_2026, TARIFA_ANUAL_2026]) {
            expect(tarifa).toHaveLength(11);
            tarifa.slice(0, -1).forEach((tramo, i) => {
                expect(tramo.limiteSuperiorCents + 1).toBe(tarifa[i + 1].limiteInferiorCents);
            });
        }
    });
    it.each(monthlyIsrFixtures)("oráculo mensual base $baseCents / mes $month", (f) => {
        expect(calcularISRMensual96(f.baseCents, 2026, f.month)).toMatchObject({
            impuestoCents: f.taxCents, subsidioCents: f.subsidyCents, impuestoNetoCents: f.netCents,
        });
    });
    it("ubica los límites de cada tramo y sus vecinos sin huecos", () => {
        TARIFA_MENSUAL_2026.forEach((tramo, i) => {
            expect(calcularISRMensual96(tramo.limiteInferiorCents).renglon).toBe(i + 1);
            if (i > 0) expect(calcularISRMensual96(tramo.limiteInferiorCents - 1).renglon).toBe(i);
            if (Number.isFinite(tramo.limiteSuperiorCents)) {
                expect(calcularISRMensual96(tramo.limiteSuperiorCents).renglon).toBe(i + 1);
                expect(calcularISRMensual96(tramo.limiteSuperiorCents + 1).renglon).toBe(i + 2);
            }
        });
    });
    it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rechaza base inválida %s", (base) => {
        expect(() => calcularISRMensual96(base)).toThrow(RangeError);
    });
});

describe("AGU-02 — Art. 174 sobre remuneración gravada", () => {
    it.each(art174Fixtures)("bruto $grossCents, gravado $taxableCents, mes $month", (f) => {
        expect(calcularRetencionAguinaldoArt174({
            anioPago: 2026, mesPago: f.month, aguinaldoBrutoCents: f.grossCents,
            aguinaldoGravadoCents: f.taxableCents, salarioOrdinarioMensualCents: f.monthlyCents,
        })).toMatchObject({
            metodo: "ART174_RLISR", anioFuente: 2026, ingresoHipoteticoCents: f.hypotheticalCents,
            impuestoOrdinarioCents: f.ordinaryTaxCents, impuestoConRemuneracionCents: f.combinedTaxCents,
            retencionCents: f.withholdingCents,
        });
    });
    it("SD 600 y mensual explícito 18240 coinciden; no redondea la tasa antes de retener", () => {
        const diario = calcularRetencionAguinaldoArt174(input);
        expect(diario).toEqual(calcularRetencionAguinaldoArt174({ ...input, salarioOrdinarioMensualCents: 1_824_000 }));
        expect(diario.tasaEfectivaPct).toBe(21.3596);
        expect(diario.retencionCents).toBe(117_065);
    });
    it("mensual explícito cero prevalece sobre el salario diario", () => {
        expect(calcularRetencionAguinaldoArt174({ ...input, salarioOrdinarioMensualCents: 0 }))
            .toMatchObject({ ingresoOrdinarioMensualCents: 0, retencionCents: 0 });
    });
    it("sin gravado explícito no infiere que todo el bruto sea gravado", () => {
        expect(() => calcularRetencionAguinaldoArt174({ ...input, aguinaldoGravadoCents: undefined! })).toThrow(RangeError);
    });
    it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])("rechaza importes inválidos %s", (value) => {
        expect(() => calcularRetencionAguinaldoArt174({ ...input, aguinaldoBrutoCents: value })).toThrow(RangeError);
        expect(() => calcularRetencionAguinaldoArt174({ ...input, aguinaldoGravadoCents: value })).toThrow(RangeError);
        expect(() => calcularRetencionAguinaldoArt174({ ...input, salarioDiarioCents: value })).toThrow(RangeError);
        expect(() => calcularRetencionAguinaldoArt174({ ...input, salarioOrdinarioMensualCents: value })).toThrow(RangeError);
    });
    it("rechaza gravado superior al bruto e ingreso ordinario ausente", () => {
        expect(() => calcularRetencionAguinaldoArt174({ ...input, aguinaldoGravadoCents: 900_001 })).toThrow(RangeError);
        expect(() => calcularRetencionAguinaldoArt174({ ...input, salarioDiarioCents: undefined })).toThrow(RangeError);
    });
    it.each([0, 13, 1.5, NaN])("rechaza mes inválido %s", (mes) => {
        expect(() => calcularRetencionAguinaldoArt174({ ...input, mesPago: mes })).toThrow(RangeError);
        expect(() => calcularISRMensual96(100, 2026, mes)).toThrow(RangeError);
    });
    it.each([...unsupportedTaxYears, 2026.5, NaN])("bloquea año sin tarifa exacta: %s aun con gravado cero", (anio) => {
        expect(() => resolverTarifaParaAnio(anio)).toThrow(RangeError);
        expect(() => calcularISRMensual96(100, anio)).toThrow(RangeError);
        expect(() => calcularRetencionAguinaldoArt174({ ...input, anioPago: anio, aguinaldoGravadoCents: 0 })).toThrow(RangeError);
    });
    it("un centavo gravado no divide entre cero si el hipotético redondea a cero", () => {
        expect(calcularRetencionAguinaldoArt174({ ...input, aguinaldoGravadoCents: 1 }))
            .toMatchObject({ ingresoHipoteticoCents: 0, tasaEfectivaPct: 0, retencionCents: 0 });
    });
});

describe("AGU-02C — tasa Art. 174 y subsidio del mes real separados", () => {
    it.each(art174SubsidyFixtures)("$case", (f) => {
        const resultado = calcularRetencionAguinaldoArt174({
            anioPago: 2026, mesPago: f.month,
            // La exención ya está resuelta: este calculador no debe resolver UMA.
            aguinaldoBrutoCents: f.taxableCents + (f.month === 1 ? 339_420 : 351_930),
            aguinaldoGravadoCents: f.taxableCents,
            salarioOrdinarioMensualCents: f.monthlyCents,
        });
        expect(resultado).toMatchObject({
            ingresoHipoteticoCents: f.hypotheticalCents,
            impuestoOrdinarioCents: f.ordinaryTaxCents,
            impuestoConRemuneracionCents: f.combinedTaxCents,
            retencionArt174Cents: f.nominalCents,
            ingresoGravadoMesCents: f.monthlyCents + f.taxableCents,
            subsidioCausadoMesCents: f.monthlySubsidyCents,
            subsidioAplicadoCents: f.bonusCreditCents,
            ajusteSubsidioCausadoCents: f.causedAdjustmentCents,
            ajusteIsrOrdinarioCents: f.ordinaryAdjustmentCents,
            retencionCents: f.withholdingCents,
            totalRetencionAdicionalCents: f.additionalCents,
        });
        // Conservación del crédito y del cargo adicional; no se entrega efectivo.
        const creditoOrdinarioDelMes = Math.min(f.ordinaryTaxCents, f.monthlySubsidyCents);
        expect(creditoOrdinarioDelMes + resultado.subsidioAplicadoCents).toBeLessThanOrEqual(f.monthlySubsidyCents);
        expect(resultado.retencionCents).toBeGreaterThanOrEqual(0);
        expect(resultado.retencionCents).toBeLessThanOrEqual(resultado.retencionArt174Cents);
        expect(resultado.totalRetencionAdicionalCents).toBe(resultado.retencionCents + resultado.ajusteIsrOrdinarioCents);
    });

    it("el salto de un centavo del mes real retira 535.65 una vez y conserva la tasa Art. 174", () => {
        const calcular = (gravado: number) => calcularRetencionAguinaldoArt174({
            ...input, aguinaldoBrutoCents: gravado + 351_930,
            aguinaldoGravadoCents: gravado, salarioOrdinarioMensualCents: 1_000_000,
        });
        const limite = calcular(149_266);
        const vecino = calcular(149_267);
        expect(vecino.tasaEfectivaPct).toBe(limite.tasaEfectivaPct);
        expect(vecino.retencionArt174Cents).toBe(limite.retencionArt174Cents);
        expect(vecino.totalRetencionAdicionalCents - limite.totalRetencionAdicionalCents).toBe(53_565);
    });
});
