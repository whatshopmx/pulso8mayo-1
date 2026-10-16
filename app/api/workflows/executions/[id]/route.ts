import { NextResponse } from "next/server";
import { z } from "zod";
import {
    WorkflowExecutionService,
    WorkflowReviewError,
    type WorkflowReviewErrorCode,
} from "@/lib/services/workflow-execution-service";
import { emitWorkflowEvent } from "@/lib/websocket/workflow-handlers";
import { isApiError } from "@/lib/api/error";
import { hasPermission } from "@/lib/permissions";
import {
    assertExecutionInScope,
    requireExecutionAccess,
    requireReviewAccess,
} from "@/lib/workflows/execution-access";

const reviewSchema = z.object({
    reviewStatus: z.enum(["APPROVED", "REJECTED"]),
    reviewComment: z.string().max(2000).optional(),
});

const REVIEW_ERROR_STATUS: Record<WorkflowReviewErrorCode, number> = {
    NOT_FOUND: 404,
    FORBIDDEN: 403,
    NOT_REVIEWABLE: 409,
    ALREADY_REVIEWED: 409,
    COMMENT_REQUIRED: 400,
};

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const actor = await requireExecutionAccess('read');

        const executionId = (await params).id;

        const execution = await WorkflowExecutionService.getExecution(executionId);

        if (!execution) {
            return new NextResponse("Execution not found", { status: 404 });
        }

        // La carga por id no acota nada: la decisión va después, sobre la
        // instancia real. `getExecution` devuelve la fila tal cual (incluye
        // `branchId` y `assigneeId`), así que no hace falta volver a consultarla.
        // "No existe" y "es de otra empresa" responden 404 en ambos casos, para
        // que un id no sirva de sonda sobre el catálogo ajeno.
        await assertExecutionInScope(actor, {
            id: execution.id,
            branchId: execution.branchId,
            assigneeId: execution.assigneeId,
        });

        return NextResponse.json({
            ...execution,
            canRetryCompletionEffects: hasPermission(actor.role, 'workflows', 'update'),
        });
    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error fetching execution:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}

/** Aprobar o rechazar una ejecución completada. */
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // Revisar no es ejecutar. La puerta exige `workflows:update` **y** un rol
        // de supervisory: con `workflows:update` solo, el EMPLEADO —que puede
        // cumplir sus propios pasos— podría aprobar su propio trabajo.
        const actor = await requireReviewAccess();

        const parsed = reviewSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: "La revisión llegó incompleta. Vuelve a intentarlo." },
                { status: 400 }
            );
        }

        const executionId = (await params).id;

        const updated = await WorkflowExecutionService.reviewExecution(
            executionId,
            parsed.data,
            actor
        );

        emitWorkflowEvent("execution_reviewed", {
            executionId,
            reviewStatus: parsed.data.reviewStatus,
            reviewedBy: actor.userId,
            timestamp: new Date().toISOString(),
        });

        return NextResponse.json(updated);
    } catch (error) {
        if (error instanceof WorkflowReviewError) {
            return NextResponse.json(
                { error: error.message },
                { status: REVIEW_ERROR_STATUS[error.code] }
            );
        }

        // El rechazo de la puerta (sin permiso, rol sin poder revisar) llega
        // como ApiError: sin esto salía 500 y el operador veía "error interno"
        // en vez de "tu rol no puede revisar".
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }

        console.error("Error reviewing execution:", error);
        return NextResponse.json(
            { error: "No pudimos guardar la revisión. Vuelve a intentarlo." },
            { status: 500 }
        );
    }
}
