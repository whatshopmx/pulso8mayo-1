import { WorkflowAssignmentService } from '@/lib/services/workflow-assignment-service';
import { NotificationDispatcher } from '@/lib/services/notification-dispatcher';
import { db } from '@/lib/db';
import { workflowAssignments, workflowInstances, workflowTemplates } from '@/lib/db/schema';
import { and, eq, or, sql } from 'drizzle-orm';

/**
 * Check for overdue assignments
 * Runs every hour
 *
 * Este job fusiona el antiguo cron-overdue-workflows (que también corría cada hora
 * y enviaba el mismo workflow_overdue con carrera de doble notificación):
 * 1. Encuentra asignaciones vencidas (con join a instancia + plantilla)
 * 2. Las marca OVERDUE + isOverdue (para las stats del dashboard)
 * 3. Envía la notificación con nombre real de la tarea y el smart link vigente
 */
export async function checkOverdueAssignments() {
    console.log('[Cron] Starting overdue assignments check...');

    try {
        const now = new Date();

        // Get assignments past due date, with instance + template for the real name
        const overdueAssignments = await db
            .select({
                assignment: workflowAssignments,
                instance: workflowInstances,
                template: workflowTemplates,
            })
            .from(workflowAssignments)
            .leftJoin(
                workflowInstances,
                eq(workflowAssignments.instanceId, workflowInstances.id)
            )
            .leftJoin(
                workflowTemplates,
                eq(workflowInstances.workflowTemplateId, workflowTemplates.id)
            )
            .where(
                and(
                    or(
                        eq(workflowAssignments.status, 'PENDING'),
                        eq(workflowAssignments.status, 'NOTIFIED'),
                        eq(workflowAssignments.status, 'STARTED')
                    ),
                    sql`${workflowAssignments.dueDate} IS NOT NULL`,
                    sql`${workflowAssignments.dueDate} <= ${now}`,
                    eq(workflowAssignments.isOverdue, false)
                )
            );

        console.log(`[Cron] Found ${overdueAssignments.length} overdue assignments`);

        if (overdueAssignments.length === 0) {
            return { success: true, processed: 0 };
        }

        let successCount = 0;
        let errorCount = 0;
        const errors: any[] = [];

        // Process each overdue assignment
        for (const { assignment, instance, template } of overdueAssignments) {
            try {
                console.log(`[Cron] Processing overdue assignment: ${assignment.id}`);

                // Mark as overdue (status + isOverdue para stats del dashboard)
                await WorkflowAssignmentService.markOverdue(assignment.id);
                console.log(`[Cron] Marked assignment ${assignment.id} as overdue`);

                // Reutilizar el enlace vigente de la ejecución (plan 4.4)
                let smartLinkUrl: string | undefined;
                try {
                    const { SmartLinkService } = await import('@/lib/services/smart-link-service');
                    const smartLink = instance
                        ? await SmartLinkService.getOrCreateForInstance(
                              assignment.instanceId,
                              instance.workflowTemplateId,
                              {
                                  sessionId: instance.sessionId,
                                  assignedTo: assignment.assignedTo,
                                  assignmentId: assignment.id,
                              }
                          )
                        : null;
                    smartLinkUrl = smartLink?.url;
                } catch (linkErr) {
                    console.error(`[Cron] Failed to resolve smart link for assignment ${assignment.id}:`, linkErr);
                }

                const workflowName = template?.name || 'Workflow';

                // Send overdue notification
                await NotificationDispatcher.sendNotification({
                    userId: assignment.assignedTo,
                    title: '⚠️ Tarea Vencida',
                    message: `Tarea VENCIDA: ${workflowName}`,
                    type: 'error',
                    eventType: 'workflow_overdue',
                    actionUrl: instance
                        ? `/dashboard/workflows/${instance.id}/execute`
                        : undefined,
                    actionLabel: 'Completar Urgente',
                    metadata: {
                        workflowName,
                        overdueTime: assignment.dueDate
                            ? `desde ${new Date(assignment.dueDate).toLocaleDateString('es-MX')}`
                            : 'hace poco',
                        smartLinkUrl,
                    },
                });
                console.log(`[Cron] Sent overdue notification for assignment ${assignment.id}`);

                successCount++;

            } catch (error) {
                console.error(`[Cron] Failed to process overdue assignment ${assignment.id}:`, error);
                errorCount++;
                errors.push({
                    assignmentId: assignment.id,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        console.log(`[Cron] Overdue check complete. Success: ${successCount}, Errors: ${errorCount}`);

        return {
            success: true,
            processed: successCount,
            errors: errorCount,
            details: errors,
        };

    } catch (error) {
        console.error('[Cron] Fatal error in checkOverdueAssignments:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}