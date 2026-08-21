import { NextResponse } from "next/server";
import { z } from "zod";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { emitWorkflowEvent } from "@/lib/websocket/workflow-handlers";
import { auth } from "@/lib/auth";
import { DynamicStepsEmptyError } from "@/lib/workflows/dynamic-steps";

const startExecutionSchema = z.object({
    templateId: z.string(),
    branchId: z.string(),
    sessionId: z.string().optional(),
    categoryValue: z.string().optional(),
});

import { headers } from "next/headers";

// ...

export async function POST(req: Request) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });
        if (!session?.user?.id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        const { templateId, branchId, sessionId, categoryValue } = startExecutionSchema.parse(body);

        // TODO: Check permissions (user belongs to branch/company)

    const execution = await WorkflowExecutionService.createExecution(
      templateId,
      branchId,
      session.user.id,
      sessionId || null,
      categoryValue
    );

    // Emit real-time event for new workflow execution
    emitWorkflowEvent("execution_started", {
      executionId: execution.id,
      templateId,
      branchId,
      sessionId: sessionId || null,
      startedBy: session.user.id,
      startedAt: new Date().toISOString(),
      status: execution.status,
    });

    return NextResponse.json(execution);
    } catch (error) {
        // A10: la plantilla es válida, lo que no hay es contra qué expandirla.
        // 422 con el motivo, no un 500 mudo que el operador no puede accionar.
        if (error instanceof DynamicStepsEmptyError) {
            console.warn("Instancia sin pasos tras expandir:", error.message);
            return NextResponse.json({ error: error.message }, { status: 422 });
        }
        console.error("Error starting execution:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
