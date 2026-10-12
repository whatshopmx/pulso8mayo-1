
import { NextRequest, NextResponse } from "next/server";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { emitWorkflowEvent } from "@/lib/websocket/workflow-handlers";
import { z } from "zod";
import { isApiError } from "@/lib/api/error";

const updateStepSchema = z.object({
    stepId: z.string(),
    value: z.any().optional(),
    evidenceUrl: z.string().optional(), // Can contain single URL or JSON stringified array
    comment: z.string().optional(),
    status: z.enum(['COMPLETED', 'SKIPPED', 'FAILED', 'IN_PROGRESS']),
});

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await context.params;

        if (!token) {
            return new NextResponse("Token required", { status: 400 });
        }

        // 1. Validate Token
        const linkData = await SmartLinkService.validateSmartLink(token);
        if (!linkData) {
            return new NextResponse("Invalid or expired token", { status: 404 });
        }

        const body = await req.json();
        const { stepId, value, evidenceUrl, comment, status } = updateStepSchema.parse(body);

        // 2. Update Step
        // We use the 'sessionId' or a placeholder as the userId since this is a public link execution
        const performedBy = linkData.link.sessionId || "public-link-user";

    const result = await WorkflowExecutionService.updateStep(
      linkData.instance.id,
      stepId,
      { value, evidenceUrl, comment, status },
      // `validateSmartLink` ya respondió por esta instancia: el contexto es el
      // token, no la sesión, y `performedBy` no es una persona.
      { kind: "link", performedBy }
    );

    // 3. Emit real-time event for step update
    const stepUpdateData = {
      executionId: linkData.instance.id,
      stepId,
      status,
      value,
      evidenceUrl,
      comment,
      performedBy,
      timestamp: new Date().toISOString(),
    };

    emitWorkflowEvent("step_update", stepUpdateData);

    // 4. Check if workflow is complete to emit completion event
    const updatedExecution = await WorkflowExecutionService.getExecution(linkData.instance.id);
    if (updatedExecution?.status === "COMPLETED") {
      emitWorkflowEvent("execution_completed", {
        executionId: linkData.instance.id,
        completedAt: new Date().toISOString(),
        performedBy,
      });
    }

    return NextResponse.json(result);

    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error updating public workflow step:", error);
        if (error instanceof z.ZodError) {
            return new NextResponse("Invalid input", { status: 400 });
        }
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
