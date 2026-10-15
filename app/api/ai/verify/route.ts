import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const verifyRequestSchema = z.object({
  photoUrl: z.string().url("Invalid photo URL"),
  prompt: z.string().min(1, "Prompt is required"),
  provider: z.enum(['moondream', 'openai', 'cloudflare']).optional(),
  fallbackProvider: z.enum(['moondream', 'openai', 'cloudflare', 'none']).nullable().optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  useFallback: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const { photoUrl, prompt, provider, fallbackProvider, maxRetries, useFallback } = verifyRequestSchema.parse(body);

    // Import AI service
    const { AIService } = await import("@/lib/services/ai-service");

    // Perform verification
    const result = await AIService.verifyPhoto(photoUrl, prompt, {
      provider,
      fallbackProvider,
      maxRetries,
      useFallback,
    });

    return NextResponse.json({
      success: result.passed,
      passed: result.passed,
      reason: result.reason,
      details: result.details,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[AI Verification] Error:", error);

    if (error instanceof z.ZodError) {
      return new NextResponse(JSON.stringify({
        error: "Invalid request",
        details: error.issues,
      }), { status: 400 });
    }

    return new NextResponse(JSON.stringify({
      error: "Internal server error",
      message: error.message || "Verification failed",
    }), { status: 500 });
  }
}

export async function GET() {
  return new NextResponse("Method not allowed", { status: 405 });
}
