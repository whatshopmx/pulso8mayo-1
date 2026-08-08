import { db } from '@/lib/db';
import { workflowSchedules, workflowInstances, workflowAssignments } from '@/lib/db/schema';
import { eq, and, lte, gte, isNull, or } from 'drizzle-orm';

export type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE';
export type AssignmentType = 'ROLE' | 'USER' | 'AUTO' | 'MANUAL';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface CreateScheduleInput {
    templateId: string;
    branchId: string;
    assignmentType: AssignmentType;
    assignedRole?: 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY';
    assignedRoles?: string[]; // selección completa; assignedRole guarda el primero (AD-7)
    assignedShifts?: string[]; // 'morning' | 'afternoon' | 'night' | 'all'
    assignedUserId?: string;
    frequency: ScheduleFrequency;
    dayOfWeek?: number; // 0-6 (Sunday-Saturday)
    daysOfWeek?: string[]; // ['monday', ...]; dayOfWeek guarda el primero (AD-7)
    dayOfMonth?: number; // 1-31
    timeOfDay?: string; // HH:MM format
    startDate: Date;
    endDate?: Date;
    title: string;
    description?: string;
    priority?: Priority;
    createdBy: string;
}

export interface UpdateScheduleInput {
    assignmentType?: AssignmentType;
    assignedRole?: 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY';
    assignedRoles?: string[];
    assignedShifts?: string[];
    assignedUserId?: string;
    frequency?: ScheduleFrequency;
    dayOfWeek?: number;
    daysOfWeek?: string[];
    dayOfMonth?: number;
    timeOfDay?: string;
    startDate?: Date;
    endDate?: Date;
    title?: string;
    description?: string;
    priority?: Priority;
    isActive?: boolean;
}

export interface ScheduleFilters {
    isActive?: boolean;
    frequency?: ScheduleFrequency;
    assignmentType?: AssignmentType;
}

export interface ScheduleStats {
    totalSchedules: number;
    activeSchedules: number;
    executionsToday: number;
    upcomingExecutions: number;
}

export class WorkflowScheduleService {
    /**
     * Create a new workflow schedule
     */
    static async createSchedule(data: CreateScheduleInput) {
        // Calculate next execution time
        const nextExecution = this.calculateNextExecution({
            frequency: data.frequency,
            dayOfWeek: data.dayOfWeek,
            dayOfMonth: data.dayOfMonth,
            timeOfDay: data.timeOfDay,
            startDate: data.startDate,
        });

        const [schedule] = await db.insert(workflowSchedules).values({
            templateId: data.templateId,
            branchId: data.branchId,
            assignmentType: data.assignmentType,
            assignedRole: data.assignedRole,
            assignedRoles: data.assignedRoles ?? [],
            assignedShifts: data.assignedShifts ?? [],
            assignedUserId: data.assignedUserId,
            frequency: data.frequency,
            dayOfWeek: data.dayOfWeek,
            daysOfWeek: data.daysOfWeek ?? [],
            dayOfMonth: data.dayOfMonth,
            timeOfDay: data.timeOfDay,
            startDate: data.startDate,
            endDate: data.endDate,
            title: data.title,
            description: data.description,
            priority: data.priority || 'MEDIUM',
            nextExecutionAt: nextExecution,
            createdBy: data.createdBy,
        }).returning();

        return schedule;
    }

    /**
     * Get schedules for a branch with optional filters
     */
    static async getSchedules(branchId: string, filters?: ScheduleFilters) {
        const conditions = [eq(workflowSchedules.branchId, branchId)];

        if (filters?.isActive !== undefined) {
            conditions.push(eq(workflowSchedules.isActive, filters.isActive));
        }

        if (filters?.frequency) {
            conditions.push(eq(workflowSchedules.frequency, filters.frequency));
        }

        if (filters?.assignmentType) {
            conditions.push(eq(workflowSchedules.assignmentType, filters.assignmentType));
        }

        return await db
            .select()
            .from(workflowSchedules)
            .where(and(...conditions))
            .orderBy(workflowSchedules.nextExecutionAt);
    }

    /**
     * Get schedule by ID
     */
    static async getScheduleById(id: string) {
        const [schedule] = await db
            .select()
            .from(workflowSchedules)
            .where(eq(workflowSchedules.id, id))
            .limit(1);

        return schedule || null;
    }

    /**
     * Get schedule by Template ID and Branch ID
     */
    static async getScheduleByTemplateId(templateId: string, branchId: string) {
        const [schedule] = await db
            .select()
            .from(workflowSchedules)
            .where(
                and(
                    eq(workflowSchedules.templateId, templateId),
                    eq(workflowSchedules.branchId, branchId)
                )
            )
            .limit(1);

        return schedule || null;
    }

    /**
     * Update a schedule
     */
    static async updateSchedule(id: string, data: UpdateScheduleInput) {
        const updates: any = { ...data, updatedAt: new Date() };

        // Recalculate next execution if scheduling params changed
        if (data.frequency || data.dayOfWeek !== undefined || data.dayOfMonth !== undefined || data.timeOfDay || data.startDate) {
            const schedule = await this.getScheduleById(id);
            if (schedule) {
                updates.nextExecutionAt = this.calculateNextExecution({
                    frequency: data.frequency || schedule.frequency,
                    dayOfWeek: data.dayOfWeek !== undefined ? data.dayOfWeek : schedule.dayOfWeek,
                    dayOfMonth: data.dayOfMonth !== undefined ? data.dayOfMonth : schedule.dayOfMonth,
                    timeOfDay: data.timeOfDay || schedule.timeOfDay,
                    startDate: data.startDate || schedule.startDate,
                });
            }
        }

        const [updated] = await db
            .update(workflowSchedules)
            .set(updates)
            .where(eq(workflowSchedules.id, id))
            .returning();

        return updated;
    }

