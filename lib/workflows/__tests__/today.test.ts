import { describe, expect, it } from 'vitest';

import {
    addCalendarDays,
    deriveItemState,
    isScheduleDueOn,
    localDateString,
    localDayRangeUtc,
    localMoment,
    normalizeShifts,
    parseTimeOfDay,
    startOfLocalDayUtc,
    STATE_SEVERITY,
    type RecurrenceConfig,
} from '../today';

/**
 * Suite de Task 5 (plan.md): fechas y zonas horarias de `lib/workflows/today.ts`.
 *
 * Motivo de existencia del módulo: `toISOString().slice(0, 10)` calcula "hoy"
 * en UTC y en UTC−6, después de las 6pm local, el tablero mostraba mañana.
 * Aquí se blindan los contratos por zona: Mexico_City (UTC−6 fijo, DST abolido
 * desde oct-2022), Cancún (UTC−5 fijo desde 2015) y Tijuana (sigue el DST de
 * EE. UU.: spring-forward dom 08-mar-2026, fall-back dom 01-nov-2026 —
 * offsets verificados con Intl, no de memoria).
 *
 * Todos los instantes de entrada son UTC explícitos (`...Z`) porque el proceso
 * corre con TZ=UTC forzada en vitest.config.ts; nunca dependemos de la zona
 * local de la máquina de CI.
 */

const HOUR_MS = 3_600_000;
const CDMX = 'America/Mexico_City';
const CANCUN = 'America/Cancun';
const TIJUANA = 'America/Tijuana';

/** LocalMoment del día local de un instante UTC (`YYYY-MM-DDTHH:MM:SSZ`). */
const dayOf = (isoUtc: string, timeZone: string) => localMoment(new Date(isoUtc), timeZone);

/** Programación activa con ventana amplia; cada caso sobrescribe lo que prueba. */
const schedule = (overrides: Partial<RecurrenceConfig> = {}): RecurrenceConfig => ({
    frequency: 'DAILY',
    startDate: '2024-01-01',
    isActive: true,
    ...overrides,
});

describe('localMoment', () => {
    it.each([
        // Offsets verificados con Intl: CDMX −6, Cancún −5, Tijuana −7/PDT.
        ['America/Mexico_City', '2026-06-15T20:00:00Z', { year: 2026, month: 6, day: 15, weekday: 1, minutesOfDay: 14 * 60 }],
        ['America/Cancun', '2026-06-15T20:00:00Z', { year: 2026, month: 6, day: 15, weekday: 1, minutesOfDay: 15 * 60 }],
        ['America/Tijuana', '2026-06-15T20:00:00Z', { year: 2026, month: 6, day: 15, weekday: 1, minutesOfDay: 13 * 60 }],
        // Invierno: Tijuana en PST (UTC−8), las zonas fijas no se mueven.
        ['America/Tijuana', '2026-01-15T20:00:00Z', { year: 2026, month: 1, day: 15, weekday: 4, minutesOfDay: 12 * 60 }],
        ['America/Mexico_City', '2026-01-15T20:00:00Z', { year: 2026, month: 1, day: 15, weekday: 4, minutesOfDay: 14 * 60 }],
    ])('descompone %s a la hora de pared (%s)', (timeZone, iso, expected) => {
        expect(localMoment(new Date(iso), timeZone)).toEqual(expected);
    });

    it('mapea weekday como Date.getDay(): domingo=0, sábado=6', () => {
        expect(dayOf('2026-06-14T20:00:00Z', CANCUN).weekday).toBe(0); // dom 14-jun-2026
        expect(dayOf('2026-06-13T20:00:00Z', CANCUN).weekday).toBe(6); // sáb 13-jun-2026
    });

    it('medianoche local da minutosOfDay correcta (Intl devuelve "24" y el módulo hace hour % 24)', () => {
        // 2026-03-11T06:07Z = 00:07 en CDMX: si el gotcha del "24" regresara,
        // minutesOfDay sería 24*60+7 en vez de 7.
        expect(dayOf('2026-03-11T06:07:00Z', CDMX)).toMatchObject({ day: 11, minutesOfDay: 7 });
    });

    it('cae a America/Mexico_City con huso inválido o vacío', () => {
        const expected = localDateString(new Date('2026-03-11T05:50:00Z'), CDMX);
        expect(localDateString(new Date('2026-03-11T05:50:00Z'), 'Mars/Phobos')).toBe(expected);
        expect(localDateString(new Date('2026-03-11T05:50:00Z'), '')).toBe(expected);
    });
});

