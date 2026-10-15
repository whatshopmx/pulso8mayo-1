/**
 * lib/workflows/ai-config-policy.ts
 *
 * Política autoritativa y pura de configuración de IA para plantillas y ejecuciones (C25 / H07).
 *
 * Define proveedores soportados, validación estricta de configuración, resolución jerárquica
 * (paso > instancia > plantilla > defaults del sistema), semántica de proveedor de respaldo (fallback),
 * límites efectivos de reintentos y sanitización para garantizar que las credenciales nunca viajen
 * al cliente ni se expongan en logs.
 */

export type SupportedAIProvider = "moondream" | "openai" | "cloudflare";

export const SUPPORTED_AI_PROVIDERS: readonly SupportedAIProvider[] = [
    "moondream",
    "openai",
    "cloudflare",
] as const;

export const DEFAULT_AI_PROVIDER: SupportedAIProvider = "moondream";
export const DEFAULT_FALLBACK_PROVIDER: SupportedAIProvider = "cloudflare";
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_ALLOWED_RETRIES = 5;

export interface WorkflowAIConfig {
    provider?: SupportedAIProvider | string;
    fallbackProvider?: SupportedAIProvider | string | "none" | null;
    maxRetries?: number;
    useFallback?: boolean;
}

export interface ResolvedAIConfig {
    provider: SupportedAIProvider;
    fallbackProvider: SupportedAIProvider | null;
    maxRetries: number;
    useFallback: boolean;
}

export const DEFAULT_AI_CONFIG: ResolvedAIConfig = {
    provider: DEFAULT_AI_PROVIDER,
    fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
    maxRetries: DEFAULT_MAX_RETRIES,
    useFallback: true,
};

export class InvalidAIConfigError extends Error {
    readonly code = "INVALID_AI_CONFIG";
    constructor(message: string) {
        super(message);
        this.name = "InvalidAIConfigError";
    }
}

/**
 * Valida autoritativamente un objeto de configuración de IA.
 * Si es inválido, falla de forma explícita arrojando `InvalidAIConfigError`.
 * Si es válido o vacío, devuelve la configuración resuelta y saneada.
 */
export function validateAIConfig(raw?: unknown): ResolvedAIConfig {
    if (raw === undefined || raw === null) {
        return {
            provider: (process.env.AI_PROVIDER_DEFAULT?.toLowerCase() as SupportedAIProvider) || DEFAULT_AI_PROVIDER,
            fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
            maxRetries: DEFAULT_MAX_RETRIES,
            useFallback: true,
        };
    }

    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new InvalidAIConfigError("La configuración de IA debe ser un objeto.");
    }

    const input = raw as Record<string, unknown>;

    // 1. Validar proveedor primario si viene especificado
    let targetProvider: SupportedAIProvider = (process.env.AI_PROVIDER_DEFAULT?.toLowerCase() as SupportedAIProvider) || DEFAULT_AI_PROVIDER;
    if (input.provider !== undefined && input.provider !== null) {
        if (typeof input.provider !== "string" || input.provider.trim() === "") {
            throw new InvalidAIConfigError("El proveedor de IA debe ser una cadena de texto no vacía.");
        }
        const normalized = input.provider.trim().toLowerCase() as SupportedAIProvider;
        if (!SUPPORTED_AI_PROVIDERS.includes(normalized)) {
            throw new InvalidAIConfigError(
                `Proveedor de IA no soportado: "${input.provider}". Proveedores soportados: ${SUPPORTED_AI_PROVIDERS.join(", ")}.`
            );
        }
        targetProvider = normalized;
    }

    // 2. Validar proveedor de respaldo (fallback)
    let targetFallback: SupportedAIProvider | null = null;
    if (input.fallbackProvider !== undefined && input.fallbackProvider !== null && input.fallbackProvider !== "none") {
        if (typeof input.fallbackProvider !== "string" || input.fallbackProvider.trim() === "") {
            throw new InvalidAIConfigError("El proveedor de respaldo de IA debe ser una cadena de texto válida o 'none'.");
        }
        const normalizedFallback = input.fallbackProvider.trim().toLowerCase() as SupportedAIProvider;
        if (!SUPPORTED_AI_PROVIDERS.includes(normalizedFallback)) {
            throw new InvalidAIConfigError(
                `Proveedor de respaldo de IA no soportado: "${input.fallbackProvider}". Proveedores soportados: ${SUPPORTED_AI_PROVIDERS.join(", ")}, o 'none'.`
            );
        }
        targetFallback = normalizedFallback;
    } else if (input.fallbackProvider === undefined) {
        // Default inteligente: Moondream -> Cloudflare -> OpenAI
        if (targetProvider === "moondream") {
            targetFallback = "cloudflare";
        } else if (targetProvider === "cloudflare") {
            targetFallback = "openai";
        } else {
            targetFallback = "cloudflare";
        }
    } else {
        // Explícitamente "none" o null
        targetFallback = null;
    }

    // 3. Validar reintentos máximos (maxRetries)
    let retries = DEFAULT_MAX_RETRIES;
    if (input.maxRetries !== undefined && input.maxRetries !== null) {
        if (typeof input.maxRetries !== "number" || isNaN(input.maxRetries) || !Number.isInteger(input.maxRetries)) {
            throw new InvalidAIConfigError("maxRetries debe ser un número entero.");
        }
        if (input.maxRetries < 0 || input.maxRetries > MAX_ALLOWED_RETRIES) {
            throw new InvalidAIConfigError(`maxRetries debe estar entre 0 y ${MAX_ALLOWED_RETRIES}.`);
        }
        retries = input.maxRetries;
    }

    // 4. Validar useFallback
    const useFallback = input.useFallback === false || targetFallback === null
        ? false
        : Boolean(input.useFallback ?? (targetFallback !== null && targetFallback !== targetProvider));

    return {
        provider: targetProvider,
        fallbackProvider: useFallback ? targetFallback : null,
        maxRetries: retries,
        useFallback,
    };
}

