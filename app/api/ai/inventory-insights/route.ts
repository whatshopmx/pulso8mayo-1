import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const questionSchema = z.object({
  question: z.string().min(3, "La pregunta debe tener al menos 3 caracteres"),
  branchId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const { question, branchId } = questionSchema.parse(body);
    const companyId = session.user.companyId;
    if (!companyId) {
      return new NextResponse(JSON.stringify({ error: "No company found" }), { status: 400 });
    }

    const { IntelligenceService } = await import("@/lib/services/intelligence-service");
    const result = await IntelligenceService.answerQuestion({
      question,
      companyId,
      branchId,
    });

    return NextResponse.json({
      answer: result.answer,
      data: result.data,
      sources: result.sources,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Inventory Insights] Error:", error);

    if (error instanceof z.ZodError) {
      return new NextResponse(JSON.stringify({
        error: "Invalid request",
        details: error.issues,
      }), { status: 400 });
    }

    return new NextResponse(JSON.stringify({
      error: "Internal server error",
      message: error.message || "Insights failed",
    }), { status: 500 });
  }
}