describe('localDateString', () => {
    it('CASO ESTRELLA: captura 23:50 local cae en el día operativo correcto', () => {
        // 2026-03-11T05:50Z = 23:50 del 10-mar en CDMX. Con toISOString() esto
        // era "2026-03-11": la dueña que revisa el dinero a las 11pm veía sus
        // partidas saltar al día siguiente.
        expect(localDateString(new Date('2026-03-11T05:50:00Z'), CDMX)).toBe('2026-03-10');
    });

    it('formatea YYYY-MM-DD con ceros (mes y día < 10)', () => {
        // 2026-01-05T02:30Z = 20:30 del 4-ene en CDMX → "2026-01-04", no "2026-1-4".
        expect(localDateString(new Date('2026-01-05T02:30:00Z'), CDMX)).toBe('2026-01-04');
    });

    it('el mismo instante UTC puede ser fecha distinta según la sucursal', () => {
        // 2026-06-16T05:30Z = 00:30 en Cancún (día 16), 23:30 en CDMX y
        // 22:30 en Tijuana (ambos día 15): una cadena con las tres sucursales
        // cierra el día en momentos distintos del reloj del servidor.
        const at = new Date('2026-06-16T05:30:00Z');
        expect(localDateString(at, CANCUN)).toBe('2026-06-16');
        expect(localDateString(at, CDMX)).toBe('2026-06-15');
        expect(localDateString(at, TIJUANA)).toBe('2026-06-15');
    });
});

describe('startOfLocalDayUtc', () => {
    it.each([
        // Medianoche de pared convertida a instante UTC, una zona fija por fila
        // más Tijuana en ambos lados del DST.
        [CDMX, '2026-06-15T20:00:00Z', '2026-06-15T06:00:00.000Z'],
        [CANCUN, '2026-06-15T19:00:00Z', '2026-06-15T05:00:00.000Z'],
        [TIJUANA, '2026-06-15T18:30:00Z', '2026-06-15T07:00:00.000Z'], // PDT (verano)
        [TIJUANA, '2026-01-15T20:00:00Z', '2026-01-15T08:00:00.000Z'], // PST (invierno)
    ])('%s: medianoche local de %s es %s UTC', (timeZone, iso, expectedIso) => {
        expect(startOfLocalDayUtc(new Date(iso), timeZone).toISOString()).toBe(expectedIso);
    });

    it('REGRESIÓN: los segundos de `at` no mueven la medianoche', () => {
        // El redondeo anterior sesgaba +1 min cuando `at` traía ss ≥ 31: el
        // caller de app/api/workflows/history pasa `new Date()` (casi siempre
        // con segundos), así que la ventana "today" empezaba a las 00:01 local
        // y perdía las capturas del primer minuto del día.
        const clean = startOfLocalDayUtc(new Date('2026-06-15T20:00:00Z'), CDMX);
        for (const seconds of ['01', '29', '31', '37', '59']) {
            const dirty = startOfLocalDayUtc(new Date(`2026-06-15T20:00:${seconds}Z`), CDMX);
            expect(dirty.getTime(), `falló con segundos=:${seconds}`).toBe(clean.getTime());
        }
    });

    it('invariante: avanzar 1 h desde la medianoche sigue en el mismo día local', () => {
        // `at` con segundos y milisegundos a propósito (20:15:09.512Z).
        const start = startOfLocalDayUtc(new Date('2026-06-15T20:15:09.512Z'), CDMX);
        const oneHourLater = new Date(start.getTime() + HOUR_MS);
        expect(startOfLocalDayUtc(oneHourLater, CDMX).getTime()).toBe(start.getTime());
        expect(localDateString(oneHourLater, CDMX)).toBe(localDateString(start, CDMX));
    });

    it('DOCUMENTADO: en la hora exacta del spring-forward la medianoche se desvía 1 h', () => {
        // Dom 08-mar-2026, Tijuana adelanta 02:00→03:00 (a las 10:00Z). Para un
        // `at` YA adelantado (03:30 PDT) el módulo calcula la medianoche con el
        // offset post-cambio (−7h) y devuelve 07:00Z, que en pared son las
        // 23:00 del día anterior; la medianoche verdadera fue 08:00Z (PST).
        // Es la desviación que admite el propio docstring del módulo ("puede
        // irse una hora"): sólo afecta municipios frontera el día del cambio.
        expect(startOfLocalDayUtc(new Date('2026-03-08T10:30:00Z'), TIJUANA).toISOString())
            .toBe('2026-03-08T07:00:00.000Z');
    });
});

