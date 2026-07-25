import { AIService } from "./ai-service";
import { VerificationRule, VerificationResult, AIAnalysisResult, VerificationType } from "../types/ai-verification";

function tryParseJSON(text: string): Record<string, any> | null {
    try {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) return null;
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

export class VerificationEngine {
    /**
     * Evaluates a photo against a set of verification rules.
     */
    static async evaluate(
        photoUrl: string,
        rule: VerificationRule
    ): Promise<VerificationResult> {
        // 1. Perform AI Analysis
        const aiResult = await AIService.performVerification(photoUrl, rule.verificationType, {
            expectedObjects: rule.expectedObjects,
            forbiddenObjects: rule.forbiddenObjects,
            categories: rule.expectedObjects
        });

        // 2. Evaluate Rule Logic
        let success = aiResult.passed; // Default to AI's simple pass/fail judgment first
        let requiresManualReview = false;

        // Confidence Check
        if (aiResult.confidence < rule.minConfidence) {
            success = false;
            requiresManualReview = true;
        }

        // Specific Logic per Type
        switch (rule.verificationType) {
            case VerificationType.DETECCION_OBJETOS:
                if (rule.expectedObjects && rule.expectedObjects.length > 0 && aiResult.provider !== 'moondream') {
                    const detected = aiResult.reason.toLowerCase();
                    const missing = rule.expectedObjects.filter(obj => !detected.includes(obj.toLowerCase()));
                    if (missing.length > 0) {
                        success = false;
                        aiResult.reason = `Missing required objects: ${missing.join(', ')}. AI Detects: ${aiResult.reason}`;
                    }
                }
                break;

            case VerificationType.ANALISIS_CALIDAD: {
                const parsed = tryParseJSON(aiResult.reason);
                if (parsed && typeof parsed.score === 'number') {
                    const score = parsed.score;
                    const passed = score >= 6;
                    success = passed;
                    aiResult.reason = parsed.summary || aiResult.reason;
                    aiResult.confidence = Math.min(0.95, score / 10);
                    aiResult.metadata = { ...aiResult.metadata, qualityScore: score, defects: parsed.defects };
                }
                break;
            }

            case VerificationType.ANALISIS_SEGURIDAD: {
                const parsed = tryParseJSON(aiResult.reason);
                if (parsed && typeof parsed.is_safe === 'boolean') {
                    success = parsed.is_safe;
                    aiResult.reason = parsed.hazards?.length
                        ? `Hazards detected: ${parsed.hazards.join(', ')}`
                        : 'No hazards detected';
                    const riskMap: Record<string, number> = { low: 0.9, medium: 0.75, high: 0.5 };
                    aiResult.confidence = riskMap[parsed.risk_level] ?? 0.85;
                    aiResult.metadata = { ...aiResult.metadata, hazards: parsed.hazards, riskLevel: parsed.risk_level };
                }
                break;
            }
        }

        // Auto-approve logic overrides
        if (rule.autoApprove && success) {
            requiresManualReview = false;
        }

        // Manual Review Trigger
        if (!success && rule.requireManualReviewIfFailed) {
            requiresManualReview = true;
        }

        return {
            success,
            ruleId: rule.id,
            aiResult,
            requiresManualReview,
            timestamp: new Date()
        };
    }
}
