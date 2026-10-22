import { describe, expect, it } from "vitest";
import {
    resolveAguinaldoBase,
    resolveEffectiveSalary,
    resolvePayrollPracticeMode,
} from "@/lib/services/employee-service";

/**
 * Task 10 plan-aguinaldo: la estructura de compensación configurable no puede
 * cambiar el comportamiento de los empleados sin `effectiveSalaryCents`
 * (regresión cero) ni convertir la parte en efectivo en un campo capturado por
 * separado (es derivada: efectivo − base).
 */
describe("salario efectivo y práctica de nómina (Task 10)", () => {
    describe("resolvePayrollPracticeMode", () => {
        it("NULL/undefined = FORMAL (inquilino sin configurar)", () => {
            expect(resolvePayrollPracticeMode(null)).toBe("FORMAL");
            expect(resolvePayrollPracticeMode(undefined)).toBe("FORMAL");
        });
        it("MIXED se respeta; basura desconocida cae a FORMAL", () => {
            expect(resolvePayrollPracticeMode("MIXED")).toBe("MIXED");
            expect(resolvePayrollPracticeMode("FORMAL")).toBe("FORMAL");
            expect(resolvePayrollPracticeMode("MIXTO" as never)).toBe("FORMAL");
        });
    });

    describe("resolveAguinaldoBase", () => {
        it("NULL/undefined = REGISTERED", () => {
            expect(resolveAguinaldoBase(null)).toBe("REGISTERED");
            expect(resolveAguinaldoBase(undefined)).toBe("REGISTERED");
        });
        it("EFFECTIVE se respeta; basura desconocida cae a REGISTERED", () => {
            expect(resolveAguinaldoBase("EFFECTIVE")).toBe("EFFECTIVE");
            expect(resolveAguinaldoBase("REGISTERED")).toBe("REGISTERED");
            expect(resolveAguinaldoBase("REAL" as never)).toBe("REGISTERED");
        });
    });

    describe("resolveEffectiveSalary", () => {
        it("sin dato efectivo: efectivo = base, gap = 0, esFormal (regresión cero)", () => {
            const r = resolveEffectiveSalary(25_000, null);
            expect(r).toEqual({
                baseRegistradaCents: 25_000,
                salarioEfectivoCents: 25_000,
                gapCents: 0,
                esFormal: true,
            });
            expect(resolveEffectiveSalary(25_000, undefined).esFormal).toBe(true);
        });

        it("con gap: la parte en efectivo es derivada, efectivo − base", () => {
            const r = resolveEffectiveSalary(25_000, 40_000);
            expect(r.salarioEfectivoCents).toBe(40_000);
            expect(r.gapCents).toBe(15_000);
            expect(r.esFormal).toBe(false);
        });

        it("efectivo igual al base no es casualidad capturable: es formal", () => {
            expect(resolveEffectiveSalary(25_000, 25_000).esFormal).toBe(true);
        });

        it("la parte en efectivo NUNCA se captura suelta: no hay API que la tome por separado", () => {
            // Documentación: la firma sólo acepta (base, efectivo). "Parte en
            // efectivo" no existe como input; quien la quiera la deriva del gap.
            expect(resolveEffectiveSalary.length).toBe(2);
        });
    });
});