describe('addCalendarDays', () => {
    it.each([
        ['fin de mes normal', '2026-01-31', 1, '2026-02-01'],
        ['2026 NO es bisiesto: 28-feb va a 1-mar', '2026-02-28', 1, '2026-03-01'],
        ['2028 SÍ es bisiesto: 28-feb va a 29-feb', '2028-02-28', 1, '2028-02-29'],
        ['desde 29-feb bisiesto', '2028-02-29', 1, '2028-03-01'],
        ['año nuevo', '2026-12-31', 1, '2027-01-01'],
        ['negativo cruza hacia atrás', '2026-03-01', -1, '2026-02-28'],
        ['n=0 es identidad', '2026-06-15', 0, '2026-06-15'],
        ['366 días desde 29-feb-2028 (2028 bisiesto → 2029 no)', '2028-02-29', 366, '2029-03-01'],
    ])('%s', (_label, input, days, expected) => {
        expect(addCalendarDays(input, days)).toBe(expected);
    });

    it('aritmética anclada a mediodía UTC: cruzar muchos cambios de DST no mueve un día', () => {
        // Sumar n*86400000 ms sobre un instante y re-formatear SÍ puede moverse
        // un día; el ancla al mediodío deja 12 h de colchón a cada lado.
        expect(addCalendarDays('2026-03-07', 2)).toBe('2026-03-09'); // atraviesa el spring-forward de Tijuana
        expect(addCalendarDays('2026-10-31', 2)).toBe('2026-11-02'); // atraviesa el fall-back
    });
});

describe('localDayRangeUtc', () => {
    it('días normales: [inicio, fin) de exactamente 24 h en las tres zonas', () => {
        const cases: Array<[string, string]> = [
            [CDMX, '2026-06-15T20:00:37Z'], // con segundos: no debe afectar
            [CANCUN, '2026-06-15T18:00:00Z'],
            [TIJUANA, '2026-06-15T20:00:00Z'],
        ];
        for (const [timeZone, iso] of cases) {
            const at = new Date(iso);
            const { start, end } = localDayRangeUtc(at, timeZone);
            expect(end.getTime() - start.getTime(), timeZone).toBe(24 * HOUR_MS);
            expect(start.getTime(), timeZone).toBeLessThanOrEqual(at.getTime());
            expect(at.getTime(), timeZone).toBeLessThan(end.getTime());
            // El inicio representa el mismo día local que `at`.
            expect(localDateString(start, timeZone), timeZone).toBe(localDateString(at, timeZone));
        }
    });

    it('DOCUMENTADO: el día del spring-forward reporta 24 h corridas 1 h temprano (día real de 23 h)', () => {
        // Dom 08-mar-2026 Tijuana: el día local real dura 23 h (08:00Z→07:00Z
        // siguiente). El truco de +25 h del módulo absorbe el cambio y siempre
        // devuelve 24 h, pero corridas: empieza 1 h antes de la medianoche
        // verdadera. Congelamos el INVARIANTE (23–25 h, contiene coherencia),
        // no la ilusión de exactitud, porque es comportamiento declarado.
        const { start, end } = localDayRangeUtc(new Date('2026-03-08T10:30:00Z'), TIJUANA);
        const duration = end.getTime() - start.getTime();
        expect(duration).toBeGreaterThanOrEqual(23 * HOUR_MS);
        expect(duration).toBeLessThanOrEqual(25 * HOUR_MS);
    });

    it('DOCUMENTADO: el día del fall-back reporta 24 h (día real de 25 h)', () => {
        // Dom 01-nov-2026 Tijuana: la pared repite 01:00–02:00 (09:00Z es
        // ambigua: 08:30Z y 09:30Z son AMBAS 01:30 local). El día real dura 25
        // h (08:00Z→09:00Z siguiente) y el rango del módulo termina 1 h antes;
        // la última hora repetida queda fuera. Igual que arriba: invariante,
        // no exactitud.
        const { start, end } = localDayRangeUtc(new Date('2026-11-01T09:30:00Z'), TIJUANA);
        const duration = end.getTime() - start.getTime();
        expect(duration).toBeGreaterThanOrEqual(23 * HOUR_MS);
        expect(duration).toBeLessThanOrEqual(25 * HOUR_MS);
        expect(end.getTime()).toBeGreaterThan(start.getTime());
    });
});

