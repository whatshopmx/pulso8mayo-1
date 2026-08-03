import { NextRequest, NextResponse } from "next/server";
import { WhatsAppService } from "@/lib/services/whatsapp-service";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { WorkflowTemplateService } from "@/lib/services/workflow-template-service";
import { db } from "@/lib/db";
import { workflowInstances, workflowInstanceSteps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/whatsapp/receive-photo
 * 
 * Handle incoming photo from WhatsApp and trigger AI verification.
 * NOTE: This is a webhook called by Wasender. It does NOT use session auth.
 * TODO: Add Wasender webhook signature verification before processing.
 * 
 * Request body (from WhatsApp webhook):
 * - from: Phone number
 * - photoUrl: URL of uploaded photo
 * - caption: Optional caption text
 * - sessionId: WhatsApp session ID
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { from, photoUrl, caption, sessionId } = body;

        console.log(`[WhatsApp] Received photo from ${from}:`, { photoUrl, caption });

        if (!from || !photoUrl) {
            return NextResponse.json(
                { error: "Missing required fields: from, photoUrl" },
                { status: 400 }
            );
        }

        // 1. Find user by phone number
        const { users } = await import("@/lib/db/schema");
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.phone, from))
            .limit(1);

        if (!user) {
            // User not found, send error message
            await WhatsAppService.sendMessage(
                from,
                "❌ No te encontramos en nuestro sistema. Por favor contacta a tu supervisor."
            );
            return NextResponse.json({ success: false, error: "User not found" });
        }

        // 2. Find pending workflow instance for this user
        const [instance] = await db
            .select()
            .from(workflowInstances)
            .where(
                eq(workflowInstances.assigneeId, user.id)
            )
            .orderBy(workflowInstances.createdAt)
            .limit(1);

        if (!instance) {
            await WhatsAppService.sendMessage(
                from,
                "✅ Foto recibida. No tienes tareas pendientes en este momento."
            );
            return NextResponse.json({ success: true, message: "No pending workflows" });
        }

        // 3. Get current step
        const steps = await db
            .select()
            .from(workflowInstanceSteps)
            .where(eq(workflowInstanceSteps.instanceId, instance.id))
            .orderBy(workflowInstanceSteps.id);

        const currentStep = steps.find(s => s.status === 'PENDING') || steps[steps.length - 1];

        if (!currentStep) {
            await WhatsAppService.sendMessage(
                from,
                "✅ Foto recibida. Tu tarea ya está completa."
            );
            return NextResponse.json({ success: true, message: "Workflow completed" });
        }

        // 4. Get verification rule from workflow template
        const template = await WorkflowTemplateService.getTemplate(instance.workflowTemplateId);
        const templateSteps = template?.steps as any[] || [];
        const currentTemplateStep = templateSteps.find(s => s.id === currentStep.stepId);
        
        const verificationRule = currentTemplateStep?.verificationRule;

        // 5. If step requires AI verification, trigger it
        if (verificationRule) {
            // Generate smartlink for this verification
            const smartLink = await SmartLinkService.createSmartLink(
                instance.id,
                instance.workflowTemplateId,
                instance.sessionId || user.id
            );

            // Call AI verification endpoint
            const verificationResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/workflows/verify-ai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: smartLink.token,
                    photoUrl,
                    stepId: currentStep.id,
                    rule: verificationRule
                })
            });

            const verificationResult = await verificationResponse.json();

            // 6. Send response based on verification result
            if (verificationResult.success) {
                await WhatsAppService.sendMessage(
                    from,
                    `✅ ¡Verificación exitosa!\n\n${verificationResult.verification.aiResult.reason}\n\nTu tarea ha sido completada.`
                );
            } else if (verificationResult.escalated) {
                await WhatsAppService.sendMessage(
                    from,
                    `⚠️ Verificación fallida\n\n${verificationResult.verification.aiResult.reason}\n\nUn supervisor revisará tu evidencia. Te notificaremos cuando haya una resolución.`
                );
            } else {
                await WhatsAppService.sendMessage(
                    from,
                    `❌ Verificación fallida\n\n${verificationResult.verification.aiResult.reason}\n\nPor favor toma otra foto e inténtalo de nuevo.`
                );
            }

            return NextResponse.json({
                success: verificationResult.success,
                verification: verificationResult.verification,
                escalated: verificationResult.escalated
            });
        }

        // 7. If no AI verification required, just save the photo
        await db
            .update(workflowInstanceSteps)
            .set({
                value: { photoUrl, caption },
                evidenceUrl: photoUrl,
                completedAt: new Date(),
                status: 'COMPLETED'
            })
            .where(eq(workflowInstanceSteps.id, currentStep.id));

        await WhatsAppService.sendMessage(
            from,
            "✅ Foto recibida y guardada correctamente."
        );

        return NextResponse.json({ success: true, message: "Photo saved" });

    } catch (error: any) {
        console.error('[WhatsApp] Error processing photo:', error);
        return NextResponse.json(
            { error: `Failed to process photo: ${error.message}` },
            { status: 500 }
        );
    }
}
