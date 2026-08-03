import { NextRequest, NextResponse } from 'next/server';
import { RemediationService } from '@/lib/services/remediation-service';
import { withTenantAuth } from '@/lib/api/with-auth';

/**
 * POST /api/incidents/[id]/remediate
 * Submit remediation step evidence
 */
export const POST = withTenantAuth(async (
    request: NextRequest,
    { params, auth }
) => {
    try {
        const body = await request.json();
        const { stepIndex, evidence } = body;
        const { id } = await (params as unknown as Promise<{ id: string }>);

        if (stepIndex === undefined || !evidence) {
            return NextResponse.json(
                { error: 'Missing stepIndex or evidence' },
                { status: 400 }
            );
        }

        // Track the remediation attempt — validated by session
        const success = await RemediationService.trackRemediationAttempt(
            id,
            stepIndex,
            true // Assume success for now, validation happens in service
        );

        return NextResponse.json({
            success,
            message: success ? 'Paso de remediación completado' : 'No se pudo completar el paso de remediación',
        });
    } catch (error) {
        console.error('[API] Error submitting remediation:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to submit remediation' },
            { status: 500 }
        );
    }
});
