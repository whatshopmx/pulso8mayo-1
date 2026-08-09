import { NextResponse } from "next/server";
import { z } from "zod";
import {
    WorkflowExecutionService,
    WorkflowReviewError,
    type WorkflowReviewErrorCode,
} from "@/lib/services/workflow-execution-service";
import { auth } from "@/lib/auth";
import { emitWorkflowEvent } from "@/lib/websocket/workflow-handlers";

import { headers } from "next/headers";

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
        const session = await auth.api.getSession({
            headers: await headers()
        });
        if (!session?.user?.id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const executionId = (await params).id;

        const execution = await WorkflowExecutionService.getExecution(executionId);

        if (!execution) {
            return new NextResponse("Execution not found", { status: 404 });
        }

        return NextResponse.json(execution);
    } catch (error) {
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
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session?.user?.id || !session.user.companyId) {
            return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
        }

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
            { userId: session.user.id, companyId: session.user.companyId }
        );

        emitWorkflowEvent("execution_reviewed", {
            executionId,
            reviewStatus: parsed.data.reviewStatus,
            reviewedBy: session.user.id,
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

        console.error("Error reviewing execution:", error);
        return NextResponse.json(
            { error: "No pudimos guardar la revisión. Vuelve a intentarlo." },
            { status: 500 }
        );
    }
}