/**
 * Resuelve la configuración efectiva de IA siguiendo la precedencia autoritativa:
 * Paso (stepDef) > Instancia (instance.data.aiConfig) > Plantilla (template.aiConfig) > Defaults
 */
export function resolveStepAiConfig(params: {
    stepDef?: any;
    instance?: any;
    template?: any;
}): ResolvedAIConfig {
    const rawStepConfig = params.stepDef?.aiConfig || params.stepDef?.config?.aiConfig || params.stepDef?.aiValidation;
    const rawInstanceConfig = (params.instance?.data as any)?.aiConfig;
    const rawTemplateConfig = params.template?.aiConfig;

    const merged: Record<string, any> = {};

    if (rawTemplateConfig && typeof rawTemplateConfig === "object" && !Array.isArray(rawTemplateConfig)) {
        Object.assign(merged, rawTemplateConfig);
    }
    if (rawInstanceConfig && typeof rawInstanceConfig === "object" && !Array.isArray(rawInstanceConfig)) {
        Object.assign(merged, rawInstanceConfig);
    }
    if (rawStepConfig && typeof rawStepConfig === "object" && !Array.isArray(rawStepConfig)) {
        Object.assign(merged, rawStepConfig);
    }

    // Garantizar que ninguna clave privada o token se filtre
    delete merged.apiKey;
    delete merged.api_key;
    delete merged.apiToken;
    delete merged.token;
    delete merged.secret;
    delete merged.CLOUDFLARE_API_TOKEN;
    delete merged.OPENAI_API_KEY;
    delete merged.MOONDREAM_API_KEY;

    return validateAIConfig(Object.keys(merged).length > 0 ? merged : undefined);
}

/**
 * Limpia y normaliza cualquier objeto de configuración de IA, garantizando
 * que credenciales o claves nunca viajen al cliente o se expongan.
 */
export function sanitizeAIConfig(raw?: unknown): ResolvedAIConfig {
    const validated = validateAIConfig(raw);
    return {
        provider: validated.provider,
        fallbackProvider: validated.fallbackProvider,
        maxRetries: validated.maxRetries,
        useFallback: validated.useFallback,
    };
}

