import { describe, it, expect } from "vitest";
import {
  validateAIConfig,
  resolveStepAiConfig,
  sanitizeAIConfig,
  InvalidAIConfigError,
  DEFAULT_AI_CONFIG,
} from "@/lib/workflows/ai-config-policy";

describe("C25 — ai-config-policy (Políticas de configuración de IA)", () => {
  describe("validateAIConfig", () => {
    it("devuelve la configuración predeterminada cuando se recibe undefined o null", () => {
      const configNull = validateAIConfig(null);
      const configUndefined = validateAIConfig(undefined);

      expect(configNull).toEqual({
        provider: "moondream",
        fallbackProvider: "cloudflare",
        maxRetries: 2,
        useFallback: true,
      });
      expect(configUndefined).toEqual(configNull);
    });

    it("valida y acepta proveedores soportados: moondream, cloudflare, openai", () => {
      const providers = ["moondream", "cloudflare", "openai"] as const;
      for (const p of providers) {
        const validated = validateAIConfig({ provider: p });
        expect(validated.provider).toBe(p);
      }
    });

    it("soporta fallbackProvider 'none' y null, deshabilitando useFallback", () => {
      const cfg1 = validateAIConfig({ provider: "moondream", fallbackProvider: "none" });
      expect(cfg1.fallbackProvider).toBeNull();
      expect(cfg1.useFallback).toBe(false);

      const cfg2 = validateAIConfig({ provider: "cloudflare", fallbackProvider: null });
      expect(cfg2.fallbackProvider).toBeNull();
      expect(cfg2.useFallback).toBe(false);
    });

    it("falla explícitamente arrojando InvalidAIConfigError si el proveedor no está soportado (ej. gemini)", () => {
      expect(() => validateAIConfig({ provider: "gemini" })).toThrow(InvalidAIConfigError);
      try {
        validateAIConfig({ provider: "gemini" });
      } catch (err: any) {
        expect(err).toBeInstanceOf(InvalidAIConfigError);
        expect(err.message).toContain('Proveedor de IA no soportado: "gemini"');
      }
    });

    it("falla si el fallbackProvider no está soportado", () => {
      expect(() => validateAIConfig({ provider: "moondream", fallbackProvider: "anthropic" })).toThrow(InvalidAIConfigError);
      try {
        validateAIConfig({ provider: "moondream", fallbackProvider: "anthropic" });
      } catch (err: any) {
        expect(err).toBeInstanceOf(InvalidAIConfigError);
        expect(err.message).toContain('Proveedor de respaldo de IA no soportado: "anthropic"');
      }
    });

    it("rechaza maxRetries negativos o mayores a 5", () => {
      expect(() => validateAIConfig({ maxRetries: -1 })).toThrow(InvalidAIConfigError);
      expect(() => validateAIConfig({ maxRetries: 6 })).toThrow(InvalidAIConfigError);
      expect(() => validateAIConfig({ maxRetries: 2.5 })).toThrow(InvalidAIConfigError);
    });

    it("rechaza entradas que no sean objetos válidos", () => {
      expect(() => validateAIConfig("invalid")).toThrow(InvalidAIConfigError);
      expect(() => validateAIConfig(123)).toThrow(InvalidAIConfigError);
    });
  });

  describe("resolveStepAiConfig (Resolución jerárquica: Paso > Instancia > Plantilla > Defaults)", () => {
    it("utiliza la configuración predeterminada cuando no hay ninguna definida", () => {
      const resolved = resolveStepAiConfig({});
      expect(resolved.provider).toBe("moondream");
      expect(resolved.fallbackProvider).toBe("cloudflare");
      expect(resolved.maxRetries).toBe(2);
      expect(resolved.useFallback).toBe(true);
    });

    it("prioriza la configuración de la plantilla sobre los defaults", () => {
      const resolved = resolveStepAiConfig({
        template: {
          aiConfig: {
            provider: "cloudflare",
            fallbackProvider: "openai",
            maxRetries: 3,
          },
        },
      });
      expect(resolved.provider).toBe("cloudflare");
      expect(resolved.fallbackProvider).toBe("openai");
      expect(resolved.maxRetries).toBe(3);
    });

    it("prioriza la configuración de la instancia sobre la plantilla", () => {
      const resolved = resolveStepAiConfig({
        template: {
          aiConfig: {
            provider: "cloudflare",
            fallbackProvider: "openai",
            maxRetries: 3,
          },
        },
        instance: {
          data: {
            aiConfig: {
              provider: "openai",
              fallbackProvider: "none",
              maxRetries: 1,
            },
          },
        },
      });
      expect(resolved.provider).toBe("openai");
      expect(resolved.fallbackProvider).toBeNull();
      expect(resolved.useFallback).toBe(false);
      expect(resolved.maxRetries).toBe(1);
    });

    it("prioriza la configuración específica del paso sobre la instancia y plantilla", () => {
      const resolved = resolveStepAiConfig({
        template: {
          aiConfig: {
            provider: "cloudflare",
            fallbackProvider: "openai",
            maxRetries: 3,
          },
        },
        instance: {
          data: {
            aiConfig: {
              provider: "openai",
              fallbackProvider: "none",
              maxRetries: 1,
            },
          },
        },
        stepDef: {
          id: "step-1",
          aiConfig: {
            provider: "moondream",
            fallbackProvider: "cloudflare",
            maxRetries: 0,
          },
        },
      });
      expect(resolved.provider).toBe("moondream");
      expect(resolved.fallbackProvider).toBe("cloudflare");
      expect(resolved.maxRetries).toBe(0);
      expect(resolved.useFallback).toBe(true);
    });

    it("soporta aiValidation como alias de aiConfig en stepDef", () => {
      const resolved = resolveStepAiConfig({
        stepDef: {
          id: "step-1",
          aiValidation: {
            provider: "cloudflare",
            fallbackProvider: "openai",
            maxRetries: 1,
          },
        },
      });
      expect(resolved.provider).toBe("cloudflare");
      expect(resolved.fallbackProvider).toBe("openai");
    });
  });

  describe("sanitizeAIConfig (Seguridad: No exponer credenciales al cliente)", () => {
    it("elimina tokens, llaves API y credenciales de servidor", () => {
      const dirtyConfig = {
        provider: "cloudflare",
        fallbackProvider: "openai",
        maxRetries: 2,
        useFallback: true,
        apiKey: "sk-secret-openai-key-12345",
        apiToken: "cf-secret-token-67890",
        CLOUDFLARE_API_TOKEN: "sensitive-token",
        secret: "super-secret",
      };

      const sanitized = sanitizeAIConfig(dirtyConfig);
      expect(sanitized).toEqual({
        provider: "cloudflare",
        fallbackProvider: "openai",
        maxRetries: 2,
        useFallback: true,
      });
      expect((sanitized as any).apiKey).toBeUndefined();
      expect((sanitized as any).apiToken).toBeUndefined();
      expect((sanitized as any).CLOUDFLARE_API_TOKEN).toBeUndefined();
      expect((sanitized as any).secret).toBeUndefined();
    });
  });
});
