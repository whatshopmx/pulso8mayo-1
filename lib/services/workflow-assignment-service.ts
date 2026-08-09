import { db } from '@/lib/db';
import { workflowAssignments, workflowInstances, workflowSchedules, users, workflowTemplates } from '@/lib/db/schema';
import { eq, and, lte, gte, or, isNull, sql } from 'drizzle-orm';
import { emitWorkflowEvent } from '@/lib/websocket/workflow-handlers';
import { NotificationDispatcher } from '@/lib/services/notification-dispatcher';

export type AssignmentStatus = 'PENDING' | 'NOTIFIED' | 'STARTED' | 'COMPLETED' | 'OVERDUE';
export type AssignmentType = 'ROLE' | 'USER' | 'AUTO' | 'MANUAL';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface AssignmentConfig {
    assignedTo: string;
    assignedBy?: string;
    assignmentType: AssignmentType;
    dueDate?: Date;
    priority?: Priority;
    notes?: string;
}

export interface AssignmentFilters {
    status?: AssignmentStatus;
    priority?: Priority;
    isOverdue?: boolean;
    dueBefore?: Date;
    dueAfter?: Date;
}

export interface AssignmentStats {
    total: number;
    pending: number;
    started: number;
    completed: number;
    overdue: number;
    completedToday: number;
}

export interface BranchAssignmentStats {
    totalAssignments: number;
    pendingAssignments: number;
    overdueAssignments: number;
    completionRate: number;
    averageCompletionTime: number; // in hours
}

