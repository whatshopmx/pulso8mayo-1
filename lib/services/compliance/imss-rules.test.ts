import { describe, expect, it } from 'vitest';
import {
    IMSS_MOVEMENT_DEADLINE_BUSINESS_DAYS,
    businessDaysBetween,
    resolveAltaState,
    resolveBajaState,
    todayInMx,
    toCivilDate,
} from './imss-rules';

/**
 * Fechas civiles UTC usadas como referencia (todas verificadas por día de semana):
 * 2026-03-02 lun · 03-06 vie · 03-09 lun · 03-13 vie
 */
const MON = (day: number) => new Date(Date.UTC(2026, 2, day));
const HIRE_MONDAY = MON(2);

const IDENTITY = {
    nss: '12345678901',
    curp: 'HEGG560427MVZRRL04',
    rfc: 'HEGG560427MVZ', // 13 caracteres: persona física
};

describe('businessDaysBetween', () => {
    it('viernes → lunes cuenta 1 día hábil', () => {
        expect(businessDaysBetween(MON(6), MON(9))).toBe(1);
    });

    it('no cuenta sábados ni domingos', () => {
        // lun 2 → lun 9 = mar,mié,jue,vie,lun = 5
        expect(businessDaysBetween(HIRE_MONDAY, MON(9))).toBe(5);
    });

    it('mismo día = 0', () => {
        expect(businessDaysBetween(HIRE_MONDAY, HIRE_MONDAY)).toBe(0);
    });

    it('fechas futuras devuelven negativo', () => {
        expect(businessDaysBetween(MON(9), HIRE_MONDAY)).toBe(-5);
    });

    it('ignora la hora del timestamp', () => {
        const withTime = new Date(Date.UTC(2026, 2, 2, 23, 59, 59));
        const end = new Date(Date.UTC(2026, 2, 3, 0, 0, 1));
        expect(businessDaysBetween(withTime, end)).toBe(1);
    });
});

