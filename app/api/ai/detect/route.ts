import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const detectRequestSchema = z.object({
  photoUrl: z.string().min(1, "Photo URL is required"),
  object: z.string().min(1, "Object to detect is required"),
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
    const { photoUrl, object } = detectRequestSchema.parse(body);

    const { MoondreamProvider } = await import("@/lib/ai/providers/moondream");

    const apiKey = process.env.MOONDREAM_API_KEY;
    if (!apiKey) {
      return new NextResponse(JSON.stringify({ error: "Moondream API key not configured" }), { status: 500 });
    }

    const provider = new MoondreamProvider({ apiKey });
    const result = await provider.detect(photoUrl, object);

    return NextResponse.json({
      detected: result.count > 0,
      count: result.count,
      objects: result.objects,
    });
  } catch (error: any) {
    console.error("[AI Detect] Error:", error);

    if (error instanceof z.ZodError) {
      return new NextResponse(JSON.stringify({
        error: "Invalid request",
        details: error.issues,
      }), { status: 400 });
    }

    return new NextResponse(JSON.stringify({
      error: "Detection failed",
      message: error.message || "Unknown error",
    }), { status: 500 });
  }
}

export async function GET() {
  return new NextResponse("Method not allowed", { status: 405 });
}
