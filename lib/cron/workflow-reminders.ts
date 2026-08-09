/**
 * Workflow Staggered Reminders Cron Job
 *
 * Sends reminders for workflows at configured intervals before deadline:
 * - 24 hours (1440 minutes) before
 * - 1 hour (60 minutes) before
 * - 30 minutes (30 minutes) before
 *
 * Run frequency: Every 5 minutes to catch 30min reminders
 */

import { db } from '@/lib/db';
import { workflowAssignments, workflowTemplates, workflowInstances } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { NotificationDispatcher } from '@/lib/services/notification-dispatcher';

interface ReminderSent {
  type: '24h' | '1h' | '30min';
  sentAt: string;
}

// Default reminder intervals in minutes
const DEFAULT_REMINDER_INTERVALS = [1440, 60, 30]; // 24h, 1h, 30min

/**
 * Calculate which reminders should be sent for an assignment
 */
function getRemindersToSend(
  dueDate: Date,
  remindersSent: ReminderSent[],
  reminderIntervals: number[]
): ('24h' | '1h' | '30min')[] {
  const now = new Date();
  const timeUntilDue = dueDate.getTime() - now.getTime();
  const minutesUntilDue = Math.floor(timeUntilDue / (1000 * 60));

  const remindersToSend: ('24h' | '1h' | '30min')[] = [];

  // Map interval minutes to reminder type
  const intervalToType: Record<number, '24h' | '1h' | '30min'> = {
    1440: '24h',
    60: '1h',
    30: '30min',
  };

  for (const interval of reminderIntervals) {
    const reminderType = intervalToType[interval];
    if (!reminderType) continue;

    // Check if reminder should be sent (within 5 minutes of target time)
    // and hasn't been sent yet
    const targetWindow = 5; // 5 minute window
    const shouldSend =
      minutesUntilDue <= interval &&
      minutesUntilDue > interval - targetWindow;

    const alreadySent = remindersSent.some(
      (r) => r.type === reminderType
    );

    if (shouldSend && !alreadySent) {
      remindersToSend.push(reminderType);
    }
  }

  return remindersToSend;
}

/**
 * Get hours until due for template variable replacement
 */
function getHoursUntilDue(dueDate: Date): number {
  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60)));
}

/**
 * Send reminder and track it in the database
 */
async function sendReminder(
  assignment: typeof workflowAssignments.$inferSelect,
  reminderType: '24h' | '1h' | '30min',
  templateName: string,
  instanceId: string,
  smartLinkUrl?: string
): Promise<boolean> {
  try {
    const hoursUntilDue = getHoursUntilDue(new Date(assignment.dueDate!));

    // Send notification via dispatcher
    await NotificationDispatcher.sendNotification({
      userId: assignment.assignedTo,
      title: `Recordatorio: ${templateName}`,
      message: `Tu tarea "${templateName}" está por vencer en ${hoursUntilDue} horas.`,
      type: reminderType === '30min' ? 'warning' : 'info',
      eventType: 'workflow_due_soon',
      metadata: {
        workflowName: templateName,
        hoursUntilDue,
        reminderType,
        assignmentId: assignment.id,
        smartLinkUrl,
      },
      actionUrl: `/dashboard/workflows/${instanceId}/execute`,
      actionLabel: 'Ver Tarea',
    });

    console.log(
      `[Cron] ${reminderType} reminder sent for assignment ${assignment.id}`
    );
    return true;
  } catch (error) {
    console.error(
      `[Cron] Failed to send ${reminderType} reminder for assignment ${assignment.id}:`,
      error
    );
    return false;
  }
}

