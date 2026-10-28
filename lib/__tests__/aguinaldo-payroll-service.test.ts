import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    reads: [] as unknown[][],
    writes: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    base: "EFFECTIVE",
    corte: null as string | null,
    ausencias: {} as Record<string, Array<{
        id: string; desde: string; hasta: string; aprobada: boolean;
        tratamiento: "COMPUTABLE" | "NO_COMPUTABLE" | "REVISAR";
    }>>,
    fiscalAvailable: true,
    fiscalDate: "",
    failPayslip: false,
    failDispersion: false,
    committed: false,
    timbrar: vi.fn(async () => ({ uuid: "cfdi-test", status: "TIMBRADO" })),
}));

vi.mock("@/lib/db", () => { const db = {
    execute: async () => ({ rows: [] }),
    select: () => {
        let table: unknown;
        const rows = () => {
            const stored = state.writes.filter((write) => write.table === table);
            if (stored.length || table === payrollPayslips || table === payrollAguinaldoDispersiones) return stored.map((write) => write.values);
            return state.reads.shift() ?? [];
        };
        const query = {
            from: (selected: unknown) => { table = selected; return query; }, innerJoin: () => query, leftJoin: () => query, where: () => query, for: () => query,
            limit: async () => rows(),
            then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows()).then(resolve),
        };
        return query;
    },
    insert: (table: unknown) => ({ values: (input: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === payrollPayslips && state.failPayslip) throw new Error("fallo al guardar snapshot");
        if (table === payrollAguinaldoDispersiones && state.failDispersion) throw new Error("fallo bitácora");
        const rows = (Array.isArray(input) ? input : [input]).map((values) => ({ id: `test-${state.writes.length}`, ...structuredClone(values) }));
        rows.forEach((values) => state.writes.push({ table, values }));
        const query = { onConflictDoNothing: () => query, returning: async () => rows,
            then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
        return query;
    } }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: () => {
        const stored = state.writes.find((w) => w.table === table);
        if (stored) Object.assign(stored.values, values);
        return { returning: async () => stored ? [stored.values] : [],
            then: (resolve: (value: undefined) => unknown) => Promise.resolve(undefined).then(resolve) };
    } }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const before = state.writes.length;
        try { const value = await fn(db); if (state.writes.length > before) state.committed = true; return value; }
        catch (error) { state.writes.splice(before); throw error; }
    },
}; return { db }; });
vi.mock("@/lib/services/labor-rules-resolver", () => ({
    resolveLaborLawRules: async () => ({ aguinaldoDaysMxn: 15, umaDailyMxn: state.fiscalAvailable ? 117.31 : null, source: "law-table" }),
    resolveFiscalLaborLawRules: async (date: Date) => {
        state.fiscalDate = date.toISOString().slice(0, 10);
        if (!state.fiscalAvailable) throw new Error("UMA diaria no disponible: cálculo fiscal bloqueado");
        return { aguinaldoDaysMxn: 15, umaDailyMxn: date.toISOString().slice(0, 10) < "2026-02-01" ? 113.14 : 117.31, source: "law-table" };
    },
}));
vi.mock("@/lib/services/tenant-config-service", () => ({
    getTenantOperatingConfig: async () => ({ aguinaldoBase: state.base, payrollPracticeMode: "MIXED" }),
}));
vi.mock("@/lib/services/aguinaldo-days-adapter", () => ({
    cargarFuentesDiasAguinaldo: async ({ anioFiscal, empleados, fechaCorte }: {
        anioFiscal: number; fechaCorte?: string;
        empleados: Array<{ userId: string; branchId: string | null }>;
    }) => ({
        anioFiscal,
        fechaCorte: fechaCorte ?? state.corte ?? (anioFiscal >= 2026 ? "2026-12-15" : `${anioFiscal}-12-31`),
        porUsuario: Object.fromEntries(empleados.map((empleado) => [empleado.userId, {
            zona: "America/Mexico_City", diasConTurno: [],
            ausencias: state.ausencias[empleado.userId] ?? [],
        }])),
        advertencias: ["Cobertura PARCIAL: los turnos COMPLETED acreditan actividad, no prueban ausencia."],
        coberturaFuentes: "PARCIAL" as const,
    }),
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-15T18:00:00Z"));
    state.reads = [roster];
    state.writes = [];
    state.base = "EFFECTIVE";
    state.corte = null;
    state.ausencias = {};
    state.fiscalAvailable = true;
    state.fiscalDate = "";
    state.failPayslip = false;
    state.failDispersion = false;
    state.committed = false;
    state.timbrar.mockReset();
    state.timbrar.mockResolvedValue({ uuid: "cfdi-test", status: "TIMBRADO" });
});

describe("AGU-03B.3 — autorización persistida antes del proveedor", () => {
    it("confirma la transacción de snapshots antes de timbrar y conserva fecha/importes/actor", async () => {
        state.base = "REGISTERED";
        state.reads = [[], [{ ...roster[0], hireDate: "2025-01-01", baseSalary: 60000 }]];
        state.timbrar.mockImplementationOnce(async () => {
            expect(state.committed).toBe(true);
            expect(state.writes.find((w) => w.table === payrollPayslips)?.values).toMatchObject({
                cfdiStatus: "PENDIENTE", totalPercepcionesCents: 900000, totalDeduccionesCents: 119731,
                aguinaldoSnapshot: { userId: "employee", pago: { netoCents: 780269 } },
            });
            return { uuid: "cfdi-test", status: "TIMBRADO" };
        });
        await executeAguinaldoRun("company", 2025, "actor", { fechaPago: "2026-01-31", diasLaboradosPorUsuario: { employee: 365 } });
        expect(state.writes.find((w) => w.values.aguinaldoFiscalYear === 2025)?.values.aguinaldoSnapshot)
            .toMatchObject({ performedBy: "actor", fechaPago: "2026-01-31", anioFiscal: 2025 });
        expect(state.writes.filter((w) => w.table === payrollPayslips)).toHaveLength(1);
    });

    it("si falla la persistencia del snapshot revierte la corrida y no llama al proveedor", async () => {
        state.reads = [[], roster]; state.failPayslip = true;
        await expect(executeAguinaldoRun("company", 2026, "actor")).rejects.toThrow(/snapshot/);
        expect(state.writes).toHaveLength(0);
        expect(state.timbrar).not.toHaveBeenCalled();
    });

    it.each(["RECHAZADO", "PENDIENTE", "ERROR"])("%s no se reporta como timbrado ni pierde deducciones autorizadas", async (status) => {
        state.base = "REGISTERED";
        state.reads = [[], [{ ...roster[0], baseSalary: 60000 }]];
        state.timbrar.mockResolvedValueOnce({ uuid: "", status });
        const result = await executeAguinaldoRun("company", 2026, "actor", { diasLaboradosPorUsuario: { employee: 365 } });
        expect(result.results).toEqual([expect.objectContaining({ success: false, userId: "employee" })]);
        const writes = state.writes.filter((w) => w.table === payrollPayslips);
        expect(writes).toHaveLength(1);
        expect(writes[0].values).toMatchObject({ cfdiStatus: status, totalDeduccionesCents: 117065,
            aguinaldoSnapshot: { pago: { totalDeduccionesCents: 117065, netoCents: 782935 } } });
        expect(state.writes.filter((w) => w.table === payrollAguinaldoDispersiones)).toHaveLength(0);
    });

    it("una excepción del proveedor actualiza el mismo recibo sin borrar ISR/neto del snapshot", async () => {
        state.base = "REGISTERED";
        state.reads = [[], [{ ...roster[0], baseSalary: 60000 }]];
        state.timbrar.mockRejectedValueOnce(new Error("sin respuesta"));
        const result = await executeAguinaldoRun("company", 2026, "actor", { diasLaboradosPorUsuario: { employee: 365 } });
        expect(result.results).toHaveLength(1);
        expect(result.results[0].success).toBe(false);
        const writes = state.writes.filter((w) => w.table === payrollPayslips);
        expect(writes).toHaveLength(1);
        expect(writes[0].values).toMatchObject({ cfdiStatus: "ERROR", totalDeduccionesCents: 117065 });
    });

    it("fallo de bitácora después del timbre conserva el recibo confirmado y devuelve un resultado", async () => {
        state.reads = [[], roster]; state.failDispersion = true;
        const result = await executeAguinaldoRun("company", 2026, "actor");
        expect(result.results).toEqual([expect.objectContaining({ success: false, error: expect.stringMatching(/bitácora/) })]);
        const writes = state.writes.filter((w) => w.table === payrollPayslips);
        expect(writes).toHaveLength(1);
        expect(writes[0].values).toMatchObject({ cfdiStatus: "TIMBRADO", cfdiUuid: "cfdi-test" });
    });
});

afterEach(() => vi.useRealTimers());

describe("AGU-02B — consumidor del gravado (DB/proveedor simulados)", () => {
    it.each([
        { days: 90, gross: 221_918, exempt: 221_918, taxable: 0, tax: 0 },
        { days: 365, gross: 900_000, exempt: 351_930, taxable: 548_070, tax: 117_065 },
    ])("SD 600 / días $days: CFDI y payslip conservan deducción $tax", async (f) => {
        state.base = "REGISTERED";
        const employees = [{ ...roster[0], baseSalary: 60_000 }];
        state.reads = [employees];
        const dias = { diasLaboradosPorUsuario: { employee: f.days } };
        expect((await previsualizarAguinaldo("company", 2026, undefined, dias)).rows[0].calculo)
            .toMatchObject({ brutoCents: f.gross, exentoCents: f.exempt, gravadoCents: f.taxable });
        state.reads = [[], employees];
        const run = await executeAguinaldoRun("company", 2026, "actor", dias);
        expect(run.results[0].success).toBe(true);
        expect(state.timbrar).toHaveBeenCalledWith(expect.objectContaining({
            totalPercepciones: f.gross, totalDeducciones: f.tax,
            desglosePercepciones: [{ amount: f.gross, exemptAmount: f.exempt }],
            desgloseDeducciones: f.tax === 0 ? undefined : [expect.objectContaining({ deductionTypeCode: "002", amount: f.tax })],
        }));
        expect(state.writes.find((w) => w.table === payrollPayslips)?.values)
            .toMatchObject({ totalPercepcionesCents: f.gross, totalDeduccionesCents: f.tax, cfdiStatus: "TIMBRADO" });
    });
});

describe("AGU-02C.2 — coordinación del subsidio mensual", () => {
    it.each([35_000, 25_000])("SD %s: exige acumulados antes de timbrar ajuste o crédito mensual", async (dailyCents) => {
        // SD 350: el mes real pierde subsidio aunque el hipotético no cruza.
        // SD 250: el remanente del subsidio del ordinario cubriría el aguinaldo.
        state.base = "REGISTERED";
        state.reads = [[], [{ ...roster[0], baseSalary: dailyCents }]];
        await expect(executeAguinaldoRun("company", 2026, "actor", {
            diasLaboradosPorUsuario: { employee: 365 },
        })).rejects.toThrow(/acumulados mensuales/i);
        expect(state.timbrar).not.toHaveBeenCalled();
        expect(state.writes).toHaveLength(0);
    });
});

describe("AGU-03A.1 — preview y ejecución con la misma fecha y pago", () => {
    it("pago enero 2026 de aguinaldo causado en 2025: UMA/tarifa al pago, periodo causado intacto", async () => {
        state.base = "REGISTERED";
        const employees = [{ ...roster[0], hireDate: "2025-01-01", baseSalary: 60_000 }];
        state.reads = [employees];
        const options = { fechaPago: "2026-01-31", diasLaboradosPorUsuario: { employee: 365 } };
        const preview = await previsualizarAguinaldo("company", 2025, undefined, options);
        expect(state.fiscalDate).toBe("2026-01-31");
        // Hipotético 46689; ISR ordinario 200772 y combinado 210744:
        // round(560580 × (210744 − 200772) / 46689) = 119731.
        expect(preview).toMatchObject({ fechaPago: "2026-01-31", totalDeduccionesCents: 119_731, totalNetoCents: 780_269 });
        expect(preview.rows[0]).toMatchObject({
            calculo: { brutoCents: 900_000, exentoCents: 339_420, gravadoCents: 560_580 },
            pago: { totalDeduccionesCents: 119_731, netoCents: 780_269 },
        });
        state.reads = [[], employees];
        await executeAguinaldoRun("company", 2025, "actor", options);
        expect(state.timbrar).toHaveBeenCalledWith(expect.objectContaining({
            fechaPago: "2026-01-31", fechaPagoInicial: "2025-01-01", fechaPagoFinal: "2025-12-31",
            totalPercepciones: 900_000, totalDeducciones: preview.totalDeduccionesCents,
        }));
        expect(state.writes.find((w) => w.table === payrollPayslips)?.values.totalDeduccionesCents).toBe(preview.totalDeduccionesCents);
    });

    it("año de pago sin tarifa bloquea aun con cero antes de crear el run", async () => {
        state.reads = [[], roster];
        await expect(executeAguinaldoRun("company", 2026, "actor", {
            fechaPago: "2027-01-01", diasLaboradosPorUsuario: { employee: 0 },
        })).rejects.toThrow(/tarifa/i);
        expect(state.writes).toHaveLength(0);
        expect(state.timbrar).not.toHaveBeenCalled();
    });

    it("una fecha civil imposible no consulta fuentes ni crea efectos", async () => {
        await expect(previsualizarAguinaldo("company", 2026, undefined, { fechaPago: "2026-02-29" })).rejects.toThrow(/fechaPago/);
        expect(state.fiscalDate).toBe("");
        expect(state.writes).toHaveLength(0);
    });

    it("la preview deja visible el bloqueo por subsidio y excluye su neto de los totales", async () => {
        state.base = "REGISTERED";
        state.reads = [[{ ...roster[0], baseSalary: 35_000 }]];
        const preview = await previsualizarAguinaldo("company", 2026, undefined, { diasLaboradosPorUsuario: { employee: 365 } });
        expect(preview.rows[0]).toMatchObject({ error: expect.stringMatching(/acumulados mensuales/i), pago: null });
        expect(preview).toMatchObject({ empleadosATimbrar: 0, totalDeduccionesCents: 0, totalNetoCents: 0 });
    });

    it("sin RFC excluye importes de los totales y bloquea antes de crear la corrida", async () => {
        const employees = [{ ...roster[0], rfc: null }];
        state.reads = [employees];
        expect(await previsualizarAguinaldo("company", 2026)).toMatchObject({
            empleadosSinRFC: 1, empleadosATimbrar: 0, totalBrutoCents: 0, totalDeduccionesCents: 0, totalNetoCents: 0,
        });
        state.reads = [[], employees];
        await expect(executeAguinaldoRun("company", 2026, "actor")).rejects.toThrow(/RFC/);
        expect(state.writes).toHaveLength(0);
    });
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

    it("sin override usa la propuesta auditable: calendario de vigencia menos ausencias aprobadas", async () => {
        expect((await previsualizarAguinaldo("company", 2026)).rows[0]).toMatchObject({
            diasLaborados: 365, fuenteDias: "PROPUESTA_AUDITABLE", diasAutomaticos: 365,
            propuestaDias: { fechaCorte: "2026-12-15", diasNoComputables: 0, requiereRevision: false, coberturaFuentes: "PARCIAL" },
        });
        state.ausencias = { employee: [
            { id: "falta", desde: "2026-03-02", hasta: "2026-03-03", aprobada: true, tratamiento: "NO_COMPUTABLE" },
        ] };
        state.reads = [roster];
        expect((await previsualizarAguinaldo("company", 2026)).rows[0])
            .toMatchObject({ diasLaborados: 363, fuenteDias: "PROPUESTA_AUDITABLE", propuestaDias: { diasNoComputables: 2 } });
    });

    it("una clasificación pendiente bloquea sin override y el manual 0 la confirma", async () => {
        state.ausencias = { employee: [
            { id: "duda", desde: "2026-03-02", hasta: "2026-03-02", aprobada: true, tratamiento: "REVISAR" },
        ] };
        const bloqueada = await previsualizarAguinaldo("company", 2026);
        expect(bloqueada.rows[0]).toMatchObject({
            error: expect.stringMatching(/Días por revisar/),
            propuestaDias: { pendientes: 1, requiereRevision: true },
        });
        expect(bloqueada).toMatchObject({ empleadosATimbrar: 0, totalBrutoCents: 0 });
        state.reads = [[], roster];
        await expect(executeAguinaldoRun("company", 2026, "actor")).rejects.toThrow(/Días por revisar/);
        expect(state.timbrar).not.toHaveBeenCalled();
        state.reads = [roster];
        const confirmada = await previsualizarAguinaldo("company", 2026, undefined, { diasLaboradosPorUsuario: { employee: 0 } });
        expect(confirmada.rows[0]).toMatchObject({ diasLaborados: 0, fuenteDias: "MANUAL", error: undefined });
        expect(confirmada.rows[0].propuestaDias?.requiereRevision).toBe(true);
    });

    it.each([NaN, Infinity, -1, 1.5, 367, null, "30"])("rechaza días inválidos %s antes de generar efectos", async (value) => {
        const dias = { diasLaboradosPorUsuario: { employee: value as number } };
        await expect(previsualizarAguinaldo("company", 2026, undefined, dias)).rejects.toThrow(RangeError);
        state.reads = [[], roster];
        await expect(executeAguinaldoRun("company", 2026, "actor", dias)).rejects.toThrow(RangeError);
        expect(state.writes).toHaveLength(0);
        expect(state.timbrar).not.toHaveBeenCalled();
    });

    it("FIS-02C: sin UMA verificada preview/run bloquean antes de timbrar o crear una corrida", async () => {
        state.fiscalAvailable = false;
        await expect(previsualizarAguinaldo("company", 2026)).rejects.toThrow(/fiscal bloqueado/);
        state.reads = [[], roster];
        await expect(executeAguinaldoRun("company", 2026, "actor")).rejects.toThrow(/fiscal bloqueado/);
        expect(state.writes).toHaveLength(0);
        expect(state.timbrar).not.toHaveBeenCalled();
    });
});
