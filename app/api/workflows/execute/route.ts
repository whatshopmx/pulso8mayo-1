import { NextResponse } from "next/server";
import { z } from "zod";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { RECEPCION_V3_TEMPLATE_ID, ensureReceivingV3Template } from "@/lib/services/receiving-from-workflow";
import { emitWorkflowEvent } from "@/lib/websocket/workflow-handlers";
import { isApiError } from "@/lib/api/error";
import {
    assertAssigneeAutorizado,
    assertBranchDestino,
    requireExecutionAccess,
} from "@/lib/workflows/execution-access";
import { db } from "@/lib/db";
import { purchaseOrders, workflowTemplates } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
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


// ...

export async function POST(req: Request) {
    try {
        // La puerta abre antes de leer el cuerpo: sin sesión o sin permiso de
        // `workflows:create` no hay nada que el cliente pueda aprovechar (H02 —
        // aquí vivía un `// TODO: Check permissions`).
        const actor = await requireExecutionAccess('create');

        const body = await req.json();
        const { templateId, branchId, sessionId, categoryValue, purchaseId } = startExecutionSchema.parse(body);

        // La plantilla, la sucursal y el responsable se acotan contra la sesión
        // antes de crear nada. `workflow_instances` cuelga de la sucursal y no
        // guarda empresa: sin esta puerta, un id de plantilla y un id de
        // sucursal ajenos arrancaban una ejecución de otro tenant.
        const [plantilla] = await db
            .select({ id: workflowTemplates.id, companyId: workflowTemplates.companyId })
            .from(workflowTemplates)
            .where(and(eq(workflowTemplates.id, templateId), eq(workflowTemplates.companyId, actor.companyId)))
            .limit(1);

        if (!plantilla) {
            return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
        }

        await assertBranchDestino(actor, branchId);
        // El ejecutor es la sesión: `assigneeId` no llega del cliente, y aun así
        // se valida para que la firma no dependa de esa convención.
        await assertAssigneeAutorizado(actor, actor.userId);

        let dynamicCtx: { purchaseId?: string } | undefined;
        if (purchaseId) {
            const [po] = await db.select({
                id: purchaseOrders.id,
                companyId: purchaseOrders.companyId,
                branchId: purchaseOrders.branchId,
                status: purchaseOrders.status,
            })
                .from(purchaseOrders)
                .where(eq(purchaseOrders.id, purchaseId))
                .limit(1);

            if (!po || po.companyId !== actor.companyId) {
                return NextResponse.json(
                    { error: "Orden de compra no encontrada" },
                    { status: 404 }
                );
            }
            // La OC tiene que ser de la sucursal donde arranca la ejecución: si
            // no, se recibiría mercancía de otra sucursal contra esta corrida.
            if (po.branchId !== branchId) {
                return NextResponse.json(
                    { error: "La orden de compra pertenece a otra sucursal" },
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

            // The template v3 must exist in workflow_templates for this
            // company (createExecution reads from the DB, not from the static library).
            await ensureReceivingV3Template(actor.companyId);
        }

    const execution = await WorkflowExecutionService.createExecution(
      templateId,
      branchId,
      actor.userId,
      sessionId || null,
      categoryValue,
      actor.companyId,
      dynamicCtx
    );

    // Emit real-time event for new workflow execution
    emitWorkflowEvent("execution_started", {
      executionId: execution.id,
      templateId,
      branchId,
      sessionId: sessionId || null,
      startedBy: actor.userId,
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
        // Los rechazos de alcance ya traen su status y su mensaje redactado;
        // convertirlos en 500 los haría indistinguibles de una caída.
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error starting execution:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
