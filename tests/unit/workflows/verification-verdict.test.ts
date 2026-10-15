import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    evaluateVerificationVerdict,
    normalizeMinConfidence,
    normalizeConfidence,
    tryParseJSON,
    DEFAULT_MIN_CONFIDENCE,
} from '@/lib/workflows/verification-verdict-policy';
import { VerificationEngine } from '@/lib/services/verification-engine';
import { AIService } from '@/lib/services/ai-service';
import { VerificationType } from '@/lib/types/ai-verification';

describe('C26 — Conservar confianza minima en el veredicto IA (H07)', () => {
    describe('Criterio 1: Calidad o seguridad favorables no autoaprueban cuando no se cumple la confianza requerida', () => {
        it('calidad favorable (score 6/10 -> confianza 0.60) no autoaprueba si minConfidence es 0.85', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        score: 6,
                        summary: 'Aceptable con observaciones menores',
                        defects: ['Uniforme ligeramente arrugado'],
                    }),
                    confidence: 0.6,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_CALIDAD,
                    minConfidence: 0.85,
                    autoApprove: true, // Intenta autoaprobar
                },
            });

            // CRITICO: success debe ser false a pesar de que score >= 6
            expect(result.success).toBe(false);
            expect(result.requiresManualReview).toBe(true);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
            expect(result.aiResult.confidence).toBe(0.6);
            expect(result.minConfidence).toBe(0.85);
            expect(result.aiResult.reason).toContain('Confianza 0.60 inferior al minimo requerido 0.85');
            expect(result.aiResult.passed).toBe(false);
        });

        it('calidad favorable intermedia (score 8/10 -> confianza 0.80) no autoaprueba si minConfidence es 0.85', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        score: 8,
                        summary: 'Buena presentacion de alimentos',
                    }),
                    confidence: 0.8,
                    provider: 'openai',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_CALIDAD,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(false);
            expect(result.requiresManualReview).toBe(true);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
            expect(result.aiResult.confidence).toBe(0.8);
            expect(result.aiResult.passed).toBe(false);
        });

        it('calidad sobresaliente (score 9.5/10 -> confianza 0.95 >= 0.85) autoaprueba si autoApprove es true', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        score: 9.5,
                        summary: 'Excelente higiene y apego a NOM-251',
                    }),
                    confidence: 0.95,
                    provider: 'moondream',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_CALIDAD,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(true);
            expect(result.requiresManualReview).toBe(false);
            expect(result.decisionRule).toBe('AUTO_APPROVED');
            expect(result.aiResult.confidence).toBe(0.95);
            expect(result.aiResult.passed).toBe(true);
        });

        it('calidad sobresaliente requiere revision manual si autoApprove es false', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        score: 9.5,
                        summary: 'Excelente presentacion',
                    }),
                    confidence: 0.95,
                    provider: 'moondream',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_CALIDAD,
                    minConfidence: 0.85,
                    autoApprove: false,
                },
            });

            expect(result.success).toBe(true);
            expect(result.requiresManualReview).toBe(true);
            expect(result.decisionRule).toBe('MANUAL_REVIEW_REQUIRED');
        });

        it('seguridad favorable (is_safe: true) con riesgo medio (confianza 0.75) no autoaprueba si minConfidence es 0.85', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        is_safe: true,
                        risk_level: 'medium',
                        hazards: [],
                    }),
                    confidence: 0.75,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_SEGURIDAD,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(false);
            expect(result.requiresManualReview).toBe(true);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
            expect(result.aiResult.confidence).toBe(0.75);
            expect(result.aiResult.reason).toContain('Confianza 0.75 inferior al minimo requerido 0.85');
        });

        it('seguridad favorable (is_safe: true) con riesgo alto (confianza 0.50) no autoaprueba si minConfidence es 0.85', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        is_safe: true,
                        risk_level: 'high',
                        hazards: [],
                    }),
                    confidence: 0.5,
                    provider: 'openai',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_SEGURIDAD,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(false);
            expect(result.requiresManualReview).toBe(true);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
        });

        it('seguridad favorable con riesgo bajo (confianza 0.90 >= 0.85) autoaprueba si autoApprove es true', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        is_safe: true,
                        risk_level: 'low',
                        hazards: [],
                    }),
                    confidence: 0.9,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_SEGURIDAD,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(true);
            expect(result.requiresManualReview).toBe(false);
            expect(result.decisionRule).toBe('AUTO_APPROVED');
            expect(result.aiResult.confidence).toBe(0.9);
        });
    });

    describe('Criterio 2: Cada resultado conserva motivo, proveedor, confianza y necesidad de revision', () => {
        it('preserva proveedor, metadatos, motivo explicativo y codigo de veredicto', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Camara de refrigeracion a 3.5 grados C',
                    confidence: 0.88,
                    provider: 'cloudflare',
                    metadata: {
                        temperature: 3.5,
                        model: '@cf/meta/llama-3.2-11b-vision-instruct',
                    },
                },
                rule: {
                    id: 'rule-temp-refri',
                    verificationType: VerificationType.CLASIFICACION,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.ruleId).toBe('rule-temp-refri');
            expect(result.success).toBe(true);
            expect(result.decisionRule).toBe('AUTO_APPROVED');
            expect(result.minConfidence).toBe(0.85);
            expect(result.requiresManualReview).toBe(false);
            expect(result.aiResult.provider).toBe('cloudflare');
            expect(result.aiResult.confidence).toBe(0.88);
            expect(result.aiResult.reason).toBe('Camara de refrigeracion a 3.5 grados C');
            expect(result.aiResult.metadata?.temperature).toBe(3.5);
            expect(result.aiResult.metadata?.provider).toBe('cloudflare');
            expect(result.timestamp).toBeInstanceOf(Date);
        });

        it('rechazo por falta de objetos requeridos detalla los elementos faltantes', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'El colaborador porta cofia y botas de seguridad',
                    confidence: 0.9,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.DETECCION_OBJETOS,
                    expectedObjects: ['cofia', 'mandil'],
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(false);
            expect(result.decisionRule).toBe('MISSING_REQUIRED_OBJECTS');
            expect(result.requiresManualReview).toBe(true);
            expect(result.aiResult.reason).toContain('Missing required objects: mandil');
        });

        it('rechazo por objetos prohibidos detalla los elementos detectados', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Se observa manipulacion con reloj metalico en muñeca',
                    confidence: 0.92,
                    provider: 'openai',
                },
                rule: {
                    verificationType: VerificationType.DETECCION_OBJETOS,
                    forbiddenObjects: ['reloj', 'pulsera'],
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(false);
            expect(result.decisionRule).toBe('FORBIDDEN_OBJECTS_DETECTED');
            expect(result.requiresManualReview).toBe(true);
            expect(result.aiResult.reason).toContain('Forbidden objects detected: reloj');
        });

        it('rechazo de calidad por score reprobatorio (< 6) indica fallo de calidad', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        score: 4,
                        summary: 'Contaminacion cruzada evidente en tabla de corte',
                        defects: ['Carne cruda junto a vegetales cocidos'],
                    }),
                    confidence: 0.9,
                    provider: 'moondream',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_CALIDAD,
                    minConfidence: 0.85,
                },
            });

            expect(result.success).toBe(false);
            expect(result.decisionRule).toBe('QUALITY_CRITERIA_FAILED');
            expect(result.requiresManualReview).toBe(true);
            expect(result.aiResult.confidence).toBe(0.4);
            expect(result.aiResult.metadata?.qualityScore).toBe(4);
        });

        it('rechazo de seguridad por condicion insegura (is_safe: false) indica riesgos', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: JSON.stringify({
                        is_safe: false,
                        risk_level: 'high',
                        hazards: ['Derrame de aceite sin señalizar cerca de freidora'],
                    }),
                    confidence: 0.85,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.ANALISIS_SEGURIDAD,
                    minConfidence: 0.85,
                },
            });

            expect(result.success).toBe(false);
            expect(result.decisionRule).toBe('SAFETY_HAZARD_DETECTED');
            expect(result.requiresManualReview).toBe(true);
            expect(result.aiResult.reason).toContain('Hazards detected: Derrame de aceite');
        });
    });

    describe('Criterio 3: Los casos frontera de confianza y autoApprove tienen resultado determinista', () => {
        it('frontera exacta: confianza exactamente igual a minConfidence (0.85 === 0.85) CUMPLE', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Verificacion exitosa',
                    confidence: 0.85,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.CLASIFICACION,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(true);
            expect(result.decisionRule).toBe('AUTO_APPROVED');
            expect(result.requiresManualReview).toBe(false);
        });

        it('frontera inferior: confianza marginalmente menor (0.8499 < 0.85) RECHAZA', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Verificacion exitosa',
                    confidence: 0.8499,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.CLASIFICACION,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(false);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
            expect(result.requiresManualReview).toBe(true);
        });

        it('frontera superior: confianza marginalmente mayor (0.8501 >= 0.85) CUMPLE', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Verificacion exitosa',
                    confidence: 0.8501,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.CLASIFICACION,
                    minConfidence: 0.85,
                    autoApprove: true,
                },
            });

            expect(result.success).toBe(true);
            expect(result.decisionRule).toBe('AUTO_APPROVED');
            expect(result.requiresManualReview).toBe(false);
        });

        it('cuando minConfidence no se especifica, aplica el default determinista de 0.85', () => {
            expect(normalizeMinConfidence(undefined)).toBe(DEFAULT_MIN_CONFIDENCE);
            expect(normalizeMinConfidence(null)).toBe(DEFAULT_MIN_CONFIDENCE);
            expect(normalizeMinConfidence(NaN)).toBe(DEFAULT_MIN_CONFIDENCE);

            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Verificacion sin umbral explicito',
                    confidence: 0.84, // Por debajo del default 0.85
                    provider: 'openai',
                },
                rule: {
                    verificationType: VerificationType.CLASIFICACION,
                    // minConfidence omitido
                    autoApprove: true,
                },
            });

            expect(result.minConfidence).toBe(0.85);
            expect(result.success).toBe(false);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
            expect(result.requiresManualReview).toBe(true);
        });

        it('respeta el alias retrocompatible expectedConfidence si minConfidence esta ausente', () => {
            const result = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Verificacion con expectedConfidence',
                    confidence: 0.88,
                    provider: 'cloudflare',
                },
                rule: {
                    verificationType: VerificationType.CLASIFICACION,
                    expectedConfidence: 0.9, // Exige 0.90
                    autoApprove: true,
                },
            });

            expect(result.minConfidence).toBe(0.9);
            // 0.88 < 0.90 => rechaza
            expect(result.success).toBe(false);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
            expect(result.requiresManualReview).toBe(true);
        });

        it('normaliza valores fuera de rango de minConfidence y confidence', () => {
            expect(normalizeMinConfidence(-0.5)).toBe(0);
            expect(normalizeMinConfidence(1.5)).toBe(1);
            expect(normalizeConfidence(-0.2)).toBe(0);
            expect(normalizeConfidence(2.0)).toBe(1);
            expect(normalizeConfidence(NaN)).toBe(0);
        });

        it('respeta requireManualReviewIfFailed: false solo si el fallo es de dominio y no de confianza', () => {
            // Caso A: Fallo de dominio (AI passed: false) con requireManualReviewIfFailed: false
            const domainFail = evaluateVerificationVerdict({
                aiResult: {
                    passed: false,
                    reason: 'Deteccion no concluyente',
                    confidence: 0.9,
                    provider: 'openai',
                },
                rule: {
                    verificationType: VerificationType.CLASIFICACION,
                    minConfidence: 0.85,
                    requireManualReviewIfFailed: false,
                },
            });

            expect(domainFail.success).toBe(false);
            expect(domainFail.requiresManualReview).toBe(false);

            // Caso B: Fallo por baja confianza (< minConfidence) DEBE exigir revision manual siempre
            const lowConfidence = evaluateVerificationVerdict({
                aiResult: {
                    passed: true,
                    reason: 'Paso pero con confianza muy baja',
                    confidence: 0.4,
                    provider: 'openai',
                },
                rule: {
                    verificationType: VerificationType.CLASIFICACION,
                    minConfidence: 0.85,
                    requireManualReviewIfFailed: false,
                },
            });

            expect(lowConfidence.success).toBe(false);
            expect(lowConfidence.requiresManualReview).toBe(true);
            expect(lowConfidence.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
        });
    });

    describe('Integracion con VerificationEngine.evaluate', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('VerificationEngine.evaluate aplica la compuerta de confianza autoritativa', async () => {
            vi.spyOn(AIService, 'performVerification').mockResolvedValue({
                passed: true,
                reason: JSON.stringify({
                    score: 6,
                    summary: 'Calidad basica aprobada',
                }),
                confidence: 0.6,
                provider: 'cloudflare',
                metadata: { provider: 'cloudflare' },
            });

            const result = await VerificationEngine.evaluate(
                'https://cdn.example.com/inspeccion.jpg',
                {
                    verificationType: VerificationType.ANALISIS_CALIDAD,
                    minConfidence: 0.85,
                    autoApprove: true,
                }
            );

            expect(result.success).toBe(false);
            expect(result.requiresManualReview).toBe(true);
            expect(result.decisionRule).toBe('CONFIDENCE_BELOW_MINIMUM');
            expect(result.aiResult.confidence).toBe(0.6);
            expect(result.aiResult.passed).toBe(false);
            expect(result.aiResult.provider).toBe('cloudflare');
        });
    });

    describe('tryParseJSON utilitario', () => {
        it('extrae JSON valido con llaves externas', () => {
            expect(tryParseJSON('Respuesta del modelo: {"score": 8, "summary": "OK"}')).toEqual({
                score: 8,
                summary: 'OK',
            });
        });

        it('devuelve null ante texto sin JSON o malformado', () => {
            expect(tryParseJSON('Texto simple sin JSON')).toBeNull();
            expect(tryParseJSON('{score: no-json}')).toBeNull();
            expect(tryParseJSON('')).toBeNull();
            expect(tryParseJSON(null)).toBeNull();
            expect(tryParseJSON(undefined)).toBeNull();
        });
    });
});
