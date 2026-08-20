import { db } from '@/lib/db';
import { remediationActions, branchComplianceServices } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { resolveBranchScope, type BranchScope } from '@/lib/branch-scope';
import type { Role } from '@/lib/permissions';

/**
 * Alcance de sucursal para una consulta de acciones de remediación.
 *
 * GERENTE y SUPERVISOR quedan pinneados a su propia sucursal; el resto de roles
 * ve toda la empresa. Un rol de sucursal SIN sucursal asignada devuelve `NONE`,
 * y quien consulta lo traduce a cero resultados: antes ese caso caía en el mismo
 * `null` que "sin filtro" y le abría el grupo entero.
 */
export function remediationBranchScope(
    role: Role,
    userBranchId: string | null | undefined
): BranchScope {
    return resolveBranchScope(role, userBranchId, null);
}

/**
 * Carga una acción de remediación comprobando que pertenezca al tenant —y, para
 * los roles pinneados a sucursal, a su sucursal.
 *
 * Devuelve null tanto si la acción no existe como si es de otra empresa o de
 * otra sucursal: espejo de `findIncidentForTenant` en `lib/api/incident-access.ts`.
 * Desde fuera no debe poder distinguirse un id inexistente de uno ajeno, así que
 * quien la llame responde 404 en ambos casos, nunca 403.
 */
export async function findRemediationActionForTenant(
    actionId: string,
    tenantId: string,
    branchScope: BranchScope = { kind: 'ALL' }
) {
    // Fail-closed: un rol de sucursal sin sucursal asignada no alcanza ninguna
    // acción. Devolver null aquí lo convierte en 404, como una acción ajena.
    if (branchScope.kind === 'NONE') return null;

    const conditions = [
        eq(remediationActions.id, actionId),
        eq(remediationActions.companyId, tenantId),
    ];

    if (branchScope.kind === 'BRANCH') {
        conditions.push(eq(remediationActions.branchId, branchScope.branchId));
    }

    const [action] = await db
        .select()
        .from(remediationActions)
        .where(and(...conditions))
        .limit(1);

    return action ?? null;
}

/**
 * Acciones de remediación de un incidente, con el nombre del proveedor resuelto
 * en la misma query.
 *
 * El aislamiento por tenant lo hace quien la llama cargando antes el incidente
 * con `findIncidentForTenant`: si el incidente es del tenant, sus acciones
 * también lo son.
 */
export async function listRemediationActionsForIncident(incidentId: string) {
    return db
        .select({
            id: remediationActions.id,
            incidentId: remediationActions.incidentId,
            serviceConfigId: remediationActions.serviceConfigId,
            branchId: remediationActions.branchId,
            actionType: remediationActions.actionType,
            serviceType: remediationActions.serviceType,
            workflowTemplateId: remediationActions.workflowTemplateId,
            status: remediationActions.status,
            confirmedBy: remediationActions.confirmedBy,
            confirmedAt: remediationActions.confirmedAt,
            scheduledDate: remediationActions.scheduledDate,
            scheduleId: remediationActions.scheduleId,
            workflowInstanceId: remediationActions.workflowInstanceId,
            completedAt: remediationActions.completedAt,
            result: remediationActions.result,
            createdAt: remediationActions.createdAt,
            serviceName: branchComplianceServices.serviceName,
        })
        .from(remediationActions)
        .leftJoin(
            branchComplianceServices,
            eq(remediationActions.serviceConfigId, branchComplianceServices.id)
        )
        .where(eq(remediationActions.incidentId, incidentId))
        .orderBy(desc(remediationActions.createdAt));
}

/**
 * Proveedor activo de la sucursal para un tipo de servicio.
 *
 * Es el cruce que hace contextual la recomendación (AD-4): sin proveedor
 * contratado, "confirmar visita" no le sirve a nadie y el bloqueo real es
 * configurar el proveedor.
 */
type ComplianceServiceType =
    (typeof branchComplianceServices.serviceType.enumValues)[number];

export async function findActiveProviderForBranch(branchId: string, serviceType: string) {
    const [provider] = await db
        .select({
            id: branchComplianceServices.id,
            serviceName: branchComplianceServices.serviceName,
            serviceType: branchComplianceServices.serviceType,
            providerName: branchComplianceServices.providerName,
        })
        .from(branchComplianceServices)
        .where(and(
            eq(branchComplianceServices.branchId, branchId),
            eq(branchComplianceServices.serviceType, serviceType as ComplianceServiceType),
            eq(branchComplianceServices.isActive, true)
        ))
        .limit(1);

    return provider ?? null;
}
