/**
 * IMSS — resolución del salario de registro (centavos) para los movimientos.
 *
 * Regla transversal del módulo: **nunca inventar salario** (plan-imss,
 * decisión 5). Un SDI fabricado en un archivo oficial es peor que un archivo
 * que no se genera, así que los generadores leen el contrato VIGENTE y, si no
 * existe, excluyen al empleado con motivo explícito.
 *
 * `employeeContracts.baseSalary` está en CENTAVOS (integer). La conversión a
 * pesos ocurre solo en el borde del formato.
 */

import { db } from '@/lib/db';
import type { DbExecutor } from '@/lib/services/fefo-allocator';
import { employeeContracts } from '@/lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';

export interface CurrentContract {
    contractId: string;
    userId: string;
    /** Salario base DIARIO en centavos, tal como vive en la base. */
    baseSalaryCents: number;
    startDate: Date;
    endDate: Date | null;
}

/**
 * Contrato vigente por empleado: el de `startDate` más reciente que ya inició y
 * que no ha terminado (o es indefinido). Se resuelve en UNA consulta para no
 * caer en N+1 por empleado.
 */
export async function resolveCurrentContracts(
    companyId: string,
    userIds: string[],
    today: Date = new Date(),
    executor: DbExecutor = db,
): Promise<Map<string, CurrentContract>> {
    const result = new Map<string, CurrentContract>();
    if (userIds.length === 0) return result;

    const rows = await executor
        .select({
            id: employeeContracts.id,
            userId: employeeContracts.userId,
            baseSalary: employeeContracts.baseSalary,
            startDate: employeeContracts.startDate,
            endDate: employeeContracts.endDate,
        })
        .from(employeeContracts)
        .where(and(
            eq(employeeContracts.companyId, companyId),
            inArray(employeeContracts.userId, userIds),
        ))
        .orderBy(desc(employeeContracts.startDate));

    const todayMs = today.getTime();
    for (const row of rows) {
        if (result.has(row.userId)) continue;
        const start = new Date(row.startDate);
        const end = row.endDate ? new Date(row.endDate) : null;
        const isVigente = start.getTime() <= todayMs && (!end || end.getTime() >= todayMs);
        if (!isVigente) continue;
        result.set(row.userId, {
            contractId: row.id,
            userId: row.userId,
            baseSalaryCents: row.baseSalary,
            startDate: start,
            endDate: end,
        });
    }

    return result;
}

/** Años completos de servicio a la fecha (para el factor de integración). */
export function yearsOfService(hireDate: Date | string | null | undefined, today: Date = new Date()): number {
    if (!hireDate) return 0;
    const hire = hireDate instanceof Date ? hireDate : new Date(hireDate);
    if (Number.isNaN(hire.getTime())) return 0;

    let years = today.getUTCFullYear() - hire.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - hire.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < hire.getUTCDate())) {
        years--;
    }
    return Math.max(0, years);
}
