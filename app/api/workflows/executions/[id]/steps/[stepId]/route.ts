import { NextResponse } from "next/server";
import { z } from "zod";
import { WorkflowExecutionService, WorkflowReviewError, type WorkflowReviewErrorCode } from "@/lib/services/workflow-execution-service";
import { isApiError } from "@/lib/api/error";
import { requireExecutionAccess } from "@/lib/workflows/execution-access";
import { emitWorkflowEvent } from "@/lib/websocket/workflow-handlers";
import { StockCountService, STOCK_COUNT_TEMPLATE_NAME } from "@/lib/services/stock-count-service";
import { db } from "@/lib/db";
import { workflowTemplates, workflowInstances } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

const updateStepSchema = z.object({
  value: z.any().optional(),
  evidenceUrl: z.string().optional(),
  comment: z.string().optional(),
  status: z.enum(['COMPLETED', 'SKIPPED', 'FAILED', 'IN_PROGRESS']).optional(),
});

const REVIEW_ERROR_STATUS: Record<WorkflowReviewErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  NOT_REVIEWABLE: 409,
  ALREADY_REVIEWED: 409,
  COMMENT_REQUIRED: 400,
};

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string; stepId: string }> }
) {
    try {
        // Permiso antes del cuerpo: `workflows:update` incluye al EMPLEADO, que
        // es quien ejecuta sus pasos, y excluye a READONLY. El alcance de la
        // instancia lo verifica el servicio, que es donde está el dato.
        const actor = await requireExecutionAccess('update');

        const body = await req.json();
        const data = updateStepSchema.parse(body);
        const { id, stepId } = await params;


    const updatedStep = await WorkflowExecutionService.updateStep(
      id, // Instance ID
      stepId,
      data,
      { kind: 'session', actor, performedBy: actor.userId }
    );

    // Emit real-time event for step update
    emitWorkflowEvent("step_update", {
      executionId: id,
      stepId,
      status: data.status || "UPDATED",
      value: data.value,
      evidenceUrl: data.evidenceUrl,
      comment: data.comment,
      performedBy: actor.userId,
      timestamp: new Date().toISOString(),
    });

    // Check if workflow is complete to emit completion event
    if (data.status === 'COMPLETED') {
      const execution = await WorkflowExecutionService.getExecution(id);
      if (execution?.status === "COMPLETED") {
        emitWorkflowEvent("execution_completed", {
          executionId: id,
          completedAt: new Date().toISOString(),
          performedBy: actor.userId,
        });

        // Check if this is a stock count workflow confirmation
        if (stepId === "confirm-count" && data.value === "yes") {
          const template = await db.select({ name: workflowTemplates.name })
            .from(workflowTemplates)
            .where(sql`${workflowTemplates.id}::text = ${execution.workflowTemplateId}::text`)
            .limit(1);

          if (template.length > 0 && template[0].name === STOCK_COUNT_TEMPLATE_NAME) {
            await StockCountService.completeStockCount(id, actor.userId);
          }
        }
      }
    }

    return NextResponse.json(updatedStep);
    } catch (error) {
        // Un rechazo de alcance trae su status y su mensaje; convertirlo en 500
        // lo volvería indistinguible de una caída.
        if (error instanceof WorkflowReviewError) {
            return NextResponse.json(
                { error: error.message },
                { status: REVIEW_ERROR_STATUS[error.code] }
            );
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error updating step:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
