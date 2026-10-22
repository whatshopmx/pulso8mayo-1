import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    reads: [] as unknown[][],
    writes: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    base: "EFFECTIVE",
    automaticDays: 200 as number | null,
    timbrar: vi.fn(async () => ({ uuid: "cfdi-test", status: "TIMBRADO" })),
}));

vi.mock("@/lib/db", () => ({ db: {
    select: () => {
        const rows = state.reads.shift() ?? [];
        const query = {
            from: () => query, innerJoin: () => query, leftJoin: () => query, where: () => query,
            limit: async () => rows,
            then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return query;
    },
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
        state.writes.push({ table, values });
        return { returning: async () => [{ id: "test-id", ...values }] };
    } }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
} }));
vi.mock("@/lib/services/labor-rules-resolver", () => ({
    resolveLaborLawRules: async () => ({ aguinaldoDaysMxn: 15, umaDailyMxn: 117.31, source: "law-table" }),
}));
vi.mock("@/lib/services/tenant-config-service", () => ({
    getTenantOperatingConfig: async () => ({ aguinaldoBase: state.base, payrollPracticeMode: "MIXED" }),
}));
vi.mock("@/lib/services/dias-laborados-service", () => ({
    conteoDiasLaboradosAnual: async () => ({ porUsuario: state.automaticDays === null ? {} : { employee: { dias: state.automaticDays } } }),
}));
vi.mock("@/lib/services/fiscal-service", () => ({
    timbrarNomina: state.timbrar,
    percepcionAguinaldo: (amount: number, exemptAmount: number) => ({ amount, exemptAmount }),
}));
vi.mock("@/lib/services/aguinaldo-service", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/services/aguinaldo-service")>();
    return { ...actual, calcularAguinaldoAnual: vi.fn(actual.calcularAguinaldoAnual) };
});

import { executeAguinaldoRun, previsualizarAguinaldo } from "@/lib/services/aguinaldo-payroll-service";
import { calcularAguinaldoAnual } from "@/lib/services/aguinaldo-service";
import { payrollAguinaldoDispersiones, payrollPayslips } from "@/lib/db/schema";

const roster = [{
    userId: "employee", name: "Empleado", rfc: "TEST010101AAA", branchId: "branch",
    hireDate: "2026-01-01", seniorityDate: null, isActive: true,
    baseSalary: 30_000, effectiveSalaryCents: 60_000, contractStatus: "ACTIVE",
}];

beforeEach(() => {
    vi.clearAllMocks();
    state.reads = [roster];
    state.writes = [];
    state.base = "EFFECTIVE";
    state.automaticDays = 200;
});

describe("AGU-01 — días explícitos en preview y run (DB/proveedor simulados)", () => {
    it.each(["REGISTERED", "EFFECTIVE"])("MANUAL 0 conserva cero explícito en ambas bases: %s", async (base) => {
        state.base = base;
        const preview = await previsualizarAguinaldo("company", 2026, undefined, { diasLaboradosPorUsuario: { employee: 0 } });
        expect(preview.rows[0]).toMatchObject({ diasLaborados: 0, fuenteDias: "MANUAL", diferenciaCents: 0,
            calculo: { brutoCents: 0, exentoCents: 0, gravadoCents: 0 }, calculoEfectivo: { brutoCents: 0 } });
        // Cero debe llegar como valor, sin convertirse al sentinel "no proporcionado".
        expect(calcularAguinaldoAnual).toHaveBeenCalledWith(expect.objectContaining({ base: "REGISTERED", diasLaborados: 0 }));
        expect(calcularAguinaldoAnual).toHaveBeenCalledWith(expect.objectContaining({ base: "EFFECTIVE", diasLaborados: 0 }));
        state.reads = [[], roster];
        const run = await executeAguinaldoRun("company", 2026, "actor", { diasLaboradosPorUsuario: { employee: 0 } });
        expect(run.results).toEqual([expect.objectContaining({ success: true, userId: "employee" })]);
        expect(state.timbrar).toHaveBeenCalledWith(expect.objectContaining({ totalPercepciones: 0, totalDeducciones: 0 }));
        expect(state.writes.find((w) => w.table === payrollPayslips)?.values).toMatchObject({ aguinaldoCents: 0, totalPercepcionesCents: 0, totalDeduccionesCents: 0 });
        expect(state.writes.filter((w) => w.table === payrollAguinaldoDispersiones)).toHaveLength(0);
    });

    it("MANUAL positivo prevalece al automático en ambas bases", async () => {
        const preview = await previsualizarAguinaldo("company", 2026, undefined, { diasLaboradosPorUsuario: { employee: 30 } });
        expect(preview.rows[0]).toMatchObject({ diasLaborados: 30, fuenteDias: "MANUAL",
            calculo: { brutoCents: 36_986 }, calculoEfectivo: { brutoCents: 73_973 } });
        state.reads = [[], roster];
        await executeAguinaldoRun("company", 2026, "actor", { diasLaboradosPorUsuario: { employee: 30 } });
        expect(state.timbrar).toHaveBeenCalledWith(expect.objectContaining({ totalPercepciones: 36_986 }));
        expect(state.writes.find((w) => w.table === payrollPayslips)?.values.aguinaldoCents).toBe(36_986);
    });

    it("sin override conserva automático; sin datos conserva calendario", async () => {
        expect((await previsualizarAguinaldo("company", 2026)).rows[0]).toMatchObject({ diasLaborados: 200, fuenteDias: "TURNOS_Y_PERMISOS" });
        state.reads = [roster]; state.automaticDays = null;
        expect((await previsualizarAguinaldo("company", 2026)).rows[0]).toMatchObject({ diasLaborados: 365, fuenteDias: "CALENDARIO" });
    });

    it.each([NaN, Infinity, -1, 1.5, 367, null, "30"])("rechaza días inválidos %s antes de generar efectos", async (value) => {
        const dias = { diasLaboradosPorUsuario: { employee: value as number } };
        await expect(previsualizarAguinaldo("company", 2026, undefined, dias)).rejects.toThrow(RangeError);
        state.reads = [[], roster];
        await expect(executeAguinaldoRun("company", 2026, "actor", dias)).rejects.toThrow(RangeError);
        expect(state.writes).toHaveLength(0);
        expect(state.timbrar).not.toHaveBeenCalled();
    });
});
