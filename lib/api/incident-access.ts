import { db } from '@/lib/db';
import { incidents, branches } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveBranchScope, type BranchScope } from '@/lib/branch-scope';
import type { Role } from '@/lib/permissions';

/**
 * Alcance de sucursal para una consulta de incidentes.
 *
 * GERENTE y SUPERVISOR quedan pinneados a su propia sucursal; el resto ve toda
 * la empresa. Sin sucursal asignada, `NONE`: no alcanzan ningún incidente.
 */
export function incidentBranchScope(
    role: Role,
    userBranchId: string | null | undefined
): BranchScope {
    return resolveBranchScope(role, userBranchId, null);
}

/**
 * Carga un incidente comprobando que su sucursal pertenezca al tenant indicado
 * —y, para los roles pinneados a sucursal, a su sucursal.
 *
 * Devuelve null tanto si el incidente no existe como si es de otra empresa o de
 * otra sucursal: los incidentes no tienen companyId propio, así que la
 * pertenencia se resuelve por la sucursal, y desde fuera no debe poder
 * distinguirse un id inexistente de uno ajeno.
 *
 * `branchScope` es opcional y por defecto `ALL`, así que un call site que no lo
 * pase se comporta como antes. Los que sí lo pasan cierran el hueco por el que
 * un GERENTE leía, editaba, remediaba y escalaba incidentes de cualquier
 * sucursal de su empresa.
 */
export async function findIncidentForTenant(
    incidentId: string,
    tenantId: string,
    branchScope: BranchScope = { kind: 'ALL' }
) {
    // Fail-closed: un rol de sucursal sin sucursal asignada no alcanza ninguno.
    if (branchScope.kind === 'NONE') return null;

    const conditions = [
        eq(incidents.id, incidentId),
        eq(branches.companyId, tenantId),
    ];

    if (branchScope.kind === 'BRANCH') {
        conditions.push(eq(incidents.branchId, branchScope.branchId));
    }

    const [row] = await db
        .select({ incident: incidents })
        .from(incidents)
        .innerJoin(branches, eq(branches.id, incidents.branchId))
        .where(and(...conditions))
        .limit(1);

    return row?.incident ?? null;
}
