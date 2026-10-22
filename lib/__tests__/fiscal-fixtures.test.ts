import { describe, expect, it } from "vitest";
import { calcularISRMensual96 } from "@/lib/services/isr-annual-withholding";
import { calcularAguinaldoAnual } from "@/lib/services/aguinaldo-service";
import { pickLawRuleForDate } from "@/lib/services/labor-rules-resolver";
import { aguinaldoTaxableFixtures, minimumWageFixtures, monthlyIsrFixtures, umaFixtures } from "@/tests/fixtures/fiscal-2026";

describe("FIS-01 — oráculos oficiales independientes", () => {
    it.each(monthlyIsrFixtures)("Art. 96: $baseCents centavos, mes $month", (f) => {
        expect(calcularISRMensual96(f.baseCents, 2026, f.month)).toMatchObject({
            impuestoCents: f.taxCents,
            subsidioCents: f.subsidyCents,
            impuestoNetoCents: f.netCents,
        });
    });

    it.each(aguinaldoTaxableFixtures)("exención diciembre 2026: bruto $grossCents", (f) => {
        // SD=bruto/15 y año completo: los importes esperados están fijados en el oráculo.
        expect(calcularAguinaldoAnual({
            anioFiscal: 2026, salarioDiarioCents: f.grossCents / 15,
            diasLaborados: 365, umaDailyCents: f.umaDailyCents,
        })).toMatchObject({ brutoCents: f.grossCents, exentoCents: f.exemptCents, gravadoCents: f.taxableCents });
    });

    it.each([
        ["2025-12-31", "GENERAL", 27_880], ["2026-01-01", "GENERAL", 31_504],
        ["2025-12-31", "ZLFN", 41_988], ["2026-01-01", "ZLFN", 44_087],
        ["2027-01-01", "GENERAL", null], ["2026-01-01", "DESCONOCIDA", null],
    ] as const)("mínimo: %s / %s → %s", (date, zone, expected) => {
        const matches = minimumWageFixtures.filter((f) => f.zone === zone && f.from <= date && date <= f.to);
        expect(matches.length).toBe(expected === null ? 0 : 1);
        expect(matches[0]?.dailyCents ?? null).toBe(expected);
    });

    it.each([
        ["2026-01-31", 11_314], ["2026-02-01", 11_731], ["2027-02-01", null],
    ] as const)("selector con vigencias de UMA: %s → %s", (date, expected) => {
        const rows = umaFixtures.map((f) => ({
            effectiveFrom: f.from, effectiveTo: f.to, aguinaldoDaysMxn: 15,
        }));
        const picked = pickLawRuleForDate(rows, new Date(`${date}T12:00:00Z`));
        const fixture = umaFixtures.find((f) => f.from === picked?.effectiveFrom);
        expect(fixture?.dailyCents ?? null).toBe(expected);
    });
});
