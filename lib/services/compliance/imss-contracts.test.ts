import { describe, expect, it } from 'vitest';
import { yearsOfService } from './imss-contracts';

/** Años completos de servicio: base del factor de integración del SDI. */
describe('yearsOfService', () => {
    const today = new Date(Date.UTC(2026, 2, 15)); // 2026-03-15

    it('cuenta años completos cumplidos', () => {
        expect(yearsOfService(new Date(Date.UTC(2024, 0, 10)), today)).toBe(2);
    });

    it('no cuenta el año en curso si aún no llega el aniversario', () => {
        expect(yearsOfService(new Date(Date.UTC(2024, 5, 1)), today)).toBe(1);
    });

    it('el mismo día del aniversario ya cuenta el año', () => {
        expect(yearsOfService(new Date(Date.UTC(2024, 2, 15)), today)).toBe(2);
    });

    it('altas de este año → 0 años', () => {
        expect(yearsOfService(new Date(Date.UTC(2026, 1, 1)), today)).toBe(0);
    });

    it('sin fecha o con fecha inválida → 0 (contrato nuevo, factor del primer año)', () => {
        expect(yearsOfService(null, today)).toBe(0);
        expect(yearsOfService(undefined, today)).toBe(0);
        expect(yearsOfService('no-es-fecha', today)).toBe(0);
    });

    it('nunca devuelve negativo para fechas futuras', () => {
        expect(yearsOfService(new Date(Date.UTC(2027, 0, 1)), today)).toBe(0);
    });
});