    /**
     * Toggle schedule active status
     */
    static async toggleSchedule(id: string, isActive: boolean) {
        const [updated] = await db
            .update(workflowSchedules)
            .set({ isActive, updatedAt: new Date() })
            .where(eq(workflowSchedules.id, id))
            .returning();

        return updated;
    }

    /**
     * Delete a schedule
     */
    static async deleteSchedule(id: string) {
        await db
            .delete(workflowSchedules)
            .where(eq(workflowSchedules.id, id));
    }

    /**
     * Calculate next execution time based on frequency
     */
    static calculateNextExecution(config: {
        frequency: ScheduleFrequency;
        dayOfWeek?: number | null;
        dayOfMonth?: number | null;
        timeOfDay?: string | null;
        startDate: Date;
    }): Date {
        const now = new Date();
        const [hours = 8, minutes = 0] = (config.timeOfDay || '08:00').split(':').map(Number);

        let nextExecution = new Date(config.startDate);

        // If start date is in the past, start from now
        if (nextExecution < now) {
            nextExecution = new Date(now);
        }

        switch (config.frequency) {
            case 'ONCE':
                // For one-time schedules, use the start date with specified time
                nextExecution.setHours(hours, minutes, 0, 0);
                break;

            case 'DAILY':
                // Set to next occurrence of specified time
                nextExecution.setHours(hours, minutes, 0, 0);

                // If time has passed today, move to tomorrow
                if (nextExecution <= now) {
                    nextExecution.setDate(nextExecution.getDate() + 1);
                }
                break;

            case 'WEEKLY':
                // Set to next occurrence of specified day of week
                const targetDay = config.dayOfWeek ?? 1; // Default to Monday
                nextExecution.setHours(hours, minutes, 0, 0);

                const currentDay = nextExecution.getDay();
                let daysUntilTarget = (targetDay - currentDay + 7) % 7;

                // If it's the same day but time has passed, schedule for next week
                if (daysUntilTarget === 0 && nextExecution <= now) {
                    daysUntilTarget = 7;
                }

                nextExecution.setDate(nextExecution.getDate() + daysUntilTarget);
                break;

            case 'MONTHLY':
                // Set to next occurrence of specified day of month
                const targetDate = config.dayOfMonth ?? 1; // Default to 1st
                nextExecution.setHours(hours, minutes, 0, 0);
                nextExecution.setDate(targetDate);

                // If date has passed this month, move to next month
                if (nextExecution <= now) {
                    nextExecution.setMonth(nextExecution.getMonth() + 1);
                    nextExecution.setDate(targetDate);
                }
                break;
        }

        return nextExecution;
    }

    /**
     * Get schedules that are due for execution
     */
    static async getSchedulesDueForExecution() {
        const now = new Date();

        return await db
            .select()
            .from(workflowSchedules)
            .where(
                and(
                    eq(workflowSchedules.isActive, true),
                    lte(workflowSchedules.nextExecutionAt, now),
                    or(
                        isNull(workflowSchedules.endDate),
                        gte(workflowSchedules.endDate, now)
                    )
                )
            );
    }

    /**
     * Execute a schedule (create workflow instance)
     */
    static async executeSchedule(scheduleId: string) {
        const schedule = await this.getScheduleById(scheduleId);
        if (!schedule) {
            throw new Error('Schedule not found');
        }

        // Create workflow instance
        const [instance] = await db.insert(workflowInstances).values({
            workflowTemplateId: schedule.templateId,
            branchId: schedule.branchId,
            scheduleId: schedule.id,
            status: 'PENDING',
            priority: schedule.priority,
            dueDate: this.calculateDueDate(schedule),
        }).returning();

        return instance;
    }

    /**
     * Calculate due date for a workflow instance based on schedule
     */
    private static calculateDueDate(schedule: any): Date {
        const dueDate = new Date();

        // Default: due by end of day
        dueDate.setHours(23, 59, 59, 999);

        // For daily tasks, due same day
        // For weekly/monthly, give more time
        switch (schedule.frequency) {
            case 'WEEKLY':
                dueDate.setDate(dueDate.getDate() + 7);
                break;
            case 'MONTHLY':
                dueDate.setMonth(dueDate.getMonth() + 1);
                break;
        }

        return dueDate;
    }

    /**
     * Get schedule statistics for a branch
     */
    static async getScheduleStats(branchId: string): Promise<ScheduleStats> {
        const allSchedules = await this.getSchedules(branchId);
        const activeSchedules = allSchedules.filter(s => s.isActive);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const executionsToday = allSchedules.filter(s =>
            s.lastExecutedAt &&
            s.lastExecutedAt >= today &&
            s.lastExecutedAt < tomorrow
        ).length;

        const upcomingExecutions = activeSchedules.filter(s =>
            s.nextExecutionAt && s.nextExecutionAt < tomorrow
        ).length;

        return {
            totalSchedules: allSchedules.length,
            activeSchedules: activeSchedules.length,
            executionsToday,
            upcomingExecutions,
        };
    }
}