export async function sendWorkflowReminders() {
  try {
    console.log('[Cron] Starting staggered workflow reminders job...');

    const now = new Date();

    // Find assignments that are PENDING and have a due date in the future
    // but within the next 24 hours + 5 minutes buffer
    const maxLookahead = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000);

    const dueSoonAssignments = await db
      .select({
        assignment: workflowAssignments,
      })
      .from(workflowAssignments)
      .where(
        and(
          eq(workflowAssignments.status, 'PENDING'),
          sql`${workflowAssignments.dueDate} IS NOT NULL`,
          sql`${workflowAssignments.dueDate} > ${now}`,
          sql`${workflowAssignments.dueDate} <= ${maxLookahead}`
        )
      );

    console.log(
      `[Cron] Found ${dueSoonAssignments.length} assignments due within 24 hours`
    );

    // Process each assignment
    let remindersSent = 0;
    let errors = 0;

    for (const { assignment } of dueSoonAssignments) {
      try {
        // Bug corregido: el template se resuelve por la instancia, no por el id de
        // la instancia contra workflowTemplates.id (que siempre daba null y el
        // recordatorio salía como "Tarea" con intervalos por defecto).
        const instance = await db.query.workflowInstances.findFirst({
          where: eq(workflowInstances.id, assignment.instanceId),
        });
        const template = instance
          ? await db.query.workflowTemplates.findFirst({
              where: eq(workflowTemplates.id, instance.workflowTemplateId),
            })
          : null;

        // Reutilizar el enlace vigente de la ejecución (plan 4.4): un recordatorio
        // no debe emitir un token nuevo cada vez que corre.
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

        // Parse reminders already sent
        const remindersSentList: ReminderSent[] =
          (assignment.remindersSent as ReminderSent[]) || [];

        // Get configured intervals (or use defaults)
        const reminderIntervals: number[] =
          (template?.reminderIntervals as number[]) || DEFAULT_REMINDER_INTERVALS;

        // Determine which reminders to send
        const remindersToSend = getRemindersToSend(
          new Date(assignment.dueDate!),
          remindersSentList,
          reminderIntervals
        );

        if (remindersToSend.length === 0) {
          continue;
        }

        // Get template name
        const templateName = template?.name || 'Tarea';

        // Send each reminder type
        for (const reminderType of remindersToSend) {
          const sent = await sendReminder(
            assignment,
            reminderType,
            templateName,
            assignment.instanceId,
            smartLinkUrl
          );

          if (sent) {
            // Track that reminder was sent
            const newReminder: ReminderSent = {
              type: reminderType,
              sentAt: new Date().toISOString(),
            };

            await db
              .update(workflowAssignments)
              .set({
                remindersSent: [...remindersSentList, newReminder],
                notifiedAt: new Date(),
              })
              .where(eq(workflowAssignments.id, assignment.id));

            remindersSent++;
          } else {
            errors++;
          }
        }
      } catch (error) {
        console.error(
          `[Cron] Failed to process assignment ${assignment.id}:`,
          error
        );
        errors++;
      }
    }

    console.log(
      `[Cron] Staggered reminders job completed. Sent: ${remindersSent}, Errors: ${errors}`
    );

    return {
      success: true,
      remindersSent,
      errors,
      assignmentsChecked: dueSoonAssignments.length,
    };
  } catch (error) {
    console.error('[Cron] Workflow reminders job failed:', error);
    return {
      success: false,
      error: String(error),
      remindersSent: 0,
      errors: 1,
    };
  }
}

/**
 * Send a specific reminder type manually (for testing or admin purposes)
 */
export async function sendManualReminder(
  assignmentId: string,
  reminderType: '24h' | '1h' | '30min'
): Promise<boolean> {
  try {
    const assignment = await db.query.workflowAssignments.findFirst({
      where: eq(workflowAssignments.id, assignmentId),
    });

    if (!assignment) {
      console.error(`[Manual Reminder] Assignment ${assignmentId} not found`);
      return false;
    }

    const instance = await db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, assignment.instanceId),
    });
    const template = instance
      ? await db.query.workflowTemplates.findFirst({
          where: eq(workflowTemplates.id, instance.workflowTemplateId),
        })
      : null;

    const remindersSentList: ReminderSent[] =
      (assignment.remindersSent as ReminderSent[]) || [];

    // Reutilizar el enlace vigente si existe
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
      console.error(`[Manual Reminder] Failed to resolve smart link for ${assignmentId}:`, linkErr);
    }

    const templateName = template?.name || 'Tarea';
    const sent = await sendReminder(assignment, reminderType, templateName, assignment.instanceId, smartLinkUrl);

    if (sent) {
      const newReminder: ReminderSent = {
        type: reminderType,
        sentAt: new Date().toISOString(),
      };

      await db
        .update(workflowAssignments)
        .set({
          remindersSent: [...remindersSentList, newReminder],
          notifiedAt: new Date(),
        })
        .where(eq(workflowAssignments.id, assignment.id));
    }

    return sent;
  } catch (error) {
    console.error('[Manual Reminder] Failed:', error);
    return false;
  }
}
