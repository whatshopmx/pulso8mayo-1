import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { users, workflowInstances } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

export const emergencyDepartureHandler = inngest.createFunction(
  {
    id: "emergency-departure-handler",
    name: "Handle Employee Emergency Departure",
    triggers: [{ event: "employee/emergency.departure" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, branchId, companyId, reason, notes, requestedBy, sessionId, reassignedCount, targetUserId, approvalId } = event.data;

    // Step 1: Notify branch managers & supervisors
    await step.run("notify-branch-managers", async () => {
      const employee = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { name: true, role: true }
      });

      const managers = await db.query.users.findMany({
        where: and(
          eq(users.branchId, branchId),
          or(eq(users.role, 'GERENTE'), eq(users.role, 'SUPERVISOR'), eq(users.role, 'ADMIN'))
        )
      });

      const empName = employee?.name || "Empleado";
      const targetUser = targetUserId ? await db.query.users.findFirst({ where: eq(users.id, targetUserId) }) : null;

      for (const mgr of managers) {
        await NotificationDispatcher.sendNotification({
          userId: mgr.id,
          title: "🚨 Salida de Emergencia Registrada",
          message: `${empName} se ha retirado por emergencia: "${reason}". (${reassignedCount || 0} tareas reasignadas${targetUser ? ` a ${targetUser.name}` : ''}).`,
          type: "warning",
          eventType: "shift_approval_needed",
          actionUrl: `/dashboard/labor/shift-changes`,
          actionLabel: "Ver Aprobaciones",
          metadata: {
            employeeId: userId,
            employeeName: empName,
            reason,
            notes,
            approvalId
          }
        });
      }
    });

    // Step 2: Instantiate Contingency Emergency Workflow
    const contingencyInstance = await step.run("create-contingency-workflow", async () => {
      const [instance] = await db.insert(workflowInstances).values({
        workflowTemplateId: "tpl-salida-emergencia-v1",
        branchId: branchId,
        assigneeId: targetUserId || requestedBy || userId,
        sessionId: sessionId || null,
        status: "PENDING",
        priority: "HIGH",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000), // Due in 2 hours
        data: {
          emergencyReason: reason,
          departedUserId: userId,
          reassignedCount: reassignedCount || 0,
          approvalId: approvalId || null
        }
      }).returning();

      return instance;
    });

    return {
      success: true,
      contingencyInstanceId: contingencyInstance.id,
      reassignedCount
    };
  }
);
