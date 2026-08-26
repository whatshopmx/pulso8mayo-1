// lib/inventory/prep-list.ts
//
// Task 6 (plan-loteprod-gaps §6.2): Hoja de Producción Diaria (prep list).
// El manual la describe como una tabla por ESTACIÓN con columnas
// «Preparación | Cant. a producir | Lote a usar (FEFO) | Turno | Responsable |
// Hora límite | Estatus». `production_orders` sólo tenía fecha/cantidad/estatus;
// aquí vive la lógica pura que convierte esas filas en la hoja: cómo se agrupa
// por estación y cómo se decide el estatus contra la hora límite.
//
// Sin DB a propósito: la API, la vista y los tests comparten EXACTAMENTE el
// mismo criterio, igual que `hold-time.ts` para §6.4.
//
// RELOJ: nada de aquí lee la hora. La hora límite es una hora de pared
// ("09:30") sin fecha ni zona, así que se compara contra los minutos del día
// EN LA ZONA DE LA SUCURSAL — `localMoment(now, branch.timezone).minutesOfDay`
// de `lib/workflows/today.ts`, que ya resuelve ese problema para el tablero de
// hoy. Comparar contra el reloj del servidor marcaría atrasada una prep list de
// Tijuana a media mañana.

import { parseTimeOfDay } from "@/lib/workflows/today";

/**
 * Estatus de una línea de la prep list. `HECHA`/`CANCELADA` vienen del estatus
 * de la orden; los otros tres salen de la hora límite.
 */
export type PrepLineState = "HECHA" | "CANCELADA" | "ATRASADA" | "POR_VENCER" | "PENDIENTE";

/**
 * Antelación con la que una línea entra en "por vencer". 30 min es el orden de
 * magnitud de las tareas del cronograma del manual (§7: 08:00 pre-preparación →
 * 09:30 validar prep list completa); avisar antes sería ruido toda la mañana.
 */
export const PREP_DEADLINE_WARNING_MINUTES = 30;

/**
 * Estaciones sugeridas en la UI. Es un catálogo de ARRANQUE, no un enum: cada
 * cocina nombra sus estaciones distinto y la columna es texto libre. Por eso el
 * agrupado normaliza en vez de validar contra esta lista.
 */
export const PREP_STATION_SUGGESTIONS = [
    "Cocina caliente",
    "Cocina fría",
    "Prep station",
    "Parrilla",
    "Freidora",
    "Panadería",
    "Barra",
] as const;

/** Etiqueta del grupo que junta las líneas sin estación declarada. */
export const PREP_STATION_UNASSIGNED_LABEL = "Sin estación";

/**
 * Texto de estación normalizado para guardar: recorta y colapsa espacios.
 * Vacío → null, para que "sin estación" sea un solo valor en la columna y no
 * una mezcla de `''`, `'  '` y null.
 */
export function normalizeStation(raw: string | null | undefined): string | null {
    if (typeof raw !== "string") return null;
    const clean = raw.trim().replace(/\s+/g, " ");
    return clean.length > 0 ? clean : null;
}

/**
 * Clave de agrupado. Sin acentos, sin mayúsculas y sin espacios de más: quien
 * capturó "Cocina Fría" y quien capturó "cocina fria" están hablando de la
 * misma estación, y la hoja del manual es una tabla por estación, no dos.
 * La etiqueta que se muestra es la primera forma vista (ver `groupByStation`).
 */
export function stationKey(station: string | null | undefined): string {
    const normalized = normalizeStation(station);
    if (!normalized) return "";
    return normalized
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
}

/**
 * Estatus de la línea. `nowMinutes` son minutos del día en la zona de la
 * sucursal.
 *
 * Una línea SIN hora límite nunca se marca atrasada: no hay contra qué
 * compararla (mismo criterio que `deriveItemState` en el tablero de hoy). Y la
 * hora límite se pasa al minuto siguiente, no en el minuto exacto: a las 09:30
 * en punto, la línea de las 09:30 todavía está a tiempo.
 */
export function derivePrepLineState(
    orderStatus: string | null | undefined,
    deadlineMinutes: number | null,
    nowMinutes: number,
    warningMinutes: number = PREP_DEADLINE_WARNING_MINUTES,
): PrepLineState {
    if (orderStatus === "COMPLETED") return "HECHA";
    if (orderStatus === "CANCELLED") return "CANCELADA";
    if (deadlineMinutes === null) return "PENDIENTE";
    if (nowMinutes > deadlineMinutes) return "ATRASADA";
    if (nowMinutes >= deadlineMinutes - warningMinutes) return "POR_VENCER";
    return "PENDIENTE";
}

