import { describe, expect, it } from 'vitest';
import { createBranchSchema, updateBranchSchema } from '@/lib/validations/branch';
import { requireSingleRegistroPatronal } from './imss-registro';

describe('registro patronal por sucursal', () => {
    it('captura y normaliza en creación y actualización; permite limpiar', () => {
        expect(createBranchSchema.parse({ name: 'Centro', imssRegistroPatronal: ' a1234567890 ' }).imssRegistroPatronal).toBe('A1234567890');
        expect(updateBranchSchema.parse({ imssRegistroPatronal: '' }).imssRegistroPatronal).toBeNull();
        expect(updateBranchSchema.parse({ imssRegistroPatronal: null }).imssRegistroPatronal).toBeNull();
        expect(updateBranchSchema.parse({ imssRegistroPatronal: '12345678901' }).imssRegistroPatronal).toBe('12345678901');
    });
    it.each(['UUID-inventado', 'A123', 'AB123456789', 'A123456789!', 'A12345678901'])('rechaza %s', (value) => {
        expect(updateBranchSchema.safeParse({ imssRegistroPatronal: value }).success).toBe(false);
    });
    it('exige registro de cada sucursal y no mezcla dos registros', () => {
        expect(() => requireSingleRegistroPatronal([{ branchId: 'b', branchName: 'Centro', registroPatronal: null }])).toThrow('Centro');
        expect(() => requireSingleRegistroPatronal([
            { branchId: 'a', branchName: 'Norte', registroPatronal: 'A1234567890' },
            { branchId: 'b', branchName: 'Sur', registroPatronal: 'B1234567890' },
        ])).toThrow('distintos');
        expect(requireSingleRegistroPatronal([{ branchId: 'a', branchName: 'Norte', registroPatronal: 'A1234567890' }])).toBe('A1234567890');
    });
});