describe('parseTimeOfDay', () => {
    it.each([
        ['hora:minuto estándar', '08:30', 510],
        ['sin cero inicial', '0:00', 0],
        ['último minuto del día', '23:59', 1439],
        ['recorta espacios', '  09:05  ', 545],
    ])('%s (%j → %i)', (_label, input, expected) => {
        expect(parseTimeOfDay(input)).toBe(expected);
    });

    it('"08:30:15" SÍ parsea: la regex tolera sufijo y se congela así', () => {
        // La regex ^(\d{1,2}):(\d{2}) no tiene ancla final, así que HH:MM:SS
        // entra tomando sólo hora y minuto. El editor puede enviar segundos,
        // así que este comportamiento es de facto contrato: si algún día se
        // quisiera rechazar, es un cambio consciente, no un accidente.
        expect(parseTimeOfDay('08:30:15')).toBe(510);
    });

    it.each([
        ['string vacío', ''],
        ['null', null],
        ['undefined', undefined],
        ['texto sin hora', 'abc'],
        ['minutos de 1 dígito', '7:5'],
        ['hora 24', '24:00'],
        ['minuto 60', '10:60'],
        ['sin dos puntos', '0830'],
        ['hora negativa', '-1:30'],
    ])('devuelve null con %s (%j)', (_label, input) => {
        expect(parseTimeOfDay(input)).toBeNull();
    });
});

