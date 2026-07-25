import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { workflowInstances, incidents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sign } from "jsonwebtoken";
import { getWhatsAppClient } from "@/lib/whatsapp/client-factory";
import { users, whatsappSessions } from "@/lib/db/schema";

const JWT_SECRET = process.env.JWT_SECRET || "default_dev_secret";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

async function sendWhatsAppNotification(userId: string, message: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user?.whatsappPhone || !user.companyId) {
    console.warn(`User ${userId} missing phone/company. Skipping.`);
    return { sent: false };
  }

  const session = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.companyId, user.companyId),
  });

  if (!session?.sessionId) return { sent: false };

  const client = await getWhatsAppClient();
  await client.sendMessage({
    sessionId: session.sessionId,
    to: user.whatsappPhone,
    message,
  });
  return { sent: true };
}

export const executeWorkflowFn = inngest.createFunction(
  {
    id: "execute-workflow",
    triggers: [{ event: "workflow/execution.created" }],
    retries: 2,
    concurrency: 10,
  },
  async ({ event, step }) => {
    const { instanceId, userId } = event.data as { instanceId: string; userId: string };

    const instance = await step.run("load-instance", async () => {
      const result = await db.query.workflowInstances.findFirst({
        where: eq(workflowInstances.id, instanceId),
        with: { template: true },
      });
      if (!result) throw new Error(`Workflow instance not found: ${instanceId}`);
      return result;
    });

    await step.run("mark-started", async () => {
      await db.update(workflowInstances)
        .set({ status: "IN_PROGRESS", startedAt: new Date() })
        .where(eq(workflowInstances.id, instanceId));
    });

    const link = await step.run("generate-smartlink", async () => {
      const token = sign(
        { instanceId, userId, type: "workflow" },
        JWT_SECRET,
        { expiresIn: "4h" }
      );
      return `${APP_URL}/w/${token}`;
    });

    await step.run("send-notification", async () => {
      await sendWhatsAppNotification(
        userId,
        `📋 Tienes una nueva tarea: *${(instance as any).template.title}*\n\nCompleta tu checklist aquí: ${link}`
      );
    });

    const completionEvent = await step.waitForEvent("wait-for-completion", {
      event: "workflow/step.completed",
      timeout: "2h",
      match: "data.instanceId",
    });

    if (completionEvent) {
      await step.run("mark-completed", async () => {
        await db.update(workflowInstances)
          .set({ status: "COMPLETED", completedAt: new Date() })
          .where(eq(workflowInstances.id, instanceId));
      });

      await step.run("notify-success", async () => {
        await sendWhatsAppNotification(
          userId,
          `✅ *${(instance as any).template.title}* completado exitosamente. ¡Buen trabajo!`
        );
      });

      await step.run("resolve-external-remediation", async () => {
        const { RemediationService } = await import("@/lib/services/remediation-service");
        await RemediationService.completeExternalServiceRemediation(instanceId, (instance as any).scheduleId || undefined);
      });
    } else {
      await step.run("mark-expired", async () => {
        await db.update(workflowInstances)
          .set({ status: "EXPIRED" })
          .where(eq(workflowInstances.id, instanceId));
      });

      await step.run("notify-timeout", async () => {
        await sendWhatsAppNotification(
          userId,
          `⚠️ La tarea *${(instance as any).template.title}* ha expirado por tiempo.`
        );
      });

      const escalationEvent = await step.run("create-incident", async () => {
        const [incident] = await db.insert(incidents).values({
          instanceId,
          stepId: "general_timeout",
          branchId: instance.branchId,
          severity: "WARNING",
          title: `Checklist Timeout: ${(instance as any).template.title}`,
          description: `Workflow expired after 2 hours without completion.`,
          status: "DETECTED",
        }).returning();

        return { incidentId: incident.id };
      });

      await step.sendEvent("trigger-escalation", {
        name: "incident/escalation.requested",
        data: {
          incidentId: escalationEvent.incidentId,
          chain: [
            {
              level: 1,
              triggerAfterMinutes: 0,
              notifyRoles: ["SUPERVISOR", "GERENTE"],
              channel: "whatsapp",
              message: `⚠️ Timeout: Checklist *${(instance as any).template.title}* expired. Action required.`,
            },
            {
              level: 2,
              triggerAfterMinutes: 30,
              notifyRoles: ["ADMIN"],
              channel: "whatsapp",
              message: `🔥 Escalation: Checklist *${(instance as any).template.title}* still unresolved after timeout.`,
            },
          ],
        },
      });
    }
  }
);
