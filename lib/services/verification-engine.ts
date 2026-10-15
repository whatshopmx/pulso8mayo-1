import { AIService } from "./ai-service";
import { VerificationRule, VerificationResult, VerificationType } from "../types/ai-verification";
import { evaluateVerificationVerdict, tryParseJSON } from "../workflows/verification-verdict-policy";

export { tryParseJSON };

export class VerificationEngine {
    /**
     * Evaluates a photo against a set of verification rules using the configured AI provider
     * and authoritative deterministic verdict policy (C26 / H07).
     */
    static async evaluate(
        photoUrl: string,
        rule: VerificationRule,
        aiConfig?: import('./ai-service').AIConfig
    ): Promise<VerificationResult> {
        const verificationType = rule.verificationType ?? rule.type ?? VerificationType.CLASIFICACION;

        // 1. Perform AI Analysis with configured provider / fallback
        const aiResult = await AIService.performVerification(photoUrl, verificationType, {
            expectedObjects: rule.expectedObjects ?? rule.requiredElements,
            forbiddenObjects: rule.forbiddenObjects,
            categories: rule.expectedObjects ?? rule.requiredElements
        }, aiConfig);

        // 2. Evaluate Rule Logic with authoritative pure policy (enforcing minimum confidence gate)
        return evaluateVerificationVerdict({
            photoUrl,
            aiResult,
            rule
        });
    }
}
