/**
 * lib/workflows/verification-verdict-policy.ts
 *
 * Politica autoritativa y pura para el veredicto de verificacion con IA (C26 / H07).
 *
 * Garantiza que:
 * 1. Calidad o seguridad favorables NUNCA autoaprueban si la confianza no alcanza el minimo requerido.
 * 2. Cada resultado conserva motivo descriptivo, proveedor, confianza resuelta, regla de decision y necesidad de revision manual.
 * 3. Los casos frontera de confianza (>= vs <) y autoApprove tienen resultado determinista sin efectos flotantes.
 */

import {
    VerificationRule,
    VerificationResult,
    AIAnalysisResult,
    VerificationType,
    VerificationVerdictCode,
} from '../types/ai-verification';

export const DEFAULT_MIN_CONFIDENCE = 0.85;
export const PASSING_QUALITY_SCORE = 6.0;

/**
 * Normaliza y acota el umbral de confianza minima exigido por una regla.
 * Si no se define o es invalido, aplica deterministamente 0.85.
 */
export function normalizeMinConfidence(val?: unknown): number {
    if (typeof val !== 'number' || Number.isNaN(val)) {
        return DEFAULT_MIN_CONFIDENCE;
    }
    const clamped = Math.max(0, Math.min(1, val));
    return Math.round(clamped * 10000) / 10000;
}

/**
 * Normaliza y acota la confianza reportada por el analisis de IA [0.0, 1.0].
 */
export function normalizeConfidence(val?: unknown): number {
    if (typeof val !== 'number' || Number.isNaN(val)) {
        return 0;
    }
    const clamped = Math.max(0, Math.min(1, val));
    return Math.round(clamped * 10000) / 10000;
}

/**
 * Parser seguro de JSON embebido en respuestas de texto de IA.
 */
