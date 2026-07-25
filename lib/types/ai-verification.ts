export enum VerificationType {
    OCR = 'OCR',
    CLASIFICACION = 'CLASIFICACION',
    DETECCION_OBJETOS = 'DETECCION_OBJETOS',
    RECONOCIMIENTO_TEXTOS = 'RECONOCIMIENTO_TEXTOS',
    ANALISIS_CALIDAD = 'ANALISIS_CALIDAD',
    ANALISIS_SEGURIDAD = 'ANALISIS_SEGURIDAD'
}

export interface VerificationRule {
    id?: string;
    verificationType: VerificationType;
    expectedObjects?: string[]; // For Object Detection
    forbiddenObjects?: string[]; // For Safety/Compliance
    minConfidence: number; // 0.0 to 1.0 (defaults to 0.85)
    autoApprove?: boolean; // If passed, skip human review?
    requireManualReviewIfFailed?: boolean;
    maxRetries?: number;
    customPrompt?: string; // Optional override
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
    detections?: { object: string; bbox: BBox }[];
    caption?: string;
    metadata?: Record<string, any>;
    provider?: string;
}

export interface VerificationResult {
    success: boolean;
    ruleId?: string;
    aiResult: AIAnalysisResult;
    requiresManualReview: boolean;
    timestamp: Date;
}
