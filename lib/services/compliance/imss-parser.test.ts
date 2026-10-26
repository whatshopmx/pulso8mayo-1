import { describe, expect, it } from 'vitest';
import { calculateSDI, validateCURP, validateNSS, validateRFC } from './imss-parser';
import { buildIdseFile, buildSuaFile, type ImssFileMovement } from './imss-parser';

const movement: ImssFileMovement = { userId: 'ana', nss: '12345678901', curp: 'LOPM850101HDFPRR09', rfc: 'LOPM850101AB1',
    name: 'Lopez Perez Ana', hireDate: '2026-10-01', effectiveDate: '2026-10-20', baseSalaryCents: 35000, sdiCents: 36726, movementType: 'ALTA' };
const options = { registroPatronal: 'A1234567890', fechaMovimiento: '2026-10-24' };
describe('T8 — formato único y determinista', () => {
    it.each([['ALTA', '08'], ['BAJA', '02'], ['MOD_SALARIO', '07']] as const)('golden IDSE %s', async (movementType, code) => {
        const result = await buildIdseFile([{ ...movement, movementType }], { ...options, layoutVersion: 'IDSE_2025_v1' });
        const detail = ['DT', '12345678901', 'LOPM850101HDFPRR09', 'LOPM850101AB1', 'LOPEZ'.padEnd(27), 'PEREZ'.padEnd(27),
            'ANA'.padEnd(27), '0036726', code, '20102026', '1', '1', movementType === 'BAJA' ? '20102026' : '00000000'].join('|');
        expect(result.content).toBe(`HD|A1234567890|00001|24102026|PULSO_SISTEMA\r\n${detail}\r\nTR|00001`);
        expect(result).toMatchObject({ lineCount: 1, layoutVersion: 'IDSE_2025_v1', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(await buildIdseFile([{ ...movement, movementType }], { ...options, layoutVersion: 'IDSE_2025_v1' })).toEqual(result);
    });
    it('golden SUA; centavos exactos y fecha civil', async () => {
        const result = await buildSuaFile([{ ...movement, movementType: 'MOD_SALARIO' }], { ...options, layoutVersion: 'SUA_AFIL_v1' });
        expect(result.content).toBe('12345678901003672620102026A1234567890' + 'LOPEZ'.padEnd(27) + 'PEREZ'.padEnd(27) + 'ANA'.padEnd(27) + '010101102026');
        expect(result.lineCount).toBe(1);
        expect(result.layoutVersion).toBe('SUA_AFIL_v1');
    });
    it.each([0, null, -1, 0.1, 10000000])('SDI inválido nunca se emite: %s', async sdiCents => {
        await expect(buildIdseFile([{ ...movement, sdiCents: sdiCents as number }], options)).rejects.toThrow('SDI');
    });
    it('rechaza fechas imposibles y versiones desconocidas', async () => {
        await expect(buildIdseFile([{ ...movement, effectiveDate: '2026-02-30' }], options)).rejects.toThrow('Fecha');
        await expect(buildIdseFile([movement], { ...options, layoutVersion: 'desconocido' })).rejects.toThrow('versión');
    });
});

/**
 * Task 4 (plan-imss, H6): el factor de integración se calcula, no se hardcodea.
 * El `1.0452` que vivía en `idse-generate`/`sua-generate` era pre-reforma LFT
 * 2023; con 12 días de vacaciones el factor correcto es 1.0493.
 */
describe('calculateSDI', () => {
    it('primer año: factor 1 + (15 + 12×0.25)/365 = 1.0493', () => {
        const factor = 1 + (15 + 12 * 0.25) / 365;
        expect(factor).toBeCloseTo(1.0493, 4);

        const sdi = calculateSDI(350, 0);
        expect(sdi).toBeCloseTo(350 * factor, 2);
        expect(sdi).toBe(367.26);
    });

    it('no usa el factor pre-reforma 1.0452', () => {
        expect(calculateSDI(1000, 0)).not.toBeCloseTo(1000 * 1.0452, 2);
    });

    it('a más años de servicio, más días de vacaciones y mayor factor', () => {
        const first = calculateSDI(1000, 0);
        const fifth = calculateSDI(1000, 5);
        const twentieth = calculateSDI(1000, 20);
        expect(fifth).toBeGreaterThan(first);
        expect(twentieth).toBeGreaterThan(fifth);
    });

    it('redondea a centavos', () => {
        const sdi = calculateSDI(333.33, 3);
        expect(Number.isInteger(Math.round(sdi * 100))).toBe(true);
        expect(sdi).toBe(Math.round(sdi * 100) / 100);
    });

    it('un salario de 0 produce 0 (señal para que el generador excluya al empleado)', () => {
        expect(calculateSDI(0, 0)).toBe(0);
    });
});

describe('validadores de identidad', () => {
    it('NSS exige 11 dígitos', () => {
        expect(validateNSS('12345678901')).toBe(true);
        expect(validateNSS('1234567890A')).toBe(false);
        expect(validateNSS('1234567890')).toBe(false);
    });

    it('RFC acepta 12 (moral) y 13 (física) caracteres', () => {
        expect(validateRFC('ABC120101AB1')).toBe(true);
        expect(validateRFC('HEGG560427MVZ')).toBe(true);
        expect(validateRFC('HEGG560427')).toBe(false);
    });

    it('CURP exige 18 caracteres con estructura válida', () => {
        expect(validateCURP('HEGG560427MVZRRL04')).toBe(true);
        expect(validateCURP('HEGG560427')).toBe(false);
    });
});
