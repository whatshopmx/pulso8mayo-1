import type { NextRequest } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-auth';
import { ApiError } from '@/lib/api/error';
import { ApiHandler } from '@/lib/api/response';
import { findIncidentForTenant, incidentBranchScope } from '@/lib/api/incident-access';
import {
    listRemediationActionsForIncident,
    findActiveProviderForBranch,
} from '@/lib/api/remediation-access';
import {
    resolveRecommendedAction,
    getRequiredServiceType,
} from '@/lib/services/incident-recommendation';

/**
 * GET /api/incidents/[id]/actions
 *
 * Acciones de remediación del incidente + la acción recomendada por el resolver.
 *
 * Un incidente de otra empresa da 404, indistinguible de uno inexistente
 * (`findIncidentForTenant`).
 */
export const GET = withTenantAuth(async (
    _request: NextRequest,
    { params, auth }
) => {
    const { id } = await (params as unknown as Promise<{ id: string }>);

    const incident = await findIncidentForTenant(id, auth.tenantId, incidentBranchScope(auth.user.role, auth.branchId));
    if (!incident) {
        throw ApiError.notFound('Incidente no encontrado');
    }

    const actions = await listRemediationActionsForIncident(incident.id);

    // El proveedor solo se consulta si el paso en curso pide servicio externo:
    // una query extra como mucho, nunca una por acción.
    const requiredServiceType = getRequiredServiceType(incident);
    const activeProvider =
        requiredServiceType && incident.branchId
            ? await findActiveProviderForBranch(incident.branchId, requiredServiceType)
            : null;

    const recommended = resolveRecommendedAction({
        incident,
        actions,
        activeProvider,
    });

    return ApiHandler.success({ actions, recommended });
});
