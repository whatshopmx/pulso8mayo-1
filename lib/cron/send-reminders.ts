import { db } from '@/lib/db';
import { workflowAssignments, workflowInstances, workflowTemplates } from '@/lib/db/schema';
import { and, gte, lte, or, eq } from 'drizzle-orm';
import { NotificationDispatcher } from '@/lib/services/notification-dispatcher';

/**
 * Send due soon reminders
 * Runs daily at 8:00 AM
 * 
 * This job:
 * 1. Finds assignments due in the next 24 hours
 * 2. Sends reminder notifications
 */
export async function sendDueSoonReminders() {
    console.log('[Cron] Starting due soon reminders...');

    try {
        const now = new Date();
        const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Get assignments due in next 24 hours
        const dueSoonAssignments = await db
            .select()
            .from(workflowAssignments)
            .where(
                and(
                    or(
                        eq(workflowAssignments.status, 'PENDING'),
                        eq(workflowAssignments.status, 'NOTIFIED'),
                        eq(workflowAssignments.status, 'STARTED')
                    ),
                    gte(workflowAssignments.dueDate, now),
                    lte(workflowAssignments.dueDate, in24Hours),
                    eq(workflowAssignments.isOverdue, false)
                )
            );

        console.log(`[Cron] Found ${dueSoonAssignments.length} assignments due soon`);

        if (dueSoonAssignments.length === 0) {
            return { success: true, sent: 0 };
        }

        let successCount = 0;
        let errorCount = 0;
        const errors: any[] = [];

        // Send reminders
        for (const assignment of dueSoonAssignments) {
            try {
                console.log(`[Cron] Sending reminder for assignment: ${assignment.id}`);

        // Resolver instancia + plantilla para el nombre real (antes salía
        // "Tarea VENCIDA: undefined" porque workflowAssignments no tiene
        // workflowTemplateId).
        const instance = await db.query.workflowInstances.findFirst({
          where: eq(workflowInstances.id, assignment.instanceId),
        });
        const template = instance
          ? await db.query.workflowTemplates.findFirst({
              where: eq(workflowTemplates.id, instance.workflowTemplateId),
            })
          : null;
        const templateName = template?.name || 'Workflow';

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

        const dueDate = assignment.dueDate ? new Date(assignment.dueDate) : null;
        const hoursUntilDue = dueDate
          ? Math.round((dueDate.getTime() - Date.now()) / (1000 * 60 * 60))
          : 0;

        await NotificationDispatcher.sendNotification({
          userId: assignment.assignedTo,
          title: 'Tarea Por Vencer',
          message: `Tarea pendiente vence en ${hoursUntilDue} horas`,
          type: 'warning',
          eventType: 'workflow_due_soon',
          actionUrl: `/dashboard/workflows/${assignment.instanceId}/execute`,
          actionLabel: 'Completar Ahora',
          metadata: {
            workflowName: templateName,
            hoursUntilDue,
            dueDate: assignment.dueDate?.toISOString(),
            smartLinkUrl,
          },
        });
                console.log(`[Cron] Reminder sent for assignment ${assignment.id}`);

                successCount++;

            } catch (error) {
                console.error(`[Cron] Failed to send reminder for assignment ${assignment.id}:`, error);
                errorCount++;
                errors.push({
                    assignmentId: assignment.id,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        console.log(`[Cron] Reminders complete. Success: ${successCount}, Errors: ${errorCount}`);

        return {
            success: true,
            sent: successCount,
            errors: errorCount,
            details: errors,
        };

    } catch (error) {
        console.error('[Cron] Fatal error in sendDueSoonReminders:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
