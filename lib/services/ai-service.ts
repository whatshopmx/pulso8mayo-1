import { MoondreamProvider } from '../ai/providers/moondream';
import { OpenAIProvider } from '../ai/providers/openai';
import { VerificationRule, VerificationResult, AIAnalysisResult, VerificationType } from '../types/ai-verification';
import { VerificationEngine } from './verification-engine';

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

// Configuration interface
interface AIConfig {
    provider?: 'moondream' | 'openai';
    useFallback?: boolean;
}

export interface SmartLinkVerificationResult {
    success: boolean;
    verificationId: string;
    aiResult: AIAnalysisResult;
    requiresManualReview: boolean;
    escalated: boolean;
    timestamp: Date;
}

export class AIService {
    private static moondream: MoondreamProvider | null = null;
    private static openai: OpenAIProvider | null = null;

    private static getMoondreamClient() {
        if (!this.moondream) {
            const apiKey = process.env.MOONDREAM_API_KEY;
            if (!apiKey) throw new Error('MOONDREAM_API_KEY not configured');
            this.moondream = new MoondreamProvider({ apiKey });
        }
        return this.moondream;
    }

    private static getOpenAIClient() {
        if (!this.openai) {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
            this.openai = new OpenAIProvider({ apiKey });
        }
        return this.openai;
    }

