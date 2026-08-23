import { NextResponse } from "next/server";
import { z } from "zod";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { RECEPCION_V3_TEMPLATE_ID, ensureReceivingV3Template } from "@/lib/services/receiving-from-workflow";
import { emitWorkflowEvent } from "@/lib/websocket/workflow-handlers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { purchaseOrders, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DynamicStepsEmptyError } from "@/lib/workflows/dynamic-steps";

const startExecutionSchema = z.object({
    templateId: z.string(),
    branchId: z.string(),
    sessionId: z.string().optional(),
    categoryValue: z.string().optional(),
    // Recepción de mercancía v3: la OC se elige al lanzar y define los pasos dinámicos.
    purchaseId: z.string().uuid().optional(),
});

// Estatus desde los cuales tiene sentido recibir mercancía contra la OC.
const RECEIVABLE_PO_STATUS = new Set(["APPROVED", "SENT", "PARTIALLY_RECEIVED"]);

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
        const { templateId, branchId, sessionId, categoryValue, purchaseId } = startExecutionSchema.parse(body);

        // TODO: Check permissions (user belongs to branch/company)

        let dynamicCtx: { purchaseId?: string } | undefined;
        if (purchaseId) {
            const [user] = await db.select({ companyId: users.companyId })
                .from(users)
                .where(eq(users.id, session.user.id))
                .limit(1);

            const [po] = await db.select({
                id: purchaseOrders.id,
                companyId: purchaseOrders.companyId,
                branchId: purchaseOrders.branchId,
                status: purchaseOrders.status,
            })
                .from(purchaseOrders)
                .where(eq(purchaseOrders.id, purchaseId))
                .limit(1);

            if (!po || po.companyId !== user?.companyId) {
                return NextResponse.json(
                    { error: "Orden de compra no encontrada" },
                    { status: 404 }
                );
            }
            if (!RECEIVABLE_PO_STATUS.has(po.status)) {
                return NextResponse.json(
                    { error: `La orden de compra está en estatus ${po.status}: no se puede recibir` },
                    { status: 422 }
                );
            }

            dynamicCtx = { purchaseId };

            // El template v3 debe existir en workflow_templates para esta
            // compañía (createExecution lee de BD, no de la librería estática).
            await ensureReceivingV3Template(user.companyId);
        }

    const execution = await WorkflowExecutionService.createExecution(
      templateId,
      branchId,
      session.user.id,
      sessionId || null,
      categoryValue,
      undefined,
      dynamicCtx
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
