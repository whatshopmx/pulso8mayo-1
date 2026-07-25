import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { incidents, branches, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { IncidentEngine } from '@/lib/services/incident-engine';
import { EscalationService } from '@/lib/services/escalation-service';

/**
 * GET /api/incidents/[id]
 * Get incident details with branch and user names
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const [incident] = await db
            .select()
            .from(incidents)
            .where(eq(incidents.id, id))
            .limit(1);

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
}

/**
 * PATCH /api/incidents/[id]
 * Resolve an incident
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const body = await request.json();
        const { resolution } = body;
        const { id } = await params;

        if (!resolution) {
            return NextResponse.json(
                { error: 'Missing resolution' },
                { status: 400 }
            );
        }

        const session = await auth.api.getSession({
            headers: await headers(),
        });

        if (!session?.user?.id) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const incident = await IncidentEngine.resolveIncident(
            id,
            resolution,
            session.user.id
        );

        if (!incident) {
            return NextResponse.json(
                { error: 'Incident not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({ incident });
    } catch (error) {
        console.error('[API] Error resolving incident:', error);
        return NextResponse.json(
            { error: 'Failed to resolve incident' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/incidents/[id]
 * Delete an incident (soft delete)
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        await db
            .delete(incidents)
            .where(eq(incidents.id, id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[API] Error deleting incident:', error);
        return NextResponse.json(
            { error: 'Failed to delete incident' },
            { status: 500 }
        );
    }
}
