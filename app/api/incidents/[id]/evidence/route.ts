import { NextRequest, NextResponse } from 'next/server';
import { withTenantAuth } from '@/lib/api/with-auth';
import { findIncidentForTenant, incidentBranchScope } from '@/lib/api/incident-access';

interface EvidenceItem {
    stepIndex: number | null;
    type: 'photo' | 'text';
    content: string;
    passed: boolean | null;
    aiReason: string | null;
    aiConfidence: number | null;
    submittedBy: string | null;
    createdAt: string;
    /** De dónde salió: la foto original del incidente o un intento de remediación. */
    source: 'detection' | 'remediation';
}

/**
 * GET /api/incidents/[id]/evidence
 *
 * Historial de evidencia del incidente: la foto con la que se detectó más cada
 * intento de remediación registrado en `metadata.evidenceHistory`.
 *
 * El alcance va antes que nada, igual que en las rutas hermanas: de un
 * incidente fuera de tu sucursal no se responde ni siquiera que existe.
 */
export const GET = withTenantAuth(async (
    _request: NextRequest,
    { params, auth }
) => {
    const { id } = await (params as unknown as Promise<{ id: string }>);

    const incident = await findIncidentForTenant(
        id,
        auth.tenantId,
        incidentBranchScope(auth.user.role, auth.branchId)
    );

    if (!incident) {
        return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    const items: EvidenceItem[] = [];

    // La foto de detección es evidencia también, y es la única que existe en
    // incidentes que nunca entraron a un protocolo de remediación.
    if (incident.photoUrl) {
        items.push({
            stepIndex: null,
            type: 'photo',
            content: incident.photoUrl,
            passed: null,
            aiReason: null,
            aiConfidence: null,
            submittedBy: incident.detectedBy ?? null,
            createdAt: (incident.createdAt ?? new Date()).toISOString(),
            source: 'detection',
        });
    }

    const metadata = (incident.metadata as any) ?? {};
    const history = Array.isArray(metadata.evidenceHistory) ? metadata.evidenceHistory : [];

    for (const raw of history) {
        items.push({
            stepIndex: typeof raw?.stepIndex === 'number' ? raw.stepIndex : null,
            type: raw?.type === 'photo' ? 'photo' : 'text',
            content: typeof raw?.content === 'string' ? raw.content : '',
            passed: typeof raw?.passed === 'boolean' ? raw.passed : null,
            aiReason: raw?.aiReason ?? null,
            aiConfidence: typeof raw?.aiConfidence === 'number' ? raw.aiConfidence : null,
            submittedBy: raw?.submittedBy ?? null,
            createdAt: raw?.createdAt ?? new Date().toISOString(),
            source: 'remediation',
        });
    }

    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return NextResponse.json({ data: items });
});
