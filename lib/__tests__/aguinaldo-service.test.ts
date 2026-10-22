import { describe, it, expect } from "vitest";
import {
    calcularAguinaldoAnual,
    diasCalendarioAguinaldo,
    resolverEstatusLegal,
    EXENCION_UMAS,
    DIAS_PRORRATEO,
} from "../services/aguinaldo-service";
import { getReformStatus, AGUINALDO_DAYS_VIGENTE } from "../company/labor-reform-status-catalog";

/**
 * Casos de la investigación 2026-10-20 (tasks/plan-aguinaldo.md Task 2).
 * UMA 2026: $113.14 diaria → cap exención = 30 × 113.14 = $3,394.20.
 * Montos en centavos ($600 diario = 60_000 cents).
 */
const UMA_2026_CENTS = 11314; // $113.14
const CAP_EXENCION_2026 = EXENCION_UMAS * UMA_2026_CENTS; // 339_420 cents = $3,394.20

describe("calcularAguinaldoAnual — reglas del Art. 87 LFT", () => {
    it("año completo: $600 diario × 15 días = $9,000 bruto", () => {
        const r = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            diasLaborados: 365,
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(r.diasAguinaldo).toBeCloseTo(15, 9);
        expect(r.brutoCents).toBe(900_000);
        expect(r.aguinaldoDaysMxn).toBe(15);
    });

    it("proporcional 200 días: 15/365 × 200 = 8.219178… días", () => {
        const r = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            diasLaborados: 200,
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(r.diasAguinaldo).toBeCloseTo(8.219178082191781, 9);
        expect(r.brutoCents).toBe(Math.round((15 / 365) * 200 * 60_000));
        expect(r.fuenteDias).toBe("MANUAL");
    });

    it("exención: bruto > cap → exento = 30 UMA ($3,394.20), gravado = resto (cap NO se prorratea)", () => {
        const r = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            diasLaborados: 365,
            umaDailyCents: UMA_2026_CENTS,
        });
        // bruto $9,000 > cap $3,394.20
        expect(r.exencionCapCents).toBe(CAP_EXENCION_2026);
        expect(r.exentoCents).toBe(339_420);
        expect(r.gravadoCents).toBe(900_000 - 339_420);
        expect(r.exentoCents + r.gravadoCents).toBe(r.brutoCents);
    });

    it("salario bajo: bruto < cap → 100% exento, gravado $0", () => {
        const r = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 10_000, // $100 diario
            diasLaborados: 365,
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(r.brutoCents).toBe(150_000); // $1,500 < $3,394.20
        expect(r.exentoCents).toBe(150_000);
        expect(r.gravadoCents).toBe(0);
    });

    it("trabajador <1 año (alta 1-jul-2026): 184 días calendario de fallback", () => {
        expect(diasCalendarioAguinaldo(2026, "2026-07-01")).toBe(184);
        const r = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            seniorityDate: "2026-07-01",
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(r.diasCalendario).toBe(184);
        expect(r.diasLaborados).toBe(184);
        expect(r.fuenteDias).toBe("CALENDARIO");
        expect(r.brutoCents).toBe(Math.round((15 / 365) * 184 * 60_000));
    });

    it("faltas sin goce descontadas: override manual < calendario", () => {
        const r = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            diasLaborados: 353, // calendario − 12 faltas
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(r.diasLaborados).toBe(353);
        expect(r.fuenteDias).toBe("MANUAL");
        expect(r.brutoCents).toBe(Math.round((15 / 365) * 353 * 60_000));
    });

    it("alta durante el año + faltas: días intermedios con derechos protegidos ya aplicados por el admin", () => {
        const calendario = diasCalendarioAguinaldo(2026, "2026-03-16"); // 291 días (16-mar a 31-dic)
        expect(calendario).toBe(291);
        // PROFEDET: vacaciones/festivos/maternidad SÍ cuentan → admin resta solo lo sin goce.
        const r = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            diasLaborados: calendario - 10,
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(r.diasLaborados).toBe(281);
    });
});

describe("reglas documentadas (decisión Q4: comisionistas)", () => {
    it("propinas (CFDI 038) NO son salario: el servicio solo recibe el salario ordinario del contrato", () => {
        // Documentación de contrato: la propina jamás pasa por aquí — la
        // clave 038 es un pago que da la empresa a cuenta de la propina,
        // NO salario (no genera aguinaldo, prima vacacional ni finiquito).
        // El único insumo monetario es salarioDiarioCents (cesión de
        // comisiones debe vivir en baseSalary/effectiveSalary del contrato).
        const conPropinasHipoteticasMismoSalario = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            diasLaborados: 365,
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(conPropinasHipoteticasMismoSalario.brutoCents).toBe(900_000);
        // Si las propinas entraran (incidencia de diseño prohibida), el bruto
        // sería mayor — el test fija que no: solo salario ordinario × días.
    });
});

