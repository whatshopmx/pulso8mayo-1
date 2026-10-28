import { beforeEach, describe, expect, it, vi } from "vitest";
import { branches, leaveRequests, shiftSessions, vacationRequests } from "@/lib/db/schema";

/**
 * DIA-02A — adaptador de fuentes reales de días de aguinaldo.
 * Los helpers puros fijan la clasificación jurídica y la semántica civil/local;
 * la consulta se ejerce con fuentes simuladas (sin base de datos).
 */
const state = vi.hoisted(() => ({
    reads: new Map<string, unknown[]>(),
    calls: [] as string[],
}));

vi.mock("@/lib/db", () => {
    const db = {
        execute: async () => ({ rows: [] }),
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
        select: () => {
            let table: unknown;
            const rows = () => (state.reads.get(table) ?? []).slice();
            const query = {
                from: (selected: unknown) => { table = selected; state.calls.push(String(selected)); return query; },
                innerJoin: () => query,
                where: () => query,
                orderBy: () => query,
                limit: async () => rows(),
                then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows()).then(resolve),
            };
            return query;
        },
    };
    return { db };
});

import {
    ZONA_DIAS_POR_DEFECTO,
    cargarFuentesDiasAguinaldo,
    clasificarAusencia,
    diaCivilEnZona,
    resolverFechaCorte,
    segmentosSinCubrir,
} from "@/lib/services/aguinaldo-days-adapter";

beforeEach(() => {
    state.reads.clear();
    state.calls.length = 0;
});

describe("DIA-02A — clasificación explícita del catálogo de permisos", () => {
    it.each([
        ["Vacaciones", true, "COMPUTABLE"],
        ["MATERNITY", false, "COMPUTABLE"],
        ["Paternidad", false, "COMPUTABLE"],
        ["Riesgo de trabajo", false, "COMPUTABLE"],
    ])("%s (isPaid=%s) conserva tratamiento protegido/legal", (name, isPaid, tratamiento) => {
        expect(clasificarAusencia({ name, isPaid })).toMatchObject({ tratamiento });
    });

    it("enfermedad general no computa por sí sola (PROFEDET) aunque esté pagada", () => {
        expect(clasificarAusencia({ name: "Enfermedad general", isPaid: true }))
            .toMatchObject({ tratamiento: "NO_COMPUTABLE", base: expect.stringMatching(/mejor condición contractual/i) });
    });

    it("un permiso sin goce no computa por el dato de pago", () => {
        expect(clasificarAusencia({ name: "Permiso libre", isPaid: false }))
            .toMatchObject({ tratamiento: "NO_COMPUTABLE", base: expect.stringMatching(/sin goce/i) });
    });

    it.each([
        [{ name: "Permiso especial pagado", isPaid: true }],
        [{ name: "", isPaid: true }],
        [{ name: "Incapacidad", isPaid: null }],
    ])("el nombre libre %o no se copia a ciegas: entrega REVISAR", (tipo) => {
        expect(clasificarAusencia(tipo)).toMatchObject({ tratamiento: "REVISAR" });
    });
});

describe("DIA-02A — semántica civil/local y corte", () => {
    it("un turno nocturno se asigna al día local de inicio, no al día UTC", () => {
        const instante = new Date("2026-03-01T04:00:00Z"); // 28-feb 22:00 en CDMX
        expect(diaCivilEnZona(instante, "America/Mexico_City")).toBe("2026-02-28");
        expect(diaCivilEnZona(instante, "UTC")).toBe("2026-03-01");
    });

    it("el corte nunca rebasa el cierre del año causado", () => {
        expect(resolverFechaCorte(2025, "2026-10-28")).toBe("2025-12-31");
        expect(resolverFechaCorte(2026, "2026-10-28")).toBe("2026-10-28");
        expect(() => resolverFechaCorte(2026, "2026-02-29")).toThrow(RangeError);
    });

    it("las vacaciones parten el permiso sin duplicar días ni inventar revisión", () => {
        const cubierto = new Set(["2026-07-02", "2026-07-03"]);
        expect(segmentosSinCubrir("2026-07-01", "2026-07-05", cubierto)).toEqual([
            { desde: "2026-07-01", hasta: "2026-07-01" },
            { desde: "2026-07-04", hasta: "2026-07-05" },
        ]);
        expect(segmentosSinCubrir("2026-07-02", "2026-07-03", cubierto)).toEqual([]);
        expect(segmentosSinCubrir("2026-07-01", "2026-07-03", new Set())).toEqual([
            { desde: "2026-07-01", hasta: "2026-07-03" },
        ]);
    });
});

