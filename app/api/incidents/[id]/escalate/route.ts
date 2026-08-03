import { NextRequest, NextResponse } from 'next/server';
import { EscalationService } from '@/lib/services/escalation-service';
import { withTenantAuth } from '@/lib/api/with-auth';

/**
 * POST /api/incidents/[id]/escalate
 * Manually escalate an incident to a specific level
 */
export const POST = withTenantAuth(async (
    request: NextRequest,
    { params, auth }
) => {
    try {
        const body = await request.json();
        const { targetLevel } = body;
        const { id } = await (params as unknown as Promise<{ id: string }>);

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
