import { describe, it, expect } from "vitest";
import {
    pickLawRuleForDate,
    staticFallbackRule,
    mergeCompanyLaborOverride,
    type ResolvedLaborRule,
} from "../services/labor-rules-resolver";
import { LABOR_REFORM_STATUS_CATALOG, getReformStatus, isReformEnforceable } from "../company/labor-reform-status-catalog";

// Rows del formato de la tabla (solo los campos que el selector lee).
const seedRows = [
    { effectiveFrom: "2020-01-01", effectiveTo: "2026-04-30" },
    { effectiveFrom: "2026-05-01", effectiveTo: "2026-12-31" },
    { effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31" },
    { effectiveFrom: "2028-01-01", effectiveTo: "2028-12-31" },
    { effectiveFrom: "2029-01-01", effectiveTo: "2029-12-31" },
    { effectiveFrom: "2030-01-01", effectiveTo: null },
];

function fakeResolved(overrides: Partial<ResolvedLaborRule> = {}): ResolvedLaborRule {
    return {
        source: "law-table",
        effectiveFrom: new Date("2026-05-01T00:00:00Z"),
        effectiveTo: new Date("2026-12-31T00:00:00Z"),
        maxWeeklyHours: 48,
        maxDoubleOvertimeHours: 9,
        maxTripleOvertimeHours: 4,
        maxDailySumHours: 12,
        maxExtraHoursPerDay: 4,
        maxExtraDaysPerWeek: 4,
        minRestBetweenShiftsHours: 12,
        minimumWageMxn: 278.8,
        sourceDofUrl: "dof://test",
        sourcePublishedOn: new Date("2026-05-01T00:00:00Z"),
        legalNote: null,
        ...overrides,
    };
}

describe("pickLawRuleForDate (capa 1, selector puro)", () => {
    it("2026-04-30 → régimen anterior (48h, triple 3 del Art. 66 original)", () => {
        const picked = pickLawRuleForDate(seedRows, new Date("2026-04-30T12:00:00Z"));
        expect(picked?.effectiveFrom).toBe("2020-01-01");
    });

    it("1-may-2026 → tramo del decreto en vigor", () => {
        expect(pickLawRuleForDate(seedRows, new Date("2026-05-01T12:00:00Z"))?.effectiveFrom).toBe("2026-05-01");
    });

    it("1-jul-2026 → sigue en el tramo 48h del decreto", () => {
        expect(pickLawRuleForDate(seedRows, new Date("2026-07-01T12:00:00Z"))?.effectiveFrom).toBe("2026-05-01");
    });

    it("1-ene-2027 → escalón 46h", () => {
        expect(pickLawRuleForDate(seedRows, new Date("2027-01-01T12:00:00Z"))?.effectiveFrom).toBe("2027-01-01");
    });

    it("2031 (y cualquier fecha posterior) → clampa a la fila 40h abierta", () => {
        expect(pickLawRuleForDate(seedRows, new Date("2031-06-15T12:00:00Z"))?.effectiveFrom).toBe("2030-01-01");
    });

    it("fecha anterior al historial → null (el consumidor decide el fallback)", () => {
        expect(pickLawRuleForDate(seedRows, new Date("2019-12-31T12:00:00Z"))).toBeNull();
    });
});

describe("staticFallbackRule (capa 1b)", () => {
    it("marca source: static-fallback y cita el DOF de la reforma de jornada", () => {
        const fallback = staticFallbackRule(new Date("2026-07-01"));
        expect(fallback.source).toBe("static-fallback");
        expect(fallback.maxWeeklyHours).toBe(48);
        expect(fallback.maxTripleOvertimeHours).toBe(4);
        expect(fallback.sourceDofUrl).toContain("dof.gob.mx");
    });
});

describe("mergeCompanyLaborOverride (capa 2)", () => {
    it("override más restrictivo se aplica (contrato colectivo puede endurecer)", () => {
        const law = fakeResolved();
        const merged = mergeCompanyLaborOverride(law, {
            maxWeeklyHours: 44,
            maxTripleOvertimeHours: 0,
        });
        expect(merged.rule.maxWeeklyHours).toBe(44);
        expect(merged.rule.maxTripleOvertimeHours).toBe(0);
        expect(merged.rejectedOverrideFields).toEqual([]);
    });

    it("override más laxo que la ley se RECHAZA campo por campo (norma de orden público)", () => {
        const law = fakeResolved({ maxWeeklyHours: 48, maxExtraDaysPerWeek: 4 });
        const merged = mergeCompanyLaborOverride(law, {
            maxWeeklyHours: 55, // up: rechazado
            maxExtraDaysPerWeek: 6, // up: rechazado
            maxTripleOvertimeHours: 2, // down: aplica
        });
        expect(merged.rule.maxWeeklyHours).toBe(48);
        expect(merged.rule.maxExtraDaysPerWeek).toBe(4);
        expect(merged.rule.maxTripleOvertimeHours).toBe(2);
        expect(merged.rejectedOverrideFields.sort()).toEqual(["maxExtraDaysPerWeek", "maxWeeklyHours"]);
    });

    it("sin override → ley intacta", () => {
        const law = fakeResolved();
        expect(mergeCompanyLaborOverride(law).rejectedOverrideFields).toEqual([]);
        expect(mergeCompanyLaborOverride(law).rule).toEqual(law);
    });
});

describe("labor-reform-status-catalog (capa 3)", () => {
    it("toda la ley ya vigente es ejecutable hoy", () => {
        for (const key of ["JORNADA_40H_TRANSICION", "LEY_SILLA", "BRECHA_SALARIAL_TABULADORES"]) {
            const entry = getReformStatus(key);
            expect(entry?.status).toBe("LAW");
            expect(isReformEnforceable(entry!)).toBe(true);
        }
    });

    it("reformas pendientes NO se pueden alegar como ley", () => {
        for (const key of ["DESCONEXION_DIGITAL", "LICENCIAS_SALUD_MENTAL", "LICENCIAS_DUELO_PATERNIDAD", "PRIMA_SUSTITUCION_IA", "ACTIVIDADES_FUERA_DE_JORNADA_50"]) {
            const entry = getReformStatus(key);
            expect(entry).toBeDefined();
            expect(isReformEnforceable(entry!)).toBe(false);
        }
    });

    it("registro electrónico: ley vigente con lineamientos pendientes (vigor 1-ene-2027)", () => {
        expect(getReformStatus("REGISTRO_ELECTRONICO_JORNADA")?.status).toBe("LAW_PENDING_SECONDARY");
    });

    it("anti-buró: aprobado en Senado, pendientes Diputados (no alegable aún)", () => {
        expect(getReformStatus("ANTI_BURO_LABORAL")?.status).toBe("PENDING_LAW_APPROVAL");
    });

    it("cada entrada declara los servicios que la implementan (contrato [H04])", () => {
        for (const entry of LABOR_REFORM_STATUS_CATALOG) {
            expect(entry.serviceFiles.length).toBeGreaterThan(0);
            expect(entry.effectNote.length).toBeGreaterThan(10);
        }
    });
});