/** Orden de gravedad: lo que urge primero queda arriba, dentro de su estación. */
export const PREP_STATE_SEVERITY: Record<PrepLineState, number> = {
    ATRASADA: 0,
    POR_VENCER: 1,
    PENDIENTE: 2,
    HECHA: 3,
    CANCELADA: 4,
};

/** Lo mínimo que necesita el agrupado; el servicio manda filas más ricas. */
export interface PrepLineLike {
    station: string | null;
    /** "HH:MM" de la hora límite, o null si la línea no la lleva. */
    deadlineTime: string | null;
    state: PrepLineState;
}

export interface PrepStationGroup<T extends PrepLineLike> {
    /** Clave estable para React y para comparar grupos. */
    key: string;
    /** Etiqueta a mostrar: la primera forma capturada de esa estación. */
    label: string;
    lines: T[];
    /** Cuántas líneas de la estación siguen abiertas (ni hechas ni canceladas). */
    pending: number;
    /** Cuántas ya pasaron su hora límite. */
    overdue: number;
    /** Hechas sobre el total contable (excluye canceladas): el avance del turno. */
    done: number;
    total: number;
}

function isOpen(state: PrepLineState) {
    return state !== "HECHA" && state !== "CANCELADA";
}

/**
 * Agrupa las líneas de la hoja por estación. Dentro de cada estación ordena por
 * gravedad y luego por hora límite (las que no la llevan, al final): así la
 * primera fila que se ve es siempre la que ya se pasó de hora.
 *
 * Los grupos salen ordenados por urgencia (más atrasadas primero) y, a igualdad,
 * alfabéticamente. "Sin estación" siempre al final: es el cajón de lo que nadie
 * clasificó, no una estación real.
 */
export function groupByStation<T extends PrepLineLike>(lines: T[]): PrepStationGroup<T>[] {
    const groups = new Map<string, PrepStationGroup<T>>();

    for (const line of lines) {
        const key = stationKey(line.station);
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                label: normalizeStation(line.station) ?? PREP_STATION_UNASSIGNED_LABEL,
                lines: [],
                pending: 0,
                overdue: 0,
                done: 0,
                total: 0,
            };
            groups.set(key, group);
        }
        group.lines.push(line);
        if (line.state === "ATRASADA") group.overdue += 1;
        if (isOpen(line.state)) group.pending += 1;
        if (line.state === "HECHA") group.done += 1;
        if (line.state !== "CANCELADA") group.total += 1;
    }

    for (const group of groups.values()) {
        group.lines.sort((a, b) => {
            const bySeverity = PREP_STATE_SEVERITY[a.state] - PREP_STATE_SEVERITY[b.state];
            if (bySeverity !== 0) return bySeverity;
            const am = parseTimeOfDay(a.deadlineTime);
            const bm = parseTimeOfDay(b.deadlineTime);
            if (am === null && bm === null) return 0;
            if (am === null) return 1;
            if (bm === null) return -1;
            return am - bm;
        });
    }

    return [...groups.values()].sort((a, b) => {
        if ((a.key === "") !== (b.key === "")) return a.key === "" ? 1 : -1;
        if (a.overdue !== b.overdue) return b.overdue - a.overdue;
        if (a.pending !== b.pending) return b.pending - a.pending;
        return a.label.localeCompare(b.label, "es");
    });
}

/** Turnos del manual (§6.2). Reusa el enum `shift_type` que ya existe en la BD. */
export const PREP_SHIFT_LABELS: Record<string, string> = {
    MATUTINO: "Matutino",
    VESPERTINO: "Vespertino",
    NOCTURNO: "Nocturno",
    MIXTO: "Mixto",
};

export const PREP_STATE_LABELS: Record<PrepLineState, string> = {
    ATRASADA: "Atrasada",
    POR_VENCER: "Por vencer",
    PENDIENTE: "Pendiente",
    HECHA: "Hecha",
    CANCELADA: "Cancelada",
};

/**
 * Hora límite normalizada a "HH:MM" para guardar, o null. Acepta lo que manda
 * un `<input type="time">` ("09:30") y lo que devuelve una columna `time` de
 * Postgres ("09:30:00"). Devuelve `undefined` cuando el texto no es una hora:
 * así el llamador distingue "bórrala" (null) de "esto está mal" (undefined).
 */
export function normalizeDeadlineTime(raw: string | null | undefined): string | null | undefined {
    if (raw === null || raw === undefined || raw === "") return null;
    const minutes = parseTimeOfDay(raw);
    if (minutes === null) return undefined;
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
}