export class WorkflowAssignmentService {
  /**
   * Assign a workflow to a user
   */
  static async assignWorkflow(instanceId: string, config: AssignmentConfig) {
    const [assignment] = await db.insert(workflowAssignments).values({
      instanceId,
      assignedTo: config.assignedTo,
      assignedBy: config.assignedBy,
      assignmentType: config.assignmentType,
      dueDate: config.dueDate,
      priority: config.priority || 'MEDIUM',
      notes: config.notes,
      status: 'PENDING',
    }).returning();

    // Update workflow instance with assignment info
    await db
      .update(workflowInstances)
      .set({
        assignmentId: assignment.id,
        assigneeId: config.assignedTo,
        dueDate: config.dueDate,
        priority: config.priority || 'MEDIUM',
      })
      .where(eq(workflowInstances.id, instanceId));

    // Emit real-time event for new assignment
    emitWorkflowEvent('assignment_created', {
      assignmentId: assignment.id,
      instanceId,
      assignedTo: config.assignedTo,
      assignedBy: config.assignedBy,
      assignmentType: config.assignmentType,
      priority: config.priority || 'MEDIUM',
      dueDate: config.dueDate,
      createdAt: new Date().toISOString(),
    });

    // Send training assignment notification if it is a training template
    try {
        const instance = await db.query.workflowInstances.findFirst({
            where: eq(workflowInstances.id, instanceId),
        });

        if (instance) {
            const template = await db.query.workflowTemplates.findFirst({
                where: eq(workflowTemplates.id, instance.workflowTemplateId),
            });

            const isTraining = template && (
                template.category === 'TRAINING' || 
                template.category === 'CAPACITACION' || 
                template.name?.toLowerCase().includes('capacitacion') || 
                template.name?.toLowerCase().includes('capacitación')
            );

            if (isTraining && template) {
                const { SmartLinkService } = await import('./smart-link-service');
                const smartLink = await SmartLinkService.createSmartLink(
                    instanceId,
                    instance.workflowTemplateId,
                    instance.sessionId,
                    7 * 24 * 60, // 7 days expiration
                    undefined,
                    config.assignedTo,
                    undefined,
                    assignment.id
                );

                const formattedDueDate = config.dueDate
                    ? new Date(config.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
                    : 'Sin fecha límite';

                await NotificationDispatcher.sendNotification({
                    userId: config.assignedTo,
                    title: `Nueva Capacitación: ${template.name}`,
                    message: `Se te ha asignado la capacitación obligatoria: ${template.name}. Fecha límite: ${formattedDueDate}`,
                    type: "info",
                    eventType: "training_assigned",
                    actionUrl: smartLink.url,
                    actionLabel: "Iniciar Capacitación",
                    metadata: {
                        workflowName: template.name || 'Capacitación',
                        dueDate: formattedDueDate,
                        smartLinkUrl: smartLink.url,
                    }
                });
            }
        }
    } catch (notifErr) {
        console.error("Error sending training assignment notification:", notifErr);
    }

    return assignment;
  }

    /**
     * Auto-assign workflow based on schedule configuration
     */
    static async autoAssignWorkflow(instanceId: string, schedule: any) {
        let assignedTo: string | null = null;

        // Determine who to assign to based on schedule configuration
        if (schedule.assignmentType === 'USER' && schedule.assignedUserId) {
            assignedTo = schedule.assignedUserId;
        } else if (schedule.assignmentType === 'ROLE' && schedule.assignedRole) {
            // Find a user with the specified role in the branch
            assignedTo = await this.findUserByRole(schedule.branchId, schedule.assignedRole);
        } else {
            // AUTO: Find best available user
            assignedTo = await this.findBestAvailableUser(schedule.branchId);
        }

        if (!assignedTo) {
            throw new Error('No suitable user found for assignment');
        }

        return await this.assignWorkflow(instanceId, {
            assignedTo,
            assignmentType: 'AUTO',
            dueDate: await this.getInstanceDueDate(instanceId),
            priority: schedule.priority,
        });
    }

    /**
     * Get assignments for a user with filters
     */
    static async getUserAssignments(userId: string, filters?: AssignmentFilters) {
        const conditions = [eq(workflowAssignments.assignedTo, userId)];

        if (filters?.status) {
            conditions.push(eq(workflowAssignments.status, filters.status));
        }

        if (filters?.priority) {
            conditions.push(eq(workflowAssignments.priority, filters.priority));
        }

        if (filters?.isOverdue !== undefined) {
            conditions.push(eq(workflowAssignments.isOverdue, filters.isOverdue));
        }

        if (filters?.dueBefore) {
            conditions.push(lte(workflowAssignments.dueDate, filters.dueBefore));
        }

        if (filters?.dueAfter) {
            conditions.push(gte(workflowAssignments.dueDate, filters.dueAfter));
        }

        return await db
            .select({
                assignment: workflowAssignments,
                instance: workflowInstances,
            })
            .from(workflowAssignments)
            .leftJoin(workflowInstances, eq(workflowAssignments.instanceId, workflowInstances.id))
            .where(and(...conditions))
            .orderBy(workflowAssignments.dueDate);
    }

    /**
     * Get assignment by ID
     */
    static async getAssignmentById(id: string) {
        const [result] = await db
            .select({
                assignment: workflowAssignments,
                instance: workflowInstances,
            })
            .from(workflowAssignments)
            .leftJoin(workflowInstances, eq(workflowAssignments.instanceId, workflowInstances.id))
            .where(eq(workflowAssignments.id, id))
            .limit(1);

        return result || null;
    }

    /**
     * Update assignment status
     */
    static async updateAssignmentStatus(id: string, status: AssignmentStatus) {
        const updates: any = { status, updatedAt: new Date() };

        if (status === 'STARTED' && !updates.startedAt) {
            updates.startedAt = new Date();
        }

        if (status === 'COMPLETED' && !updates.completedAt) {
            updates.completedAt = new Date();
        }

        const [updated] = await db
            .update(workflowAssignments)
            .set(updates)
            .where(eq(workflowAssignments.id, id))
            .returning();

        return updated;
    }

  /**
   * Mark assignment as notified
   */
  static async markAsNotified(id: string) {
    const [updated] = await db
      .update(workflowAssignments)
      .set({
        status: 'NOTIFIED',
        notifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowAssignments.id, id))
      .returning();

    // Emit real-time event
    emitWorkflowEvent('assignment_notified', {
      assignmentId: id,
      status: 'NOTIFIED',
      notifiedAt: new Date().toISOString(),
    });

    return updated;
  }

    /**
     * Mark assignment as started
     */
    static async markAsStarted(id: string) {
        return await this.updateAssignmentStatus(id, 'STARTED');
    }

    /**
     * Mark assignment as completed
     */
    static async markAsCompleted(id: string) {
        return await this.updateAssignmentStatus(id, 'COMPLETED');
    }

    /**
     * Check for overdue assignments
     */
    static async checkOverdueAssignments() {
        const now = new Date();

        return await db
            .select()
            .from(workflowAssignments)
            .where(
                and(
                    or(
                        eq(workflowAssignments.status, 'PENDING'),
                        eq(workflowAssignments.status, 'NOTIFIED'),
                        eq(workflowAssignments.status, 'STARTED')
                    ),
                    lte(workflowAssignments.dueDate, now),
                    eq(workflowAssignments.isOverdue, false)
                )
            );
    }

    /**
     * Mark assignment as overdue
     */
    static async markOverdue(assignmentId: string) {
        const [updated] = await db
            .update(workflowAssignments)
            .set({
                isOverdue: true,
                status: 'OVERDUE',
                updatedAt: new Date(),
            })
            .where(eq(workflowAssignments.id, assignmentId))
            .returning();

        return updated;
    }

    /**
     * Reassign workflow to a different user
     */
    static async reassignWorkflow(assignmentId: string, newUserId: string, reassignedBy?: string) {
        // Get current notes
        const current = await this.getAssignmentById(assignmentId);
        const currentNotes = current?.assignment.notes || '';
        const reassignmentNote = `\nReassigned on ${new Date().toISOString()}`;

        const [updated] = await db
            .update(workflowAssignments)
            .set({
                assignedTo: newUserId,
                assignedBy: reassignedBy,
                assignmentType: 'MANUAL',
                updatedAt: new Date(),
                notes: currentNotes + reassignmentNote,
            })
            .where(eq(workflowAssignments.id, assignmentId))
            .returning();

        // Update workflow instance
        const assignment = await this.getAssignmentById(assignmentId);
        if (assignment?.instance) {
            await db
                .update(workflowInstances)
                .set({ assigneeId: newUserId })
                .where(eq(workflowInstances.id, assignment.instance.id));
        }

        return updated;
    }

    /**
     * Reassign all pending and started workflows of an employee to another user or to the best available user in the branch
     */
    static async reassignUserPendingWorkflows(userId: string, branchId: string, targetUserId?: string, reassignedBy?: string) {
        // Find all active/pending assignments for this user
        const activeAssignments = await db
            .select({ assignment: workflowAssignments })
            .from(workflowAssignments)
            .leftJoin(workflowInstances, eq(workflowAssignments.instanceId, workflowInstances.id))
            .where(
                and(
                    eq(workflowAssignments.assignedTo, userId),
                    or(
                        eq(workflowAssignments.status, 'PENDING'),
                        eq(workflowAssignments.status, 'NOTIFIED'),
                        eq(workflowAssignments.status, 'STARTED')
                    ),
                    eq(workflowInstances.branchId, branchId)
                )
            );

        if (activeAssignments.length === 0) {
            return { reassignedCount: 0, targetUserId: null };
        }

        // Determine destination user
        let destinationUserId = targetUserId || null;
        if (!destinationUserId) {
            destinationUserId = await this.findBestAvailableUser(branchId);
        }

        if (!destinationUserId) {
            // Fallback to manager in branch if no peer user found
            const manager = await db.query.users.findFirst({
                where: and(
                    eq(users.branchId, branchId),
                    or(eq(users.role, 'GERENTE'), eq(users.role, 'SUPERVISOR'), eq(users.role, 'ADMIN'))
                )
            });
            destinationUserId = manager?.id || null;
        }

        if (!destinationUserId) {
            console.warn(`[WorkflowAssignmentService] Could not find any target user to reassign tasks for user ${userId} in branch ${branchId}`);
            return { reassignedCount: 0, targetUserId: null };
        }

        const reassignedIds: string[] = [];
        for (const item of activeAssignments) {
            await this.reassignWorkflow(item.assignment.id, destinationUserId, reassignedBy);
            reassignedIds.push(item.assignment.id);
        }

        return {
            reassignedCount: reassignedIds.length,
            targetUserId: destinationUserId,
            reassignedIds
        };
    }

    /**
     * Get assignment statistics for a user
     */
    static async getAssignmentStats(userId: string): Promise<AssignmentStats> {
        const assignments = await this.getUserAssignments(userId);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const stats: AssignmentStats = {
            total: assignments.length,
            pending: assignments.filter(a => a.assignment.status === 'PENDING').length,
            started: assignments.filter(a => a.assignment.status === 'STARTED').length,
            completed: assignments.filter(a => a.assignment.status === 'COMPLETED').length,
            overdue: assignments.filter(a => a.assignment.isOverdue).length,
            completedToday: assignments.filter(a =>
                a.assignment.status === 'COMPLETED' &&
                a.assignment.completedAt &&
                a.assignment.completedAt >= today &&
                a.assignment.completedAt < tomorrow
            ).length,
        };

        return stats;
    }

    /**
     * Get assignment statistics for a branch
     */
    static async getBranchAssignmentStats(branchId: string): Promise<BranchAssignmentStats> {
        // Get all assignments for workflows in this branch
        const assignments = await db
            .select({
                assignment: workflowAssignments,
                instance: workflowInstances,
            })
            .from(workflowAssignments)
            .leftJoin(workflowInstances, eq(workflowAssignments.instanceId, workflowInstances.id))
            .where(eq(workflowInstances.branchId, branchId));

        const totalAssignments = assignments.length;
        const pendingAssignments = assignments.filter(a =>
            a.assignment.status === 'PENDING' || a.assignment.status === 'NOTIFIED'
        ).length;
        const overdueAssignments = assignments.filter(a => a.assignment.isOverdue).length;
        const completedAssignments = assignments.filter(a => a.assignment.status === 'COMPLETED');

        const completionRate = totalAssignments > 0
            ? (completedAssignments.length / totalAssignments) * 100
            : 0;

        // Calculate average completion time
        let totalCompletionTime = 0;
        let completionCount = 0;

        for (const { assignment } of completedAssignments) {
            if (assignment.createdAt && assignment.completedAt) {
                const timeDiff = assignment.completedAt.getTime() - assignment.createdAt.getTime();
                totalCompletionTime += timeDiff;
                completionCount++;
            }
        }

        const averageCompletionTime = completionCount > 0
            ? totalCompletionTime / completionCount / (1000 * 60 * 60) // Convert to hours
            : 0;

        return {
            totalAssignments,
            pendingAssignments,
            overdueAssignments,
            completionRate,
            averageCompletionTime,
        };
    }

    /**
     * Helper: Find user by role in a branch
     */
    private static async findUserByRole(branchId: string, role: string): Promise<string | null> {
        // This would need to query users table with role and branch association
        // For now, returning null - implement based on your user-branch relationship
        const [foundUser] = await db
            .select()
            .from(users)
            .where(
                and(
                    eq(users.role, role as any),
                    eq(users.branchId, branchId)
                )
            )
            .limit(1);

        if (!foundUser) {
            // Debugging: Find what roles ARE available in this branch
            const branchUsers = await db
                .select({ role: users.role, name: users.name })
                .from(users)
                .where(eq(users.branchId, branchId));

            const availableRoles = branchUsers.map(u => u.role).join(', ');
            console.warn(`[Assignment] No user found with role ${role} in branch ${branchId}. Available: ${availableRoles}`);

            // Return null so the calling function can handle it (or throw if strict)
            return null;
        }

        return foundUser.id;
    }

    /**
     * Helper: Find best available user (least assignments)
     */
    private static async findBestAvailableUser(branchId: string): Promise<string | null> {
        // Find user with least pending assignments in this branch
        const branchUsers = await db
            .select()
            .from(users)
            .where(eq(users.branchId, branchId));

        if (branchUsers.length === 0) return null;

        // Count pending assignments for each user
        const userAssignmentCounts = await Promise.all(
            branchUsers.map(async (u) => {
                const assignments = await this.getUserAssignments(u.id, {
                    status: 'PENDING'
                });
                return { userId: u.id, count: assignments.length };
            })
        );

        // Sort by count and return user with least assignments
        userAssignmentCounts.sort((a, b) => a.count - b.count);
        return userAssignmentCounts[0]?.userId || null;
    }

    /**
     * Helper: Get due date from workflow instance
     */
    private static async getInstanceDueDate(instanceId: string): Promise<Date | undefined> {
        const [instance] = await db
            .select()
            .from(workflowInstances)
            .where(eq(workflowInstances.id, instanceId))
            .limit(1);

        return instance?.dueDate || undefined;
    }
}
