import { describe, expect, it } from 'vitest';
import { getImssBimester, validateImssMovementPeriod } from './imss-period';

describe('período bimestral de trabajo SUA', () => {
    it('resuelve el bimestre civil en México y contempla diciembre/enero', () => {
        expect(getImssBimester(undefined, new Date('2026-11-01T02:00:00Z'))).toEqual({ key: '2026-09', start: '2026-09-01', end: '2026-10-31' });
        expect(getImssBimester('2026-11')).toEqual({ key: '2026-11', start: '2026-11-01', end: '2026-12-31' });
        expect(getImssBimester('2024-01').end).toBe('2024-02-29');
    });
    it('valida los extremos y permite bimestres anteriores para correcciones', () => {
        expect(() => validateImssMovementPeriod('2026-09-01', '2026-09')).not.toThrow();
        expect(() => validateImssMovementPeriod('2026-10-31', '2026-09')).not.toThrow();
        expect(() => validateImssMovementPeriod('2025-01-15', '2025-01')).not.toThrow();
        expect(() => validateImssMovementPeriod('2026-11-01', '2026-09')).toThrow('bimestre');
    });
    it.each(['2026-02', '2026-13', 'texto'])('rechaza un inicio de bimestre inválido: %s', key => {
        expect(() => getImssBimester(key)).toThrow();
    });
    it('rechaza fechas imposibles aunque estén dentro del período', () => {
        expect(() => validateImssMovementPeriod('2026-02-30', '2026-01')).toThrow('Fecha');
    });
});
