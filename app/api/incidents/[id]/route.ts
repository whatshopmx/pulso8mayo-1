import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { incidents, branches, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { IncidentEngine } from '@/lib/services/incident-engine';
import { withTenantAuth, withRoleAuth } from '@/lib/api/with-auth';
import { findIncidentForTenant, incidentBranchScope } from '@/lib/api/incident-access';

/**
 * GET /api/incidents/[id]
 * Get incident details with branch and user names
 */
export const GET = withTenantAuth(async (
    request: NextRequest,
    { params, auth }
) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);
        const incident = await findIncidentForTenant(id, auth.tenantId, incidentBranchScope(auth.user.role, auth.branchId));

        if (!incident) {
            return NextResponse.json(
                { error: 'Incident not found' },
                { status: 404 }
            );
        }

        const result: Record<string, unknown> = { ...incident };

        if (incident.branchId) {
            const branch = await db.query.branches.findFirst({
                where: eq(branches.id, incident.branchId),
                columns: { name: true },
            });
            result.branchName = branch?.name ?? null;
        }

        if (incident.detectedBy) {
            const user = await db.query.users.findFirst({
                where: eq(users.id, incident.detectedBy),
                columns: { name: true },
            });
            result.detectedByName = user?.name ?? null;
        }

        if (incident.resolvedBy) {
            const user = await db.query.users.findFirst({
                where: eq(users.id, incident.resolvedBy),
                columns: { name: true },
            });
            result.resolvedByName = user?.name ?? null;
        }

        return NextResponse.json({ incident: result });
    } catch (error) {
        console.error('[API] Error fetching incident:', error);
        return NextResponse.json(
            { error: 'Failed to fetch incident' },
            { status: 500 }
        );
    }
});

/**
 * PATCH /api/incidents/[id]
 * Resolve an incident
 */
export const PATCH = withTenantAuth(async (
    request: NextRequest,
    { params, auth }
) => {
    try {
        const body = await request.json();
        const { resolution } = body;
        const { id } = await (params as unknown as Promise<{ id: string }>);

        if (!resolution) {
            return NextResponse.json(
                { error: 'Missing resolution' },
                { status: 400 }
            );
        }

        const existing = await findIncidentForTenant(id, auth.tenantId, incidentBranchScope(auth.user.role, auth.branchId));
        if (!existing) {
            return NextResponse.json(
                { error: 'Incident not found' },
                { status: 404 }
            );
        }

        // resolvedBy siempre sale de la sesión, nunca del body
        const incident = await IncidentEngine.resolveIncident(
            id,
            resolution,
            auth.user.id
        );

        return NextResponse.json({ incident });
    } catch (error) {
        console.error('[API] Error resolving incident:', error);
        return NextResponse.json(
            { error: 'Failed to resolve incident' },
            { status: 500 }
        );
    }
});

/**
 * DELETE /api/incidents/[id]
 * Descarta un incidente sin borrarlo: es evidencia de cumplimiento
 * (NOM-251 / NOM-035) y el registro debe sobrevivir a la auditoría.
 */
export const DELETE = withRoleAuth(['SUPER_ADMIN', 'ADMIN'], async (
    request: NextRequest,
    { params, auth }
) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);

        const existing = await findIncidentForTenant(id, auth.tenantId, incidentBranchScope(auth.user.role, auth.branchId));
        if (!existing) {
            return NextResponse.json(
                { error: 'Incident not found' },
                { status: 404 }
            );
        }

        const [incident] = await db
            .update(incidents)
            .set({
                status: 'RESOLVED',
                resolution: 'Descartado por administración',
                resolvedBy: auth.user.id,
                resolvedAt: new Date(),
                metadata: {
                    ...(existing.metadata as Record<string, unknown> | null),
                    dismissed: true,
                    dismissedAt: new Date().toISOString(),
                },
                updatedAt: new Date(),
            })
            .where(eq(incidents.id, id))
            .returning();

        return NextResponse.json({ success: true, incident });
    } catch (error) {
        console.error('[API] Error dismissing incident:', error);
        return NextResponse.json(
            { error: 'Failed to dismiss incident' },
            { status: 500 }
        );
    }
});