    /**
     * Analyze a photo based on a prompt using configured providers.
     * Implements fallback logic (Moondream -> OpenAI) if enabled.
     */
    static async verifyPhoto(photoUrl: string, prompt: string, config: AIConfig = {}): Promise<{
        passed: boolean;
        reason: string;
        details?: Record<string, unknown>;
    }> {
        const defaultProvider = process.env.AI_PROVIDER_DEFAULT || 'moondream';
        const targetProvider = config.provider || defaultProvider;
        const useFallback = config.useFallback ?? true;

        try {
            // Try primary provider
            if (targetProvider === 'moondream') {
                try {
                    console.log(`[AI] Analyzing with Moondream: ${photoUrl}`);
                    const result = await this.getMoondreamClient().analyzeImage(photoUrl, prompt);
                    return {
                        passed: result.isCompliant,
                        reason: result.description,
                        details: {
                            confidence: result.confidence,
                            provider: 'moondream',
                            raw: result.rawResponse
                        }
                    };
                } catch (error) {
                    console.error('[AI] Moondream failed:', error);
                    if (!useFallback) throw error;
                    // Fallback to OpenAI continues below
                    console.log('[AI] Falling back to OpenAI...');
                    return await this.callOpenAI(photoUrl, prompt);
                }
            } else {
                return await this.callOpenAI(photoUrl, prompt);
            }
        } catch (error: unknown) {
            console.error('[AI] Verification failed:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Allow mock mode for development if keys are missing
            if (process.env.NODE_ENV === 'development' && errorMessage.includes('not configured')) {
                console.warn('[AI] Running in mock mode due to missing credentials');
                return this.runMock(photoUrl);
            }

            return {
                passed: false,
                reason: `AI Error: ${errorMessage || 'Verification service unavailable'}`,
                details: { error: errorMessage }
            };
        }
    }

    /**
     * Extract text from an image, optionally focusing on a specific region/context.
     */
    static async extractText(photoUrl: string, context: string = 'text', config: AIConfig = {}): Promise<string> {
        // Prefer OpenAI for text extraction as it has superior OCR capabilities
        const defaultConfig = { provider: 'openai', useFallback: true };
        const finalConfig = { ...defaultConfig, ...config } as AIConfig;

        const prompt = `Please extract the ${context} from this image. Return ONLY the extracted text, no conversational filler.`;

        const result = await this.verifyPhoto(photoUrl, prompt, finalConfig);
        if (!result.passed) { // Reuse verifyPhoto structure, passed=complaint logic doesn't strictly apply but we check for errors
            throw new Error(result.reason);
        }

        return result.reason.trim();
    }

    /**
     * Extract temperature reading from a photo.
     * Returns the numeric value (Celsius).
     */
    static async extractTemperature(photoUrl: string, config: AIConfig = {}): Promise<number | null> {
        try {
            const prompt = "Read the numeric temperature value from this thermometer display. Return ONLY the number (e.g., '4.5' or '-18'). If no number is visible, return 'null'.";
            const text = await this.extractText(photoUrl, 'temperature reading', config);

            // Clean up string to find number
            const match = text.match(/-?\d+(\.\d+)?/);
            if (match) {
                return parseFloat(match[0]);
            }
            return null;
        } catch (error) {
            console.error('[AI] Temperature extraction failed:', error);
            return null;
        }
    }

    /**
     * Extract expiration date from a photo.
     * Returns a Date object.
     */
    static async extractExpirationDate(photoUrl: string, config: AIConfig = {}): Promise<Date | null> {
        try {
            const prompt = "Read the expiration or use-by date from this product label. Return ONLY the date in ISO format (YYYY-MM-DD). If not visible, return 'null'.";
            const text = await this.extractText(photoUrl, 'expiration date', config);

            const date = new Date(text);
            if (!isNaN(date.getTime())) {
                return date;
            }
            return null;
        } catch (error) {
            console.error('[AI] Date extraction failed:', error);
            return null;
        }
    }

    private static async callOpenAI(photoUrl: string, prompt: string) {
        console.log(`[AI] Analyzing with OpenAI: ${photoUrl}`);
        const result = await this.getOpenAIClient().analyzeImage(photoUrl, prompt);
        return {
            passed: result.isCompliant,
            reason: result.description,
            details: {
                confidence: result.confidence,
                provider: 'openai',
                raw: result.rawResponse
            }
        };
    }

    /**
     * Perform specific verification based on a defined rule type.
     */
    static async performVerification(
        photoUrl: string,
        type: import('../types/ai-verification').VerificationType,
        context?: Record<string, unknown>,
        config: AIConfig = {}
    ): Promise<import('../types/ai-verification').AIAnalysisResult> {
        if (type === VerificationType.DETECCION_OBJETOS) {
            return this.detectObjects(photoUrl, context, config);
        }

        const prompt = this.getPromptForType(type, context);
        const result = await this.verifyPhoto(photoUrl, prompt, config);

        const analysisResult = {
            passed: result.passed,
            reason: result.reason,
            confidence: (result.details?.confidence as number) || 0,
            provider: result.details?.provider as string | undefined,
            metadata: { ...result.details } as Record<string, any> | undefined
        };

        const parsed = tryParseJSON(result.reason);
        if (parsed) {
            if (type === VerificationType.CLASIFICACION && parsed.category) {
                analysisResult.reason = parsed.category;
                analysisResult.metadata = { ...analysisResult.metadata, classification: parsed.category };
            }
            if ((type === VerificationType.OCR || type === VerificationType.RECONOCIMIENTO_TEXTOS) && parsed.text) {
                analysisResult.reason = parsed.text;
                analysisResult.metadata = { ...analysisResult.metadata, extractedText: parsed.text };
            }
        }

        const lowerReason = result.reason.toLowerCase();
        if (lowerReason.includes('i cannot') || lowerReason.includes('not visible') || lowerReason.includes('not clear')) {
            analysisResult.confidence = 0.3;
        } else if (result.details) {
            const raw = (result.details as Record<string, any>).raw as Record<string, any> | undefined;
            const metrics = raw?.metrics as Record<string, number> | undefined;
            if (metrics && typeof metrics.output_tokens === 'number' && typeof metrics.input_tokens === 'number') {
                const ratio = Math.min(1, metrics.output_tokens / Math.max(1, metrics.input_tokens));
                analysisResult.confidence = Math.max(0.5, ratio);
            } else {
                analysisResult.confidence = 0.85;
            }
        } else {
            analysisResult.confidence = 0.85;
        }

        return analysisResult;
    }

    private static async detectObjects(
        photoUrl: string,
        context?: Record<string, unknown>,
        config: AIConfig = {}
    ): Promise<import('../types/ai-verification').AIAnalysisResult> {
        const expectedObjects = (context?.expectedObjects as string[]) || [];
        const forbiddenObjects = (context?.forbiddenObjects as string[]) || [];
        const defaultProvider = process.env.AI_PROVIDER_DEFAULT || 'moondream';
        const targetProvider = config.provider || defaultProvider;

        // Fall back to query-based approach for non-moondream providers
        if (targetProvider !== 'moondream') {
            const prompt = this.getPromptForType(VerificationType.DETECCION_OBJETOS, context);
            const result = await this.verifyPhoto(photoUrl, prompt, config);
            return {
                passed: result.passed,
                reason: result.reason,
                confidence: (result.details?.confidence as number) || 0,
                provider: result.details?.provider as string | undefined,
                metadata: result.details
            };
        }

        const client = this.getMoondreamClient();
        const detections: { object: string; count: number }[] = [];
        let allFound = true;
        const forbiddenDetected: string[] = [];

        for (const obj of expectedObjects) {
            try {
                const result = await client.detect(photoUrl, obj);
                detections.push({ object: obj, count: result.count });
                if (result.count === 0) allFound = false;
            } catch {
                detections.push({ object: obj, count: 0 });
                allFound = false;
            }
        }

        for (const obj of forbiddenObjects) {
            try {
                const result = await client.detect(photoUrl, obj);
                if (result.count > 0) forbiddenDetected.push(obj);
            } catch {
                // Ignore detect errors for forbidden checks
            }
        }

        const forbiddenFound = forbiddenDetected.length > 0;
        const passed = allFound && !forbiddenFound;
        const detectedCount = detections.filter(d => d.count > 0).length;
        const totalExpected = expectedObjects.length;
        const confidence = totalExpected > 0
            ? Math.max(0.5, detectedCount / totalExpected)
            : 0.5;

        let reason: string;
        if (!allFound) {
            const missing = detections.filter(d => d.count === 0).map(d => d.object);
            reason = `Missing required objects: ${missing.join(', ')}`;
        } else if (forbiddenFound) {
            reason = `Forbidden objects detected: ${forbiddenDetected.join(', ')}`;
        } else {
            reason = `All required objects detected: ${expectedObjects.join(', ')}`;
        }

        return {
            passed,
            reason,
            confidence,
            provider: 'moondream',
            metadata: { detections, forbiddenDetected }
        };
    }

    private static getPromptForType(
        type: import('../types/ai-verification').VerificationType,
        context?: Record<string, unknown>
    ): string {
        switch (type) {
            case 'OCR':
                return "Extract all visible text from this image. " +
                    "Respond with ONLY valid JSON in this exact format, no other text: " +
                    '{"text": "<extracted text>"}';
            case 'CLASIFICACION':
                const categories = (context?.categories as string[])?.join(', ') || 'Unknown';
                return `Classify this image into exactly one of these categories: [${categories}]. ` +
                    "Respond with ONLY valid JSON in this exact format, no other text: " +
                    '{"category": "<category name>"}';
            case 'DETECCION_OBJETOS':
                const expected = (context?.expectedObjects as string[])?.join(', ') || 'Any';
                return `List all visible objects from this list: [${expected}]. Return as a comma-separated list.`;
            case 'ANALISIS_CALIDAD':
                return "Analyze the quality and cleanliness in this image. " +
                    "Respond with ONLY valid JSON in this exact format, no other text: " +
                    '{"score": <number 1-10>, "defects": ["<defect1>", "<defect2>"], "summary": "<brief summary>"}';
            case 'ANALISIS_SEGURIDAD':
                return "Analyze this image for safety hazards. Check for blocked exits, fire hazards, or unsafe equipment. " +
                    "Respond with ONLY valid JSON in this exact format, no other text: " +
                    '{"is_safe": <true|false>, "hazards": ["<hazard1>", "<hazard2>"], "risk_level": "low"|"medium"|"high"}';
            case 'RECONOCIMIENTO_TEXTOS':
                return "Read the specific label text or numbers shown. Be precise. " +
                    "Respond with ONLY valid JSON in this exact format, no other text: " +
                    '{"text": "<extracted label text or numbers>"}';
            default:
                return "Analyze this image and describe what you see.";
        }
    }

    private static runMock(photoUrl: string) {
        if (photoUrl.includes("fail")) {
            return {
                passed: false,
                reason: "[MOCK] AI Verification Failed (Simulated)",
                details: { confidence: 0.85, provider: 'mock' }
            };
        }
        return {
            passed: true,
            reason: "[MOCK] AI Verification Passed",
            details: { confidence: 0.98, provider: 'mock' }
        };
    }

    /**
     * Verify a photo uploaded via smartlink with automatic retry and escalation logic
     * @param photoUrl URL of the uploaded photo
     * @param rule Verification rule to apply
     * @param context Additional context (instanceId, stepId, etc.)
     */
    static async verifySmartLinkPhoto(
        photoUrl: string,
        rule: VerificationRule,
        context?: {
            instanceId?: string;
            stepId?: string;
            workflowTemplateId?: string;
        }
    ): Promise<SmartLinkVerificationResult> {
        const verificationId = `vrf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        let escalated = false;
        let attempts = 0;
        const maxRetries = rule.maxRetries || 1;
        let lastResult: VerificationResult | null = null;

        while (attempts < maxRetries) {
            try {
                console.log(`[AI] SmartLink verification attempt ${attempts + 1}/${maxRetries} for ${verificationId}`);
                
                lastResult = await VerificationEngine.evaluate(photoUrl, rule);
                
                if (lastResult.success) {
                    console.log(`[AI] SmartLink verification passed on attempt ${attempts + 1}`);
                    return {
                        success: true,
                        verificationId,
                        aiResult: lastResult.aiResult,
                        requiresManualReview: lastResult.requiresManualReview,
                        escalated: false,
                        timestamp: new Date()
                    };
                }

                // If failed but retries remain, continue
                attempts++;
                if (attempts < maxRetries) {
                    // Wait a bit before retry (exponential backoff could be added)
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
} catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AI] SmartLink verification error on attempt ${attempts + 1}:`, errorMessage);
      lastResult = {
        success: false,
        ruleId: rule.id,
        aiResult: {
          passed: false,
          reason: `AI service error: ${errorMessage}`,
          confidence: 0,
          metadata: { error: errorMessage }
        },
        requiresManualReview: true,
        timestamp: new Date()
      };
      attempts++;
    }
        }

        // All retries exhausted or final failure
        const finalResult = lastResult!;
        
        // Determine if escalation is needed
        if (!finalResult.success && rule.requireManualReviewIfFailed) {
            escalated = true;
            console.log(`[AI] SmartLink verification failed, escalation required for ${verificationId}`);
        }

        return {
            success: false,
            verificationId,
            aiResult: finalResult.aiResult,
            requiresManualReview: true,
            escalated,
            timestamp: new Date()
        };
    }
}
