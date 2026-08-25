import { describe, expect, it } from 'vitest';

import {
    addCalendarDays,
    localDateString,
    localDayRangeUtc,
    localMoment,
} from '../today';

/**
 * Smoke test de Task 3: verifica que la suite corre y que las utilidades de
 * fecha responden. Los casos borde (23:50, DST Tijuana, día 31, 29-feb) se
 * cubren a fondo en `today.test.ts` (Task 5).
 */
describe('lib/workflows/today.ts (smoke)', () => {
    it('el proceso corre en TZ=UTC', () => {
        expect(process.env.TZ).toBe('UTC');
        expect(new Date().getTimezoneOffset()).toBe(0);
    });

    it('localDateString da el día local, no el UTC', () => {
        // 2026-03-10T23:30-06:00 → sigue siendo 10 en CDMX aunque UTC ya es 11.
        const at = new Date('2026-03-11T05:30:00Z');
        expect(localDateString(at, 'America/Mexico_City')).toBe('2026-03-10');
    });

    it('localMoment descompone la hora de pared', () => {
        const m = localMoment(new Date('2026-07-01T15:45:00Z'), 'America/Cancun'); // UTC−5 fijo
        expect(m).toMatchObject({ year: 2026, month: 7, day: 1, minutesOfDay: 10 * 60 + 45 });
    });

    it('addCalendarDays cruza meses sin mover un día', () => {
        expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
        expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
        expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('localDayRangeUtc devuelve [inicio, fin) coherentes', () => {
        const { start, end } = localDayRangeUtc(
            new Date('2026-06-15T20:00:00Z'),
            'America/Tijuana',
        );
        expect(end.getTime()).toBeGreaterThan(start.getTime());
        // El inicio debe ser medianoche local: su fecha formateada es el mismo día.
        expect(localDateString(start, 'America/Tijuana')).toBe(localDateString(new Date(start.getTime() + 3_600_000), 'America/Tijuana'));
    });
});