describe('toCivilDate / todayInMx', () => {
    it('normaliza ISO y Date a fecha civil', () => {
        expect(toCivilDate('2026-03-02T18:30:00.000Z')?.toISOString()).toBe('2026-03-02T00:00:00.000Z');
        expect(toCivilDate(HIRE_MONDAY)?.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    });

    it('devuelve null para valores inválidos', () => {
        expect(toCivilDate(null)).toBeNull();
        expect(toCivilDate('')).toBeNull();
        expect(toCivilDate('no-es-fecha')).toBeNull();
    });

    it('hoy en México usa la fecha civil de CDMX, no la del servidor', () => {
        // 2026-03-03T02:00:00Z = 2026-03-02 20:00 en CDMX (UTC-6) → día 2
        const today = todayInMx(new Date('2026-03-03T02:00:00.000Z'));
        expect(today.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    });
});

describe('resolveAltaState', () => {
    it('RFC de 13 caracteres + NSS + CURP → LISTO en el día 3 (H1)', () => {
        const result = resolveAltaState({ ...IDENTITY, hireDate: HIRE_MONDAY }, MON(5));
        expect(result.state).toBe('LISTO');
        expect(result.missing).toEqual([]);
        expect(result.daysElapsed).toBe(3);
        expect(result.overdue).toBe(false);
    });

    it('acepta también RFC de 12 caracteres (persona moral)', () => {
        const result = resolveAltaState(
            { ...IDENTITY, rfc: 'ABC120101AB1', hireDate: HIRE_MONDAY },
            MON(5),
        );
        expect(result.state).toBe('LISTO');
        expect(result.missing).not.toContain('SIN_RFC');
    });

    it('vencido ≠ no listo: en el día 9 sigue LISTO y overdue=true (H2)', () => {
        const result = resolveAltaState({ ...IDENTITY, hireDate: HIRE_MONDAY }, MON(13));
        expect(result.daysElapsed).toBe(9);
        expect(result.state).toBe('LISTO');
        expect(result.overdue).toBe(true);
    });

    it('el plazo vence al pasar el 5º día hábil', () => {
        // lun 2 + 5 días hábiles = lun 9 (mar,mié,jue,vie,lun)
        const onDeadline = resolveAltaState({ ...IDENTITY, hireDate: HIRE_MONDAY }, MON(9));
        expect(onDeadline.daysElapsed).toBe(IMSS_MOVEMENT_DEADLINE_BUSINESS_DAYS);
        expect(onDeadline.overdue).toBe(false);

        const afterDeadline = resolveAltaState({ ...IDENTITY, hireDate: HIRE_MONDAY }, MON(10));
        expect(afterDeadline.daysElapsed).toBe(6);
        expect(afterDeadline.overdue).toBe(true);
    });

    it('un acuse confirmado gana sobre el plazo (REGISTRADO, no vencido)', () => {
        const result = resolveAltaState(
            { ...IDENTITY, hireDate: HIRE_MONDAY },
            MON(13),
            { registered: true },
        );
        expect(result.state).toBe('REGISTRADO');
        expect(result.overdue).toBe(false);
    });

    it('NSS con letras bloquea con motivo explícito', () => {
        const result = resolveAltaState(
            { ...IDENTITY, nss: '1234567890A', hireDate: HIRE_MONDAY },
            MON(5),
        );
        expect(result.state).toBe('SIN_DATOS');
        expect(result.missing).toContain('SIN_NSS');
    });

    it('identidad ausente reporta todos los motivos', () => {
        const result = resolveAltaState({ hireDate: HIRE_MONDAY }, MON(5));
        expect(result.state).toBe('SIN_DATOS');
        expect(result.missing).toEqual(['SIN_NSS', 'SIN_CURP', 'SIN_RFC']);
    });

    it('sin fecha de alta el movimiento es SIN_DATOS y no se marca vencido', () => {
        const result = resolveAltaState({ ...IDENTITY }, MON(5));
        expect(result.state).toBe('SIN_DATOS');
        expect(result.missing).toContain('SIN_FECHA_ALTA');
        expect(result.overdue).toBe(false);
        expect(result.daysElapsed).toBe(0);
    });

    it('fecha de alta futura no cuenta días transcurridos ni vence', () => {
        const result = resolveAltaState({ ...IDENTITY, hireDate: MON(20) }, MON(5));
        expect(result.daysElapsed).toBe(0);
        expect(result.overdue).toBe(false);
        expect(result.state).toBe('LISTO');
    });

    it('con requireBaseSalary, sin contrato queda SIN_SALARIO_BASE', () => {
        const result = resolveAltaState(
            { ...IDENTITY, hireDate: HIRE_MONDAY, baseSalaryCents: 0 },
            MON(5),
            { requireBaseSalary: true },
        );
        expect(result.state).toBe('SIN_DATOS');
        expect(result.missing).toContain('SIN_SALARIO_BASE');
    });

    it('con requireBaseSalary y salario real la alta está lista', () => {
        const result = resolveAltaState(
            { ...IDENTITY, hireDate: HIRE_MONDAY, baseSalaryCents: 35000 },
            MON(5),
            { requireBaseSalary: true },
        );
        expect(result.state).toBe('LISTO');
        expect(result.missing).toEqual([]);
    });
});

describe('resolveBajaState', () => {
    const TERMINATED_MONDAY = MON(2);

    it('con NSS y fecha de baja está LISTO y a tiempo el día 3', () => {
        const result = resolveBajaState({ nss: IDENTITY.nss, terminationDate: TERMINATED_MONDAY }, MON(5));
        expect(result.state).toBe('LISTO');
        expect(result.overdue).toBe(false);
        expect(result.daysElapsed).toBe(3);
    });

    it('el día 9 sigue LISTO pero vencido', () => {
        const result = resolveBajaState({ nss: IDENTITY.nss, terminationDate: TERMINATED_MONDAY }, MON(13));
        expect(result.state).toBe('LISTO');
        expect(result.overdue).toBe(true);
    });

    it('sin NSS no se puede armar la baja', () => {
        const result = resolveBajaState({ terminationDate: TERMINATED_MONDAY }, MON(5));
        expect(result.state).toBe('SIN_DATOS');
        expect(result.missing).toContain('SIN_NSS');
    });

    it('sin fecha de baja no se puede armar la baja', () => {
        const result = resolveBajaState({ nss: IDENTITY.nss }, MON(5));
        expect(result.state).toBe('SIN_DATOS');
        expect(result.missing).toContain('SIN_FECHA_BAJA');
    });

    it('la baja confirmada queda REGISTRADA', () => {
        const result = resolveBajaState(
            { nss: IDENTITY.nss, terminationDate: TERMINATED_MONDAY },
            MON(13),
            { registered: true },
        );
        expect(result.state).toBe('REGISTRADO');
        expect(result.overdue).toBe(false);
    });
});
