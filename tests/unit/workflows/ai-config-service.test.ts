import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AIService } from "@/lib/services/ai-service";
import { VerificationEngine } from "@/lib/services/verification-engine";
import { InvalidAIConfigError } from "@/lib/workflows/ai-config-policy";
import { VerificationType } from "@/lib/types/ai-verification";

describe("C25 — AIService & VerificationEngine con configuración de IA y fallback", () => {
  beforeEach(() => {
    AIService.resetClients();
  });

  afterEach(() => {
    AIService.resetClients();
    vi.restoreAllMocks();
  });

  describe("AIService.verifyPhoto con adaptadores mockeados", () => {
    it("utiliza el proveedor primario configurado (moondream) cuando responde exitosamente", async () => {
      const mockMoondream = {
        analyzeImage: vi.fn().mockResolvedValue({
          isCompliant: true,
          confidence: 0.95,
          description: "Cumple con las normas NOM-251",
          rawResponse: { model: "moondream-v2" },
        }),
      };
      const mockCloudflare = {
        analyzeImage: vi.fn(),
      };
      const mockOpenAI = {
        analyzeImage: vi.fn(),
      };

      AIService.setMoondreamClient(mockMoondream);
      AIService.setCloudflareClient(mockCloudflare);
      AIService.setOpenAIClient(mockOpenAI);

      const result = await AIService.verifyPhoto("https://cdn.example.com/photo.jpg", "Verificar limpieza", {
        provider: "moondream",
        fallbackProvider: "cloudflare",
        maxRetries: 1,
      });

      expect(mockMoondream.analyzeImage).toHaveBeenCalledTimes(1);
      expect(mockCloudflare.analyzeImage).not.toHaveBeenCalled();
      expect(mockOpenAI.analyzeImage).not.toHaveBeenCalled();
      expect(result.passed).toBe(true);
      expect(result.details?.provider).toBe("moondream");
      expect(result.details?.usedFallback).toBeUndefined();
    });

    it("utiliza Cloudflare Workers AI cuando está configurado como proveedor primario", async () => {
      const mockCloudflare = {
        analyzeImage: vi.fn().mockResolvedValue({
          isCompliant: true,
          confidence: 0.92,
          description: "Inspección exitosa con Llama 3.2 Vision",
          rawResponse: { model: "@cf/meta/llama-3.2-11b-vision-instruct" },
        }),
      };
      AIService.setCloudflareClient(mockCloudflare);

      const result = await AIService.verifyPhoto("https://cdn.example.com/photo.jpg", "Verificar equipo", {
        provider: "cloudflare",
        fallbackProvider: "none",
        maxRetries: 0,
      });

      expect(mockCloudflare.analyzeImage).toHaveBeenCalledTimes(1);
      expect(result.passed).toBe(true);
      expect(result.details?.provider).toBe("cloudflare");
    });

    it("activa proveedor de respaldo (fallback: cloudflare) si el primario (moondream) falla", async () => {
      const mockMoondream = {
        analyzeImage: vi.fn().mockRejectedValue(new Error("Moondream API timeout / 503")),
      };
      const mockCloudflare = {
        analyzeImage: vi.fn().mockResolvedValue({
          isCompliant: true,
          confidence: 0.89,
          description: "Respaldo exitoso en Cloudflare Workers AI",
          rawResponse: { model: "@cf/meta/llama-3.2-11b-vision-instruct" },
        }),
      };

      AIService.setMoondreamClient(mockMoondream);
      AIService.setCloudflareClient(mockCloudflare);

      const result = await AIService.verifyPhoto("https://cdn.example.com/photo.jpg", "Verificar extintor", {
        provider: "moondream",
        fallbackProvider: "cloudflare",
        maxRetries: 1, // Intentará primario y luego fallback
      });

      expect(mockMoondream.analyzeImage).toHaveBeenCalledTimes(2); // intento inicial + 1 retry
      expect(mockCloudflare.analyzeImage).toHaveBeenCalledTimes(1);
      expect(result.passed).toBe(true);
      expect(result.details?.provider).toBe("cloudflare");
      expect(result.details?.usedFallback).toBe(true);
      expect(result.details?.primaryProvider).toBe("moondream");
    });

    it("no ejecuta fallback si fallbackProvider es 'none' o useFallback es false", async () => {
      const mockMoondream = {
        analyzeImage: vi.fn().mockRejectedValue(new Error("Conexión rechazada")),
      };
      const mockCloudflare = {
        analyzeImage: vi.fn(),
      };

      AIService.setMoondreamClient(mockMoondream);
      AIService.setCloudflareClient(mockCloudflare);

      const result = await AIService.verifyPhoto("https://cdn.example.com/photo.jpg", "Verificar señalética", {
        provider: "moondream",
        fallbackProvider: "none",
        maxRetries: 0,
      });

      expect(mockMoondream.analyzeImage).toHaveBeenCalledTimes(1);
      expect(mockCloudflare.analyzeImage).not.toHaveBeenCalled();
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("AI Error: Conexión rechazada");
    });

    it("arroja InvalidAIConfigError explícitamente sin hacer llamadas si el proveedor no es válido", async () => {
      const mockMoondream = { analyzeImage: vi.fn() };
      AIService.setMoondreamClient(mockMoondream);

      await expect(
        AIService.verifyPhoto("https://cdn.example.com/photo.jpg", "Verificar", {
          provider: "unsupported_llm" as any,
        })
      ).rejects.toThrow(InvalidAIConfigError);

      expect(mockMoondream.analyzeImage).not.toHaveBeenCalled();
    });

    it("no filtra secretos ni variables de entorno en los detalles del resultado", async () => {
      const mockCloudflare = {
        analyzeImage: vi.fn().mockResolvedValue({
          isCompliant: true,
          confidence: 0.99,
          description: "Aprobado",
          rawResponse: {},
        }),
      };
      AIService.setCloudflareClient(mockCloudflare);

      const result = await AIService.verifyPhoto("https://cdn.example.com/photo.jpg", "Verificar", {
        provider: "cloudflare",
        fallbackProvider: "openai",
        maxRetries: 0,
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("API_KEY");
      expect(serialized).not.toContain("API_TOKEN");
      expect(serialized).not.toContain("SECRET");
    });
  });

  describe("VerificationEngine.evaluate con aiConfig", () => {
    it("propaga aiConfig a performVerification y retorna el proveedor en metadata", async () => {
      const mockCloudflare = {
        analyzeImage: vi.fn().mockResolvedValue({
          isCompliant: true,
          confidence: 0.93,
          description: "Cofia y mandil colocados correctamente",
          rawResponse: { model: "@cf/meta/llama-3.2-11b-vision-instruct" },
        }),
      };
      AIService.setCloudflareClient(mockCloudflare);

      const rule = {
        id: "rule-higiene",
        name: "Higiene de Personal",
        description: "Verificar uniforme completo",
        type: VerificationType.PRESENCIA_ELEMENTOS,
        prompt: "Verificar si el empleado porta cofia y mandil",
        expectedConfidence: 0.85,
        requiredElements: ["cofia", "mandil"],
      };

      const result = await VerificationEngine.evaluate(
        "https://cdn.example.com/uniforme.jpg",
        rule,
        {
          provider: "cloudflare",
          fallbackProvider: "openai",
          maxRetries: 0,
        }
      );

      expect(mockCloudflare.analyzeImage).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.aiResult.passed).toBe(true);
      expect(result.aiResult.provider).toBe("cloudflare");
      expect(result.aiResult.metadata?.provider).toBe("cloudflare");
    });
  });
});
