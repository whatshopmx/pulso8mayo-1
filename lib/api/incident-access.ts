import { db } from '@/lib/db';
import { incidents, branches } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Carga un incidente comprobando que su sucursal pertenezca al tenant indicado.
 *
 * Devuelve null tanto si el incidente no existe como si es de otra empresa: los
 * incidentes no tienen companyId propio, así que la pertenencia se resuelve por
 * la sucursal, y desde fuera no debe poder distinguirse un id inexistente de
 * uno ajeno.
 */
export async function findIncidentForTenant(incidentId: string, tenantId: string) {
    const [row] = await db
        .select({ incident: incidents })
        .from(incidents)
        .innerJoin(branches, eq(branches.id, incidents.branchId))
        .where(and(
            eq(incidents.id, incidentId),
            eq(branches.companyId, tenantId)
        ))
        .limit(1);

    return row?.incident ?? null;
}
