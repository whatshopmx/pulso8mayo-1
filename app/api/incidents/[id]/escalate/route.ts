import { NextRequest, NextResponse } from 'next/server';
import { EscalationService } from '@/lib/services/escalation-service';
import { withTenantAuth } from '@/lib/api/with-auth';
import { findIncidentForTenant, incidentBranchScope } from '@/lib/api/incident-access';

/**
 * POST /api/incidents/[id]/escalate
 * Manually escalate an incident to a specific level
 */
export const POST = withTenantAuth(async (
    request: NextRequest,
    { params, auth }
) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);

        // Mismo orden que `remediate`: el alcance antes que la forma del cuerpo.
        // Las cuatro superficies que comparten `findIncidentForTenant` tienen
        // que contestar lo mismo ante el mismo incidente ajeno; dos de ellas
        // miraban primero el cuerpo y respondían 400.
        if (!await findIncidentForTenant(id, auth.tenantId, incidentBranchScope(auth.user.role, auth.branchId))) {
            return NextResponse.json(
                { error: 'Incident not found' },
                { status: 404 }
            );
        }

        const body = await request.json();
        const { targetLevel } = body;

        if (!targetLevel) {
            return NextResponse.json(
                { error: 'Missing targetLevel' },
                { status: 400 }
            );
        }

        await EscalationService.manualEscalate(
            id,
            targetLevel,
            auth.user.id // escalatedBy always from session
        );

        return NextResponse.json({
            success: true,
            message: `Incident escalated to level ${targetLevel}`,
        });
    } catch (error) {
        console.error('[API] Error escalating incident:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to escalate incident' },
            { status: 500 }
        );
    }
});