describe('isScheduleDueOn', () => {
    // Días locales de referencia (Cancún, UTC−5 fijo):
    const domingo = dayOf('2026-06-14T20:00:00Z', CANCUN); // 14-jun-2026, 15:00 local
    const sabado = dayOf('2026-06-13T21:00:00Z', CANCUN); // 13-jun-2026
    const miercoles = dayOf('2026-06-17T20:00:00Z', CANCUN); // 17-jun-2026

    describe('ventana startDate/endDate', () => {
        it('isActive === false apaga TODO, incluso ONCE de hoy', () => {
            expect(isScheduleDueOn(schedule({ frequency: 'ONCE', startDate: '2026-06-14', isActive: false }), domingo, CANCUN))
                .toBe(false);
        });

        it('una programación que arranca HOY más tarde sí corre hoy (compara día local completo)', () => {
            // 2026-06-15T04:59Z = 23:59 local del 14-jun en Cancún: hoy aún no
            // arranca por hora, pero el día local coincide → vence.
            expect(isScheduleDueOn(schedule({ startDate: new Date('2026-06-15T04:59:00Z') }), domingo, CANCUN))
                .toBe(true);
        });

        it('startDate después del día bajo prueba → false', () => {
            // '2026-06-16' como string parsea a 00:00Z = 19:00 local del 15-jun
            // en Cancún: un día después del 14-jun aunque el string parezca
            // "ayer". La comparación es contra el día LOCAL, no el string.
            expect(isScheduleDueOn(schedule({ startDate: '2026-06-16' }), domingo, CANCUN)).toBe(false);
        });

        it('endDate que termina hoy 23:59 local → todavía vence hoy; el de ayer, no', () => {
            const endsTonight = schedule({ endDate: new Date('2026-06-15T04:59:00Z') }); // 23:59 local del 14
            const endedYesterday = schedule({ endDate: '2026-06-14' }); // local 13-jun en Cancún
            expect(isScheduleDueOn(endsTonight, domingo, CANCUN)).toBe(true);
            expect(isScheduleDueOn(endedYesterday, domingo, CANCUN)).toBe(false);
        });

        it('fechas inválidas (NaN) de la ventana se ignoran, no rompen', () => {
            expect(isScheduleDueOn(schedule({ startDate: new Date(NaN) }), domingo, CANCUN)).toBe(true);
            expect(isScheduleDueOn(schedule({ endDate: new Date(NaN) }), domingo, CANCUN)).toBe(true);
        });
    });

    describe('frecuencias', () => {
        it('DAILY vence cualquier día dentro de la ventana', () => {
            expect(isScheduleDueOn(schedule(), domingo, CANCUN)).toBe(true);
            expect(isScheduleDueOn(schedule(), miercoles, CANCUN)).toBe(true);
        });

        it.each([
            ["['domingo']", ['domingo']],
            ["['sunday'] inglés", ['sunday']],
            ["['DOMINGO'] mayúsculas", ['DOMINGO']],
            ['[0] numérico', [0]],
            ["['0'] string-numérico", ['0']],
        ])('WEEKLY %j vence el domingo y no el miércoles', (_label, daysOfWeek) => {
            const sched = schedule({ frequency: 'WEEKLY', daysOfWeek });
            expect(isScheduleDueOn(sched, domingo, CANCUN)).toBe(true);
            expect(isScheduleDueOn(sched, miercoles, CANCUN)).toBe(false);
        });

        it('WEEKLY respeta acentos: "miércoles" y "sábado"', () => {
            expect(isScheduleDueOn(schedule({ frequency: 'WEEKLY', daysOfWeek: ['miércoles'] }), miercoles, CANCUN))
                .toBe(true);
            expect(isScheduleDueOn(schedule({ frequency: 'WEEKLY', daysOfWeek: ['sábado'] }), sabado, CANCUN))
                .toBe(true);
        });

        it('WEEKLY con varios días configurados', () => {
            const sched = schedule({ frequency: 'WEEKLY', daysOfWeek: ['sabado', 'domingo'] }); // sin acento, como el editor
            expect(isScheduleDueOn(sched, sabado, CANCUN)).toBe(true);
            expect(isScheduleDueOn(sched, domingo, CANCUN)).toBe(true);
            expect(isScheduleDueOn(sched, miercoles, CANCUN)).toBe(false);
        });

        it('WEEKLY mezcla nombres y números', () => {
            const sched = schedule({ frequency: 'WEEKLY', daysOfWeek: ['lunes', 3] }); // 3 = miércoles
            expect(isScheduleDueOn(sched, miercoles, CANCUN)).toBe(true);
            expect(isScheduleDueOn(sched, domingo, CANCUN)).toBe(false);
        });

        it('WEEKLY: valores fuera de 0-6 se filtran y cae al escalar dayOfWeek ?? 1', () => {
            // [7] se descarta → array vacío → fallback: default 1 (lunes),
            // así que el domingo NO vence salvo que dayOfWeek diga otra cosa.
            const sched = schedule({ frequency: 'WEEKLY', daysOfWeek: [7] });
            expect(isScheduleDueOn(sched, domingo, CANCUN)).toBe(false);
            const sundayExplicit = schedule({ frequency: 'WEEKLY', daysOfWeek: [7], dayOfWeek: 0 });
            expect(isScheduleDueOn(sundayExplicit, domingo, CANCUN)).toBe(true);
        });

        it('WEEKLY: daysOfWeek vacío o no-array cae al escalar (default lunes)', () => {
            for (const daysOfWeek of [[], 'lunes', undefined]) {
                const sched = schedule({ frequency: 'WEEKLY', daysOfWeek });
                expect(isScheduleDueOn(sched, domingo, CANCUN), `daysOfWeek=${JSON.stringify(daysOfWeek)}`)
                    .toBe(false);
                expect(
                    isScheduleDueOn(sched, dayOf('2026-06-15T20:00:00Z', CANCUN), CANCUN), // lunes 15-jun
                    `daysOfWeek=${JSON.stringify(daysOfWeek)}`,
                ).toBe(true);
            }
        });

        it('MONTHLY: día 31 en mes de 30 días simplemente no vence (no hay "último día")', () => {
            const monthly31 = schedule({ frequency: 'MONTHLY', dayOfMonth: 31 });
            expect(isScheduleDueOn(monthly31, dayOf('2026-01-31T21:00:00Z', CANCUN), CANCUN)).toBe(true); // ene tiene 31
            expect(isScheduleDueOn(monthly31, dayOf('2026-06-30T21:00:00Z', CANCUN), CANCUN)).toBe(false); // jun tiene 30
            expect(isScheduleDueOn(monthly31, dayOf('2026-04-30T21:00:00Z', CANCUN), CANCUN)).toBe(false); // abr tiene 30
        });

        it('MONTHLY: sin dayOfMonth asume día 1', () => {
            const firstOfMonth = schedule({ frequency: 'MONTHLY' });
            expect(isScheduleDueOn(firstOfMonth, dayOf('2026-06-01T21:00:00Z', CANCUN), CANCUN)).toBe(true);
            expect(isScheduleDueOn(firstOfMonth, dayOf('2026-06-30T21:00:00Z', CANCUN), CANCUN)).toBe(false);
        });

        it.each([
            ['29-feb existe en 2028 (bisiesto)', '2028-02-29T18:00:00Z', true],
            ['29-feb no existe en 2026 → 28-feb no vence', '2026-02-28T18:00:00Z', false],
        ])('MONTHLY dayOfMonth=29: %s', (_label, iso, expected) => {
            const sched = schedule({ frequency: 'MONTHLY', dayOfMonth: 29 });
            expect(isScheduleDueOn(sched, dayOf(iso, CANCUN), CANCUN)).toBe(expected);
        });

        it('ONCE vence sólo el día local del startDate, ignorando la hora', () => {
            const once = schedule({ frequency: 'ONCE', startDate: new Date('2026-06-15T04:59:00Z') }); // 23:59 local del 14
            expect(isScheduleDueOn(once, domingo, CANCUN)).toBe(true);
            expect(isScheduleDueOn(once, sabado, CANCUN)).toBe(false);
            expect(isScheduleDueOn(once, miercoles, CANCUN)).toBe(false);
        });

        it('ONCE con startDate inválido → false', () => {
            expect(isScheduleDueOn(schedule({ frequency: 'ONCE', startDate: new Date(NaN) }), domingo, CANCUN))
                .toBe(false);
        });

        it.each([
            ["frecuencia inventada 'WEEKDAYS'", 'WEEKDAYS'],
            ['frecuencia vacía', ''],
        ])('%s → false (default cerrado)', (_label, frequency) => {
            expect(isScheduleDueOn(schedule({ frequency }), domingo, CANCUN)).toBe(false);
        });
    });
});

