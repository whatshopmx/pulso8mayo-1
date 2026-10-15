export enum VerificationType {
    OCR = 'OCR',
    CLASIFICACION = 'CLASIFICACION',
    DETECCION_OBJETOS = 'DETECCION_OBJETOS',
    RECONOCIMIENTO_TEXTOS = 'RECONOCIMIENTO_TEXTOS',
    ANALISIS_CALIDAD = 'ANALISIS_CALIDAD',
    ANALISIS_SEGURIDAD = 'ANALISIS_SEGURIDAD',
    PRESENCIA_ELEMENTOS = 'PRESENCIA_ELEMENTOS'
}

export type VerificationVerdictCode =
    | 'AUTO_APPROVED'
    | 'MANUAL_REVIEW_REQUIRED'
    | 'CONFIDENCE_BELOW_MINIMUM'
    | 'QUALITY_CRITERIA_FAILED'
    | 'SAFETY_HAZARD_DETECTED'
    | 'MISSING_REQUIRED_OBJECTS'
    | 'FORBIDDEN_OBJECTS_DETECTED'
    | 'AI_CRITERIA_FAILED'
    | 'INVALID_AI_RESPONSE';

export interface VerificationRule {
    id?: string;
    verificationType?: VerificationType;
    type?: VerificationType; // Compatibility alias
    expectedObjects?: string[]; // For Object Detection
    requiredElements?: string[]; // Compatibility alias
    forbiddenObjects?: string[]; // For Safety/Compliance
    minConfidence?: number; // 0.0 to 1.0 (defaults to 0.85)
    expectedConfidence?: number; // Compatibility alias
    autoApprove?: boolean; // If passed, skip human review?
    requireManualReviewIfFailed?: boolean;
    maxRetries?: number;
    customPrompt?: string; // Optional override
    prompt?: string;
    name?: string;
    description?: string;
}

export interface BBox {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
}

export interface AIAnalysisResult {
    passed: boolean;
    reason: string;
    confidence: number;
    detectedObjects?: string[];
    detectedText?: string;
    classification?: string;
    detections?: { object: string; bbox?: BBox; count?: number }[];
    caption?: string;
    metadata?: Record<string, any>;
    provider?: string;
}

export interface VerificationResult {
    success: boolean;
    ruleId?: string;
    aiResult: AIAnalysisResult;
    requiresManualReview: boolean;
    decisionRule: VerificationVerdictCode;
    minConfidence: number;
    timestamp: Date;
}
