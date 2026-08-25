/**
 * "Hoy" en la zona horaria de la sucursal.
 *
 * Una cadena con sucursales en Cancún y Tijuana abarca dos husos: si el día se
 * calcula con el reloj del servidor, el tablero muestra el día equivocado en al
 * menos una de ellas. Todo lo de aquí parte de `branches.timezone`.
 *
 * Usamos Intl nativo: date-fns v4 sólo maneja husos con @date-fns/tz, que no
 * está instalado.
 */

export type ScheduleFrequency = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | string;

/** Nombres que puede traer `days_of_week` (jsonb) en la configuración del editor. */
const WEEKDAY_NAMES: Record<string, number> = {
    sunday: 0, domingo: 0,
    monday: 1, lunes: 1,
    tuesday: 2, martes: 2,
    wednesday: 3, miercoles: 3, miércoles: 3,
    thursday: 4, jueves: 4,
    friday: 5, viernes: 5,
    saturday: 6, sabado: 6, sábado: 6,
};

export interface LocalMoment {
    /** Año, mes (1-12) y día del calendario local. */
    year: number;
    month: number;
    day: number;
    /** 0 = domingo, como Date.getDay(). */
    weekday: number;
    /** Minutos transcurridos del día local, para comparar contra timeOfDay. */
    minutesOfDay: number;
}

const partsFormatter = (timeZone: string) =>
    new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    });

const WEEKDAY_SHORT: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Cae a America/Mexico_City si la sucursal trae un huso inválido. */
function safeTimeZone(timeZone: string | null | undefined): string {
    const tz = timeZone || 'America/Mexico_City';
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return tz;
    } catch {
        return 'America/Mexico_City';
    }
}

/** Descompone un instante en la hora de pared de la sucursal. */
export function localMoment(at: Date, timeZone: string | null | undefined): LocalMoment {
    const parts = partsFormatter(safeTimeZone(timeZone)).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

    // Intl da "24" en lugar de "00" para la medianoche con hour12:false.
    const hour = Number(get('hour')) % 24;

    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        weekday: WEEKDAY_SHORT[get('weekday')] ?? 0,
        minutesOfDay: hour * 60 + Number(get('minute')),
    };
}

/**
 * Instante UTC en el que empieza el día local de la sucursal.
 *
 * Calcula el desfase del huso en ese momento y lo resta a la medianoche de
 * pared. En la hora exacta de un cambio de horario el resultado puede irse una
 * hora; en México sólo aplica a los municipios frontera, que sí siguen el DST
 * de EE. UU.
 */
export function startOfLocalDayUtc(at: Date, timeZone: string | null | undefined): Date {
    const m = localMoment(at, timeZone);
    const wallAsUtc = Date.UTC(m.year, m.month - 1, m.day, Math.floor(m.minutesOfDay / 60), m.minutesOfDay % 60);
    // La hora de pared sólo llega al minuto; recortamos `at` al minuto para
    // que sus segundos y milisegundos no sesguen el desfase y muevan la
    // medianoche. Ambos operandos quedan en minutos exactos: sin redondeo.
    const atToTheMinute = Math.floor(at.getTime() / 60_000) * 60_000;
    return new Date(Date.UTC(m.year, m.month - 1, m.day) - (wallAsUtc - atToTheMinute));
}

/**
 * `YYYY-MM-DD` del día local de la sucursal.
 *
 * Es el reemplazo de `toISOString().slice(0, 10)`, que calcula en UTC: en UTC-6,
 * después de las 6pm local —la hora a la que una dueña revisa el dinero— "hoy"
 * se volvía mañana y las partidas saltaban entre "vencido" y "próximo".
 */
export function localDateString(at: Date, timeZone: string | null | undefined): string {
    const m = localMoment(at, timeZone);
    return `${m.year}-${String(m.month).padStart(2, '0')}-${String(m.day).padStart(2, '0')}`;
}

/**
 * Suma días de calendario a un `YYYY-MM-DD` y devuelve otro `YYYY-MM-DD`.
 *
 * Aritmética de calendario pura, sin husos de por medio: se ancla al mediodía
 * UTC para que ningún cambio de horario pueda mover el resultado un día. Sumar
 * `n * 86400000` milisegundos a un instante y volver a formatear sí puede.
 */
