
import { NextResponse } from "next/server";
import { z } from "zod";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";

const updateStepSchema = z.object({
    value: z.any().optional(),
    evidenceUrl: z.string().optional(),
    comment: z.string().optional(),
    status: z.enum(['COMPLETED', 'SKIPPED', 'FAILED']).optional(),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ token: string; stepId: string }> }
) {
    try {
        const { token, stepId } = await params;

        // 1. Validate Token
        const context = await SmartLinkService.validateSmartLink(token);

        if (!context || !context.link) {
            return new NextResponse("Invalid or expired link", { status: 403 });
        }

        const body = await req.json();
        const data = updateStepSchema.parse(body);

        // 2. Update Step
        // We use a placeholder user ID effectively acting as the "smart link agent"
        const userId = `smart_link:${token.substring(0, 8)}`;

        const updatedStep = await WorkflowExecutionService.updateStep(
            context.link.instanceId,
            stepId,
            data,
            // El token ya se validó arriba: el contexto es el enlace, no la
            // sesión, y `userId` es un alias sintético, no una persona.
            { kind: "link", performedBy: userId }
        );

        // 3. Mark link as used IF the workflow is fully completed?
        // Actually, smart links might be re-entrant until expiration or explicit completion.
        // For now, we assume re-entrant until expiry.
        // If we wanted one-time use, we'd check if workflow `status` became 'COMPLETED' here.

        return NextResponse.json(updatedStep);
    } catch (error) {
        console.error("Error updating step via smart link:", error);
        if (error instanceof z.ZodError) {
            return new NextResponse("Invalid input data", { status: 400 });
        }
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
