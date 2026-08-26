// Task 6 (plan-loteprod-gaps §6.2): hoja de producción diaria por estación.
import { describe, expect, it } from "vitest";
import {
    derivePrepLineState,
    groupByStation,
    normalizeDeadlineTime,
    normalizeStation,
    PREP_DEADLINE_WARNING_MINUTES,
    PREP_STATION_UNASSIGNED_LABEL,
    stationKey,
    type PrepLineLike,
} from "../prep-list";

const at = (h: number, m = 0) => h * 60 + m;

describe("normalizeStation", () => {
    it("recorta y colapsa espacios", () => {
        expect(normalizeStation("  Cocina   caliente ")).toBe("Cocina caliente");
    });

    it("vacío o sólo espacios es null, para no partir el grupo en tres", () => {
        expect(normalizeStation("")).toBeNull();
        expect(normalizeStation("   ")).toBeNull();
        expect(normalizeStation(null)).toBeNull();
        expect(normalizeStation(undefined)).toBeNull();
    });
});

describe("stationKey", () => {
    it("ignora mayúsculas y acentos: es la misma estación", () => {
        expect(stationKey("Cocina Fría")).toBe(stationKey("cocina fria"));
        expect(stationKey("PANADERÍA")).toBe("panaderia");
    });

    it("sin estación devuelve clave vacía", () => {
        expect(stationKey(null)).toBe("");
        expect(stationKey("  ")).toBe("");
    });
});

describe("derivePrepLineState", () => {
    it("el estatus de la orden manda sobre la hora", () => {
        expect(derivePrepLineState("COMPLETED", at(9, 30), at(23, 0))).toBe("HECHA");
        expect(derivePrepLineState("CANCELLED", at(9, 30), at(23, 0))).toBe("CANCELADA");
    });

    it("sin hora límite nunca se marca atrasada", () => {
        expect(derivePrepLineState("PLANNED", null, at(23, 59))).toBe("PENDIENTE");
    });

    it("en el minuto exacto de la hora límite todavía está a tiempo", () => {
        expect(derivePrepLineState("PLANNED", at(9, 30), at(9, 30))).toBe("POR_VENCER");
        expect(derivePrepLineState("PLANNED", at(9, 30), at(9, 31))).toBe("ATRASADA");
    });

    it("entra en por vencer dentro de la ventana de aviso", () => {
        const deadline = at(9, 30);
        expect(derivePrepLineState("PLANNED", deadline, deadline - PREP_DEADLINE_WARNING_MINUTES)).toBe("POR_VENCER");
        expect(derivePrepLineState("PLANNED", deadline, deadline - PREP_DEADLINE_WARNING_MINUTES - 1)).toBe("PENDIENTE");
    });

    it("una orden en progreso pasada de hora sí es atrasada", () => {
        expect(derivePrepLineState("IN_PROGRESS", at(8, 0), at(10, 0))).toBe("ATRASADA");
    });

    it("respeta una ventana de aviso distinta", () => {
        expect(derivePrepLineState("PLANNED", at(9, 30), at(9, 0), 60)).toBe("POR_VENCER");
        expect(derivePrepLineState("PLANNED", at(9, 30), at(9, 0), 15)).toBe("PENDIENTE");
    });
});

describe("groupByStation", () => {
    const line = (
        station: string | null,
        deadlineTime: string | null,
        state: PrepLineLike["state"],
        name = "x",
    ) => ({ station, deadlineTime, state, name });

    it("junta variantes de la misma estación bajo la primera etiqueta vista", () => {
        const groups = groupByStation([
            line("Cocina Fría", "09:00", "PENDIENTE"),
            line("cocina fria", "10:00", "PENDIENTE"),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe("Cocina Fría");
        expect(groups[0].lines).toHaveLength(2);
    });

    it("las líneas sin estación caen en un cajón propio, siempre al final", () => {
        const groups = groupByStation([
            line(null, "09:00", "ATRASADA"),
            line("Parrilla", "12:00", "PENDIENTE"),
        ]);
        expect(groups.map(g => g.label)).toEqual(["Parrilla", PREP_STATION_UNASSIGNED_LABEL]);
    });

    it("ordena las estaciones por atrasadas y luego por pendientes", () => {
        const groups = groupByStation([
            line("Barra", "09:00", "PENDIENTE"),
            line("Barra", "10:00", "PENDIENTE"),
            line("Freidora", "08:00", "ATRASADA"),
        ]);
        expect(groups.map(g => g.label)).toEqual(["Freidora", "Barra"]);
    });

    it("dentro de la estación lo urgente va arriba y las sin hora al final", () => {
        const groups = groupByStation([
            line("Cocina", null, "PENDIENTE", "sin-hora"),
            line("Cocina", "11:00", "HECHA", "hecha"),
            line("Cocina", "10:00", "PENDIENTE", "tarde"),
            line("Cocina", "07:00", "ATRASADA", "atrasada"),
            line("Cocina", "09:00", "PENDIENTE", "temprano"),
        ]);
        expect(groups[0].lines.map(l => l.name)).toEqual([
            "atrasada", "temprano", "tarde", "sin-hora", "hecha",
        ]);
    });

    it("los contadores excluyen canceladas del total y del avance", () => {
        const groups = groupByStation([
            line("Cocina", "07:00", "ATRASADA"),
            line("Cocina", "08:00", "HECHA"),
            line("Cocina", "09:00", "CANCELADA"),
            line("Cocina", "10:00", "PENDIENTE"),
        ]);
        const [cocina] = groups;
        expect(cocina.total).toBe(3);
        expect(cocina.done).toBe(1);
        expect(cocina.pending).toBe(2);
        expect(cocina.overdue).toBe(1);
    });

    it("sin líneas no inventa estaciones", () => {
        expect(groupByStation([])).toEqual([]);
    });
});

describe("normalizeDeadlineTime", () => {
    it("acepta lo que manda el input time y lo que devuelve Postgres", () => {
        expect(normalizeDeadlineTime("09:30")).toBe("09:30");
        expect(normalizeDeadlineTime("09:30:00")).toBe("09:30");
        expect(normalizeDeadlineTime("9:05")).toBe("09:05");
    });

    it("vacío es borrar la hora, no un error", () => {
        expect(normalizeDeadlineTime("")).toBeNull();
        expect(normalizeDeadlineTime(null)).toBeNull();
        expect(normalizeDeadlineTime(undefined)).toBeNull();
    });

    it("una hora imposible se distingue de borrarla", () => {
        expect(normalizeDeadlineTime("25:00")).toBeUndefined();
        expect(normalizeDeadlineTime("09:70")).toBeUndefined();
        expect(normalizeDeadlineTime("mañana")).toBeUndefined();
    });
});