export function addCalendarDays(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Rango [inicio, fin) del día local de la sucursal, en instantes UTC. */
export function localDayRangeUtc(at: Date, timeZone: string | null | undefined) {
    const start = startOfLocalDayUtc(at, timeZone);
    // +25h y volver a alinear absorbe cualquier cambio de horario intermedio.
    const end = startOfLocalDayUtc(new Date(start.getTime() + 25 * 60 * 60 * 1000), timeZone);
    return { start, end: end.getTime() > start.getTime() ? end : new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Convierte "HH:MM" a minutos del día. null si no hay hora configurada. */
export function parseTimeOfDay(timeOfDay: string | null | undefined): number | null {
    if (!timeOfDay) return null;
    const match = /^(\d{1,2}):(\d{2})/.exec(timeOfDay.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function normalizeWeekdays(daysOfWeek: unknown): number[] {
    if (!Array.isArray(daysOfWeek)) return [];
    return daysOfWeek
        .map((day) => {
            if (typeof day === 'number') return day;
            if (typeof day === 'string') {
                const named = WEEKDAY_NAMES[day.trim().toLowerCase()];
                if (named !== undefined) return named;
                const numeric = Number(day);
                return Number.isInteger(numeric) ? numeric : null;
            }
            return null;
        })
        .filter((day): day is number => day !== null && day >= 0 && day <= 6);
}

export interface RecurrenceConfig {
    frequency: ScheduleFrequency;
    dayOfWeek?: number | null;
    daysOfWeek?: unknown;
    dayOfMonth?: number | null;
    startDate: Date | string;
    endDate?: Date | string | null;
    isActive?: boolean | null;
}

/**
 * ¿Esta programación tocaba correr en el día local dado?
 *
 * Es un cálculo real de recurrencia, no "cualquier programación activa":
 * respeta frecuencia, días configurados y la ventana startDate/endDate.
 */
export function isScheduleDueOn(schedule: RecurrenceConfig, day: LocalMoment, timeZone: string | null | undefined): boolean {
    if (schedule.isActive === false) return false;

    // La ventana se compara contra el final del día local, para no descartar una
    // programación que arranca hoy más tarde.
    const dayStart = Date.UTC(day.year, day.month - 1, day.day);
    const start = new Date(schedule.startDate);
    if (!Number.isNaN(start.getTime())) {
        const startLocal = localMoment(start, timeZone);
        if (Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day) > dayStart) return false;
    }
    if (schedule.endDate) {
        const end = new Date(schedule.endDate);
        if (!Number.isNaN(end.getTime())) {
            const endLocal = localMoment(end, timeZone);
            if (Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day) < dayStart) return false;
        }
    }

    switch (schedule.frequency) {
        case 'DAILY':
            return true;

        case 'WEEKLY': {
            const configured = normalizeWeekdays(schedule.daysOfWeek);
            if (configured.length > 0) return configured.includes(day.weekday);
            // daysOfWeek vacío: caemos a la columna escalar que lee el cron.
            return (schedule.dayOfWeek ?? 1) === day.weekday;
        }

        case 'MONTHLY':
            return (schedule.dayOfMonth ?? 1) === day.day;

        case 'ONCE': {
            const once = new Date(schedule.startDate);
            if (Number.isNaN(once.getTime())) return false;
            const onceLocal = localMoment(once, timeZone);
            return onceLocal.year === day.year && onceLocal.month === day.month && onceLocal.day === day.day;
        }

        default:
            return false;
    }
}

export type TodayItemState = 'HECHO' | 'EN_CURSO' | 'VENCIDO' | 'PENDIENTE';

/**
 * Estado de un pendiente del día. `VENCIDO` sólo cuando ya pasó su hora y no
 * está terminado: sin hora configurada nunca se marca vencido, porque no hay
 * contra qué compararlo.
 */
export function deriveItemState(
    instanceStatus: string | null | undefined,
    dueMinutes: number | null,
    nowMinutes: number,
): TodayItemState {
    if (instanceStatus === 'COMPLETED') return 'HECHO';
    if (instanceStatus === 'IN_PROGRESS') {
        return dueMinutes !== null && nowMinutes > dueMinutes ? 'VENCIDO' : 'EN_CURSO';
    }
    if (dueMinutes !== null && nowMinutes > dueMinutes) return 'VENCIDO';
    return 'PENDIENTE';
}

/** Orden de gravedad: lo que urge primero, tanto en filas como en sucursales. */
export const STATE_SEVERITY: Record<TodayItemState, number> = {
    VENCIDO: 0,
    EN_CURSO: 1,
    PENDIENTE: 2,
    HECHO: 3,
};

/** Turno declarado en `assigned_shifts`; vacío = una banda sin nombre. */
export function normalizeShifts(assignedShifts: unknown): string[] {
    if (!Array.isArray(assignedShifts)) return [];
    return assignedShifts
        .map((shift) => (typeof shift === 'string' ? shift.trim() : ''))
        .filter((shift) => shift.length > 0);
}
