import { ApiError } from '@/lib/api/error';

/** SIDEIMSS: primera posición alfanumérica, diez numéricas; no verifica asignación.
 * https://www.imss.gob.mx/sites/all/statics/pdf/formatos/EstrucMovAfil.pdf
 */
export function isRegistroPatronal(value: string | null | undefined): value is string {
    return typeof value === 'string' && /^[A-Z0-9][0-9]{10}$/.test(value);
}

export function requireSingleRegistroPatronal(rows: Array<{
    branchId: string | null; branchName: string | null; registroPatronal: string | null;
}>): string {
    if (!rows.length) throw ApiError.badRequest('Selecciona empleados de una sucursal con registro patronal');
    const missing = rows.filter(row => !isRegistroPatronal(row.registroPatronal));
    if (missing.length) {
        const names = [...new Set(missing.map(row => row.branchName || 'Sin sucursal'))];
        const branches = [...new Map(missing.map(row => [row.branchId, {
            branchId: row.branchId, branchName: row.branchName,
        }])).values()];
        throw ApiError.badRequest(`Captura el registro patronal IMSS en: ${names.join(', ')}`, { branches });
    }
    const registros = new Set(rows.map(row => row.registroPatronal));
    if (registros.size !== 1) throw ApiError.badRequest('La selección mezcla registros patronales distintos; genera un archivo por registro');
    return rows[0].registroPatronal!;
}
