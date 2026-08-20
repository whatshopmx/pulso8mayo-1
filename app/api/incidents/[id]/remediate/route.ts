import { NextRequest, NextResponse } from 'next/server';
import { RemediationService } from '@/lib/services/remediation-service';
import { withTenantAuth } from '@/lib/api/with-auth';
import { findIncidentForTenant, incidentBranchScope } from '@/lib/api/incident-access';

interface RemediationEvidence {
    value?: unknown;
    evidenceUrl?: string;
    aiResult?: Record<string, unknown>;
}

/**
 * Acepta evidencia como texto plano (lo que envía el wizard) o como objeto
 * `{ value, evidenceUrl, aiResult }` para clientes que ya suben foto.
 */
function parseEvidence(raw: unknown): RemediationEvidence {
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('{')) {
            try {
                return parseEvidence(JSON.parse(trimmed));
            } catch {
                // Se trata como texto libre
            }
        }
        const isUrl = /^https?:\/\//i.test(trimmed);
        return isUrl ? { value: trimmed, evidenceUrl: trimmed } : { value: trimmed };
    }

    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        return {
            value: obj.value ?? obj.evidenceUrl,
            evidenceUrl: typeof obj.evidenceUrl === 'string' ? obj.evidenceUrl : undefined,
            aiResult: (obj.aiResult ?? undefined) as Record<string, unknown> | undefined,
        };
    }

    return {};
}

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

        if (!await findIncidentForTenant(id, auth.tenantId, incidentBranchScope(auth.user.role, auth.branchId))) {
            return NextResponse.json(
                { error: 'Incident not found' },
                { status: 404 }
            );
        }

        const parsed = parseEvidence(evidence);

        // Si el paso exige verificación por IA y llegó una foto sin análisis,
        // se analiza aquí: el servicio de validación necesita el aiResult.
        let aiResult = parsed.aiResult;
        if (!aiResult && parsed.evidenceUrl) {
            const status = await RemediationService.getRemediationStatus(id);
            const verification = status?.currentStepVerification;
            if (verification?.type === 'ai_photo_verification') {
                const { AIService } = await import('@/lib/services/ai-service');
                aiResult = await AIService.verifyPhoto(
                    parsed.evidenceUrl,
                    verification.prompt || 'Verifica que la desviación reportada haya sido corregida.'
                ) as unknown as Record<string, unknown>;
            }
        }

        // La validación decide; el tracking solo registra el resultado.
        const validation = await RemediationService.validateRemediationCompletion(
            id,
            stepIndex,
            parsed.value,
            aiResult
        );

        const progress = await RemediationService.trackRemediationAttempt(
            id,
            stepIndex,
            validation.passed
        );

        return NextResponse.json({
            success: validation.passed,
            message: validation.passed
                ? (progress?.message ?? 'Paso de remediación completado')
                : validation.reason,
            reason: validation.reason,
            progress,
        });
    } catch (error) {
        console.error('[API] Error submitting remediation:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to submit remediation' },
            { status: 500 }
        );
    }
});
