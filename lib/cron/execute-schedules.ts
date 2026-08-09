import { WorkflowScheduleService } from '@/lib/services/workflow-schedule-service';
import { WorkflowAssignmentService, NO_SUITABLE_USER_ERROR } from '@/lib/services/workflow-assignment-service';
import { db } from '@/lib/db';
import { workflowSchedules, workflowInstances, branches } from '@/lib/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { localDayRangeUtc } from '@/lib/workflows/today';

type DueSchedule = typeof workflowSchedules.$inferSelect;

/**
 * Idempotencia mínima (plan 5.1): ¿ya existe una ejecución de este schedule
 * dentro del día local de la sucursal? Misma consulta que WorkflowTodayService.
 */
async function alreadyExecutedToday(schedule: DueSchedule): Promise<boolean> {
    const [branch] = await db
        .select({ timezone: branches.timezone })
        .from(branches)
        .where(eq(branches.id, schedule.branchId))
        .limit(1);

    const { start } = localDayRangeUtc(new Date(), branch?.timezone);

    const [existing] = await db
        .select({ id: workflowInstances.id })
        .from(workflowInstances)
        .where(
            and(
                eq(workflowInstances.scheduleId, schedule.id),
                gte(workflowInstances.createdAt, start)
            )
        )
        .limit(1);

    return !!existing;
}

/**
 * Avanza lastExecutedAt/nextExecutionAt/executionCount de un schedule.
 * Se usa tanto tras ejecutar como cuando el dedup de 5.1 salta la ejecución.
 */
async function advanceSchedule(schedule: DueSchedule): Promise<void> {
    const nextExecution = WorkflowScheduleService.calculateNextExecution({
        frequency: schedule.frequency,
        dayOfWeek: schedule.dayOfWeek,
        dayOfMonth: schedule.dayOfMonth,
        timeOfDay: schedule.timeOfDay,
        startDate: schedule.startDate,
    });

    await db
        .update(workflowSchedules)
        .set({
            lastExecutedAt: new Date(),
            nextExecutionAt: nextExecution,
            executionCount: sql`${workflowSchedules.executionCount} + 1`,
            updatedAt: new Date(),
        })
        .where(eq(workflowSchedules.id, schedule.id));
}

/**
 * Execute scheduled workflows
 * Runs every 5 minutes
 * 
 * This job:
 * 1. Finds schedules due for execution
 * 2. Creates workflow instances
 * 3. Creates assignments
 * 4. Sends notifications
 * 5. Updates schedule next execution time
 */
export async function executeScheduledWorkflows() {
    console.log('[Cron] Starting scheduled workflow execution...');

    try {
        // Get schedules due for execution
        const dueSchedules = await WorkflowScheduleService.getSchedulesDueForExecution();

        console.log(`[Cron] Found ${dueSchedules.length} schedules due for execution`);

        if (dueSchedules.length === 0) {
            return { success: true, executed: 0 };
        }

        let successCount = 0;
        let errorCount = 0;
        const errors: any[] = [];

        // Process each schedule
        for (const schedule of dueSchedules) {
            // Existe para el caso 5.2: si la asignación falla sin destinatario, el
            // catch necesita el id de la ejecución ya creada para avisar al gerente.
            let createdInstanceId: string | null = null;

            try {
                console.log(`[Cron] Executing schedule: ${schedule.id} - ${schedule.title}`);

                // Idempotencia mínima (plan 5.1): si el cron reintenta tras un
                // fallo parcial, no duplicar ejecución + asignación + enlace. Pero
                // sí avanzamos nextExecutionAt para no quedar atrapado en "due".
                if (await alreadyExecutedToday(schedule)) {
                    console.log(`[Cron] Schedule ${schedule.id} already executed today, advancing nextExecutionAt`);
                    await advanceSchedule(schedule);
                    continue;
                }

                // Create workflow instance
                const instance = await WorkflowScheduleService.executeSchedule(schedule.id);
                createdInstanceId = instance.id;
                console.log(`[Cron] Created workflow instance: ${instance.id}`);

                // Create assignment
                const assignment = await WorkflowAssignmentService.autoAssignWorkflow(
                    instance.id,
                    schedule
                );
                console.log(`[Cron] Created assignment: ${assignment.id} for user: ${assignment.assignedTo}`);

                // La notificación ya la envía assignWorkflow con el smart link y la
                // voz correcta (capacitación vs. tarea). El envío extra que había
                // aquí duplicaba el WhatsApp/email/in-app para todo flujo programado.
                console.log(`[Cron] Assignment ${assignment.id} notified (via assignWorkflow): ${assignment.assignedTo}`);

                // Update schedule
                await advanceSchedule(schedule);

                console.log(`[Cron] Updated schedule, next execution: ${schedule.nextExecutionAt}`);
                successCount++;

            } catch (error) {
                // Plan 5.2: la programación no encontró destinatario. La ejecución
                // quedó creada sin asignar y nadie recibió WhatsApp — avisar al
                // gerente de la sucursal para que asigne a mano o ajuste el horario.
                if (
                    error instanceof Error &&
                    error.message === NO_SUITABLE_USER_ERROR &&
                    createdInstanceId
                ) {
                    await WorkflowAssignmentService.notifyManagerUnassigned(schedule, createdInstanceId);
                }

                console.error(`[Cron] Failed to execute schedule ${schedule.id}:`, error);
                errorCount++;
                errors.push({
                    scheduleId: schedule.id,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        console.log(`[Cron] Execution complete. Success: ${successCount}, Errors: ${errorCount}`);

        return {
            success: true,
            executed: successCount,
            errors: errorCount,
            details: errors,
        };

    } catch (error) {
        console.error('[Cron] Fatal error in executeScheduledWorkflows:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