describe('deriveItemState', () => {
    // Matriz completa del tablero "Hoy". El operador es `>` ESTRICTO:
    // nowMinutes === dueMinutes NO vence (el empleado llegó justo).
    it.each([
        ['COMPLETED', null, 661, 'HECHO'],
        ['COMPLETED', 600, 540, 'HECHO'], // terminado a tiempo también es HECHO
        ['IN_PROGRESS', 600, 540, 'EN_CURSO'],
        ['IN_PROGRESS', 600, 600, 'EN_CURSO'], // EMPATE no vence
        ['IN_PROGRESS', 600, 661, 'VENCIDO'],
        ['PENDING', 600, 661, 'VENCIDO'],
        ['PENDING', 600, 600, 'PENDIENTE'], // empate tampoco vence a los pendientes
        ['PENDING', null, 661, 'PENDIENTE'], // sin hora nunca vence
        [null, 600, 661, 'VENCIDO'],
        [undefined, null, 1439, 'PENDIENTE'],
    ])('%j + due=%j @ %j min → %s', (status, dueMinutes, nowMinutes, expected) => {
        expect(deriveItemState(status, dueMinutes, nowMinutes)).toBe(expected);
    });

    it('STATE_SEVERITY ordena de más urgente a menos: VENCIDO < EN_CURSO < PENDIENTE < HECHO', () => {
        expect(STATE_SEVERITY.VENCIDO).toBeLessThan(STATE_SEVERITY.EN_CURSO);
        expect(STATE_SEVERITY.EN_CURSO).toBeLessThan(STATE_SEVERITY.PENDIENTE);
        expect(STATE_SEVERITY.PENDIENTE).toBeLessThan(STATE_SEVERITY.HECHO);
    });
});

describe('normalizeShifts', () => {
    it('hace trim y filtra vacíos, espacios y no-strings', () => {
        expect(normalizeShifts([' matutino ', '', '   ', 'vespertino', 42, null, ['x']]))
            .toEqual(['matutino', 'vespertino']);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['string suelto (no array)', 'matutino'],
        ['objeto', {}],
        ['array vacío', []],
    ])('entrada no útil (%s) → []', (_label, input) => {
        expect(normalizeShifts(input)).toEqual([]);
    });
});