export function tryParseJSON(text?: string | null): Record<string, unknown> | null {
    if (!text || typeof text !== 'string') return null;
    try {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) return null;
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

export interface EvaluateVerdictInput {
    aiResult: AIAnalysisResult;
    rule: VerificationRule;
    photoUrl?: string;
}

/**
 * Evalua de forma pura y determinista el veredicto final de una verificacion de IA.
 */
export function evaluateVerificationVerdict(input: EvaluateVerdictInput): VerificationResult {
    const { aiResult, rule } = input;

    const minConfidence = normalizeMinConfidence(rule.minConfidence ?? rule.expectedConfidence);
    const verificationType = rule.verificationType ?? rule.type ?? VerificationType.CLASIFICACION;
    const provider = aiResult.provider || (aiResult.metadata?.provider as string) || undefined;

    let confidence = normalizeConfidence(aiResult.confidence);
    let domainPassed = Boolean(aiResult.passed);
    let domainFailureCode: VerificationVerdictCode | null = domainPassed ? null : 'AI_CRITERIA_FAILED';
    let reason = aiResult.reason || '';
    const metadata: Record<string, unknown> = { ...aiResult.metadata };

    if (provider) {
        metadata.provider = provider;
    }

    // --- 1. Evaluacion de Criterios Especificos de Dominio ---
    switch (verificationType) {
        case VerificationType.DETECCION_OBJETOS:
        case VerificationType.PRESENCIA_ELEMENTOS: {
            const expected = (rule.expectedObjects ?? rule.requiredElements ?? [])
                .map((s) => s.trim())
                .filter(Boolean);
            const forbidden = (rule.forbiddenObjects ?? []).map((s) => s.trim()).filter(Boolean);

            if (provider !== 'moondream') {
                const lowerReason = reason.toLowerCase();
                if (expected.length > 0) {
                    const missing = expected.filter((obj) => !lowerReason.includes(obj.toLowerCase()));
                    if (missing.length > 0) {
                        domainPassed = false;
                        domainFailureCode = 'MISSING_REQUIRED_OBJECTS';
                        reason = `Missing required objects: ${missing.join(', ')}. AI Detects: ${reason}`;
                    }
                }
                if (forbidden.length > 0) {
                    const detectedForbidden = forbidden.filter((obj) => lowerReason.includes(obj.toLowerCase()));
                    if (detectedForbidden.length > 0) {
                        domainPassed = false;
                        domainFailureCode = 'FORBIDDEN_OBJECTS_DETECTED';
                        reason = `Forbidden objects detected: ${detectedForbidden.join(', ')}. AI Detects: ${reason}`;
                    }
                }
            } else {
                // Moondream: valida detecciones registradas en metadata
                const forbiddenDetected = metadata.forbiddenDetected as string[] | undefined;
                if (forbiddenDetected && forbiddenDetected.length > 0) {
                    domainPassed = false;
                    domainFailureCode = 'FORBIDDEN_OBJECTS_DETECTED';
                    reason = `Forbidden objects detected: ${forbiddenDetected.join(', ')}`;
                }
            }
            break;
        }

        case VerificationType.ANALISIS_CALIDAD: {
            const parsed = tryParseJSON(reason);
            if (parsed && typeof parsed.score === 'number') {
                const score = Number(parsed.score);
                const passed = score >= PASSING_QUALITY_SCORE;
                domainPassed = passed;
                if (!passed) {
                    domainFailureCode = 'QUALITY_CRITERIA_FAILED';
                    reason = parsed.summary || `Quality score (${score}/10) is below passing threshold (${PASSING_QUALITY_SCORE}/10).`;
                } else {
                    reason = parsed.summary || `Quality standard met with score ${score}/10.`;
                }
                // La confianza se calcula del score de calidad: min(0.95, score / 10)
                confidence = normalizeConfidence(Math.min(0.95, Math.max(0, score / 10)));
                metadata.qualityScore = score;
                metadata.defects = parsed.defects;
            } else if (!domainPassed) {
                domainFailureCode = 'QUALITY_CRITERIA_FAILED';
            }
            break;
        }

        case VerificationType.ANALISIS_SEGURIDAD: {
            const parsed = tryParseJSON(reason);
            if (parsed && typeof parsed.is_safe === 'boolean') {
                domainPassed = Boolean(parsed.is_safe);
                if (!domainPassed) {
                    domainFailureCode = 'SAFETY_HAZARD_DETECTED';
                    reason = parsed.hazards?.length
                        ? `Hazards detected: ${parsed.hazards.join(', ')}`
                        : 'Unsafe conditions detected by AI.';
                } else {
                    reason = parsed.hazards?.length
                        ? `Hazards detected: ${parsed.hazards.join(', ')}`
                        : 'No hazards detected; environment verified safe.';
                }
                const riskMap: Record<string, number> = { low: 0.9, medium: 0.75, high: 0.5 };
                const calculatedRiskConfidence = riskMap[parsed.risk_level] ?? (parsed.is_safe ? 0.85 : 0.5);
                confidence = normalizeConfidence(calculatedRiskConfidence);
                metadata.hazards = parsed.hazards;
                metadata.riskLevel = parsed.risk_level;
            } else if (!domainPassed) {
                domainFailureCode = 'SAFETY_HAZARD_DETECTED';
            }
            break;
        }

        case VerificationType.OCR:
        case VerificationType.RECONOCIMIENTO_TEXTOS: {
            if (!domainPassed) {
                domainFailureCode = 'AI_CRITERIA_FAILED';
            }
            break;
        }

        case VerificationType.CLASIFICACION:
        default: {
            if (!domainPassed) {
                domainFailureCode = 'AI_CRITERIA_FAILED';
            }
            break;
        }
    }

    // --- 2. Compuerta Obligatoria de Confianza (Gate de Seguridad H07 / C26) ---
    // Ninguna rama favorable puede autoaprobar si la confianza no alcanza el minimo requerido.
    const meetsConfidence = confidence >= minConfidence;

    let success = false;
    let requiresManualReview = false;
    let decisionRule: VerificationVerdictCode;

    if (!domainPassed) {
        // Fallo en los criterios de dominio del paso
        success = false;
        decisionRule = domainFailureCode || 'AI_CRITERIA_FAILED';
        // Respeta requireManualReviewIfFailed si se desactiva explicitamente, de lo contrario exige revision
        requiresManualReview = rule.requireManualReviewIfFailed !== false;
    } else if (!meetsConfidence) {
        // Criterios de dominio cumplidos, pero confianza insuficiente (< minConfidence)
        // REGLA CRITICA: success es false, autoApprove queda anulado y se exige revision manual
        success = false;
        decisionRule = 'CONFIDENCE_BELOW_MINIMUM';
        requiresManualReview = true;
        reason = `${reason} [Confianza ${confidence.toFixed(2)} inferior al minimo requerido ${minConfidence.toFixed(2)}]`.trim();
    } else {
        // Dominio aprobado y confianza suficiente (>= minConfidence)
        success = true;
        if (rule.autoApprove === true) {
            // Autoaprobacion concedida solo cuando todas las condiciones obligatorias se cumplen
            requiresManualReview = false;
            decisionRule = 'AUTO_APPROVED';
        } else {
            // Cumple con exito, pero requiere revision manual segun configuracion de plantilla
            requiresManualReview = true;
            decisionRule = 'MANUAL_REVIEW_REQUIRED';
        }
    }

    return {
        success,
        ruleId: rule.id,
        aiResult: {
            ...aiResult,
            passed: success, // Sincronizado autoritativamente con el veredicto final
            reason,
            confidence,
            provider,
            metadata,
        },
        requiresManualReview,
        decisionRule,
        minConfidence,
        timestamp: new Date(),
    };
}