describe("estatus legal [H04]", () => {
    it("15 días → LEY_VIGENTE, citando el Art. 87", () => {
        const r = calcularAguinaldoAnual({ anioFiscal: 2026, salarioDiarioCents: 60_000 });
        expect(r.estatusLegal.fuente).toBe("LEY_VIGENTE");
        expect(r.estatusLegal.basis).toMatch(/Art\. 87/);
        expect(r.estatusLegal.diasLegalesVigente).toBe(AGUINALDO_DAYS_VIGENTE);
    });

    it("30 días (config explícita) → PROYECCION con el estatus del catálogo, nunca alegable como ley", () => {
        expect(getReformStatus("AGUINALDO_30_DIAS")?.status).toBe("PENDING_INITIATIVE");
        const r = resolverEstatusLegal(30);
        expect(r.fuente).toBe("PROYECCION");
        expect(r.diasLegalesVigente).toBe(15);
        const calculo = calcularAguinaldoAnual({
            anioFiscal: 2026,
            salarioDiarioCents: 60_000,
            diasLaborados: 365,
            aguinaldoDaysMxn: 30, // config explícita para proyecciones
            umaDailyCents: UMA_2026_CENTS,
        });
        expect(calculo.estatusLegal.fuente).toBe("PROYECCION");
    });
});

describe("guardas de entrada", () => {
    it("sin UMA resuelta → NO aplica exención (todo gravado), exencionCap = null", () => {
        const r = calcularAguinaldoAnual({ anioFiscal: 2026, salarioDiarioCents: 60_000, diasLaborados: 365 });
        expect(r.exencionCapCents).toBeNull();
        expect(r.exentoCents).toBe(0);
        expect(r.gravadoCents).toBe(r.brutoCents);
    });

    it("anioFiscal fuera de rango o días fuera de [0, 366] → RangeError", () => {
        expect(() => calcularAguinaldoAnual({ anioFiscal: 2026.5, salarioDiarioCents: 1 })).toThrow(RangeError);
        expect(() => calcularAguinaldoAnual({ anioFiscal: 2026, salarioDiarioCents: -1 })).toThrow(RangeError);
        expect(() => calcularAguinaldoAnual({ anioFiscal: 2026, salarioDiarioCents: 1, diasLaborados: 500 })).toThrow(RangeError);
        expect(() => calcularAguinaldoAnual({ anioFiscal: 2026, salarioDiarioCents: 1, diasLaborados: -2 })).toThrow(RangeError);
    });

    it("denominador del prorrateo fijo en 365 (años bisiestos no cambian la fórmula legal)", () => {
        expect(DIAS_PRORRATEO).toBe(365);
        const r = calcularAguinaldoAnual({ anioFiscal: 2028, salarioDiarioCents: 60_000, diasLaborados: 365 });
        expect(r.diasAguinaldo).toBeCloseTo(15, 9); // sigue 15 días sobre 365
    });
});

describe("Task 11 — base REGISTERED vs EFFECTIVE (sub-registro)", () => {
    /** Empleado mixto: registrado $300, real $500 (parte en efectivo $200). */
    const REG = 30_000;
    const EFF = 50_000;

    it("la misma fórmula aplica sobre la base elegida; el gap del aguinaldo es lineal en el salario", () => {
        const reg = calcularAguinaldoAnual({
            anioFiscal: 2026, salarioDiarioCents: REG, diasLaborados: 365,
            umaDailyCents: UMA_2026_CENTS, base: "REGISTERED",
        });
        const eff = calcularAguinaldoAnual({
            anioFiscal: 2026, salarioDiarioCents: EFF, diasLaborados: 365,
            umaDailyCents: UMA_2026_CENTS, base: "EFFECTIVE",
        });
        expect(reg.brutoCents).toBe(450_000); // $300 × 15
        expect(eff.brutoCents).toBe(750_000); // $500 × 15
        // Diferencia = liabilidad contingente (base REGISTERED) o excedente a
        // dispersar (base EFFECTIVE) — misma cifra, distinta postura.
        expect(eff.brutoCents - reg.brutoCents).toBe(300_000); // $3,000
    });

    it("el excedente siempre se determina contra lo timbrable: el CFDI cubre sólo la parte registrada", () => {
        const reg = calcularAguinaldoAnual({
            anioFiscal: 2026, salarioDiarioCents: REG, diasLaborados: 365,
            umaDailyCents: UMA_2026_CENTS, base: "REGISTERED",
        });
        // bruto registrado $4,500 < cap $3,394.20? NO: $4,500 > cap → exento parcial.
        expect(reg.exentoCents).toBe(CAP_EXENCION_2026);
        expect(reg.exentoCents + reg.gravadoCents).toBe(reg.brutoCents);
    });

    it("la exención de 30 UMA se aplica sobre el bruto de cada base, no se comparte", () => {
        const salaris = [REG, EFF];
        for (const s of salaris) {
            const r = calcularAguinaldoAnual({
                anioFiscal: 2026, salarioDiarioCents: s, diasLaborados: 365,
                umaDailyCents: UMA_2026_CENTS,
            });
            expect(r.exentoCents).toBe(Math.min(r.brutoCents, CAP_EXENCION_2026));
        }
    });
});