describe("DIA-02A — consulta de fuentes reales (DB simulada)", () => {
    const empleados = [
        { userId: "emp-a", branchId: "branch-cdmx" },
        { userId: "emp-b", branchId: "branch-sin-zona" },
        { userId: "emp-c", branchId: null },
    ];

    it("cruza turnos, vacaciones y permisos; acota a la plantilla y avisa cobertura parcial", async () => {
        state.reads.set(branches, [
            { id: "branch-cdmx", timezone: "America/Mexico_City" },
            { id: "branch-sin-zona", timezone: "Zona/Inventada" },
        ]);
        state.reads.set(shiftSessions, [
            { userId: "emp-a", iniciado: new Date("2026-03-01T04:00:00Z") }, // 28-feb local
            { userId: "emp-a", iniciado: new Date("2026-03-01T18:00:00Z") }, // 1-mar local
            { userId: "emp-ajeno", iniciado: new Date("2026-03-02T18:00:00Z") }, // otra plantilla
        ]);
        state.reads.set(vacationRequests, [
            { id: "vac-1", userId: "emp-a", desde: "2026-07-02", hasta: "2026-07-03" },
        ]);
        state.reads.set(leaveRequests, [
            // Mismo rango que la vacación + un día extra: sólo el día extra se clasifica.
            { id: "per-1", userId: "emp-a", desde: "2026-07-01", hasta: "2026-07-03", nombre: "Permiso libre", pagado: true },
            { id: "per-2", userId: "emp-a", desde: "2026-09-01", hasta: "2026-09-02", nombre: "Permiso sin goce", pagado: false },
            { id: "per-3", userId: "emp-ajeno", desde: "2026-09-01", hasta: "2026-09-02", nombre: "Vacaciones", pagado: true },
        ]);

        const fuentes = await cargarFuentesDiasAguinaldo({
            companyId: "company", anioFiscal: 2026, fechaCorte: "2026-10-28", empleados,
        });

        expect(fuentes.porUsuario["emp-a"]).toMatchObject({
            zona: "America/Mexico_City",
            diasConTurno: ["2026-02-28", "2026-03-01"],
        });
        expect(fuentes.porUsuario["emp-a"].ausencias).toEqual([
            { id: "permiso:per-1:0", desde: "2026-07-01", hasta: "2026-07-01", aprobada: true, tratamiento: "REVISAR" },
            { id: "vacacion:vac-1", desde: "2026-07-02", hasta: "2026-07-03", aprobada: true, tratamiento: "COMPUTABLE" },
            { id: "permiso:per-2:0", desde: "2026-09-01", hasta: "2026-09-02", aprobada: true, tratamiento: "NO_COMPUTABLE" },
        ]);
        // Sin zona válida se usa el default explícito y se advierte.
        expect(fuentes.porUsuario["emp-b"].zona).toBe(ZONA_DIAS_POR_DEFECTO);
        expect(fuentes.porUsuario["emp-c"].zona).toBe(ZONA_DIAS_POR_DEFECTO);
        expect(fuentes.advertencias.join(" ")).toMatch(/2 empleado\(s\) sin zona IANA válida/);
        expect(fuentes.advertencias.join(" ")).toMatch(/Cobertura PARCIAL/);
        expect(fuentes.coberturaFuentes).toBe("PARCIAL");
        expect(fuentes.porUsuario["emp-ajeno"]).toBeUndefined();
    });

    it("rechaza año y corte inválidos antes de consultar", async () => {
        await expect(cargarFuentesDiasAguinaldo({ companyId: "company", anioFiscal: 1200, empleados })).rejects.toThrow(RangeError);
        await expect(cargarFuentesDiasAguinaldo({
            companyId: "company", anioFiscal: 2026, fechaCorte: "2026-02-30", empleados,
        })).rejects.toThrow(RangeError);
        expect(state.calls).toHaveLength(0);
    });
});
