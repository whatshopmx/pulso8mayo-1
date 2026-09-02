import { db } from '@/lib/db';
import { incidents, branches } from '@/lib/db/schema';
import { eq, inArray, and, gte } from 'drizzle-orm';
import { resueltoATiempo } from './incident-sla';

/**
 * Resumen de incidentes por sucursal para la vista consolidada.
 *
 * Una sola lectura de las filas de la ventana y el agregado se hace en memoria:
 * son cinco cifras por sucursal que dependen del SLA —que varía por severidad—
 * y repartir ese CASE entre SQL y TypeScript deja dos definiciones de "a
 * tiempo" que tarde o temprano se desincronizan
 * (`lib/services/incident-sla.ts` es la única).
 *
 * La ventana es de 60 días y no "todo el histórico" por dos razones: permite
 * comparar los últimos 30 contra los 30 previos sin una segunda consulta, y
 * acota lo que se trae a memoria en un grupo con muchas sucursales. Las cifras
 * que devuelve son, por tanto, de los últimos 60 días — la UI lo dice.
 */

export interface BranchIncidentStat {
    branchId: string;
    name: string;
    /** Incidentes de los últimos 60 días. */
    total: number;
    active: number;
    resolved: number;
    /** Cumplimiento 0–100: resueltos dentro de su ventana de SLA / total. */
    score: number;
    /** Incidentes en los últimos 30 días. */
    thisPeriod: number;
    /** Incidentes en los 30 días anteriores, para la tendencia. */
    lastPeriod: number;
}

const DIA_MS = 24 * 60 * 60 * 1000;

export async function getBranchIncidentStats(
    companyId: string,
    branchIds?: string[]
): Promise<BranchIncidentStat[]> {
    const sucursales = await db
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(eq(branches.companyId, companyId));

    const visibles = branchIds
        ? sucursales.filter((b) => branchIds.includes(b.id))
        : sucursales;

    if (visibles.length === 0) return [];

    const ahora = Date.now();
    const corte30 = new Date(ahora - 30 * DIA_MS);
    const corte60 = new Date(ahora - 60 * DIA_MS);

    const filas = await db
        .select({
            branchId: incidents.branchId,
            severity: incidents.severity,
            status: incidents.status,
            createdAt: incidents.createdAt,
            resolvedAt: incidents.resolvedAt,
        })
        .from(incidents)
        .where(
            and(
                inArray(incidents.branchId, visibles.map((b) => b.id)),
                gte(incidents.createdAt, corte60)
            )
        );

    return visibles.map((sucursal) => {
        const propias = filas.filter((f) => f.branchId === sucursal.id);
        const delPeriodo = propias.filter((f) => f.createdAt && f.createdAt >= corte30);
        const previas = propias.filter((f) => f.createdAt && f.createdAt < corte30);

        const aTiempo = propias.filter((f) =>
            resueltoATiempo(f.severity, f.createdAt, f.resolvedAt)
        );

        return {
            branchId: sucursal.id,
            name: sucursal.name,
            total: propias.length,
            active: propias.filter((f) => f.status !== 'RESOLVED').length,
            resolved: propias.filter((f) => f.status === 'RESOLVED').length,
            // Sin incidentes no hay nada que incumplir: 100 y no 0, que se
            // leería como la peor sucursal del grupo justo cuando es la mejor.
            score: propias.length === 0
                ? 100
                : Math.round((aTiempo.length / propias.length) * 100),
            thisPeriod: delPeriodo.length,
            lastPeriod: previas.length,
        };
    });
}
