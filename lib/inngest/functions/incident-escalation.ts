import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { incidents, users, branches, whatsappSessions } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { EscalationService } from "@/lib/services/escalation-service";
import { getWhatsAppClient } from "@/lib/whatsapp/client-factory";

async function sendWhatsAppNotification(userId: string, message: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !user.whatsappPhone || !user.companyId) {
    console.warn(`User ${userId} missing phone/company. Skipping.`);
    return { sent: false };
  }

  const session = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.companyId, user.companyId),
  });

  if (!session?.sessionId) {
    console.warn(`No WhatsApp session for company ${user.companyId}.`);
    return { sent: false };
  }

  try {
    const client = await getWhatsAppClient();
    await client.sendMessage({
      sessionId: session.sessionId,
      to: user.whatsappPhone,
      message,
    });
    return { sent: true };
  } catch (error) {
    console.error("Failed to send WhatsApp:", error);
    return { sent: false, error: String(error) };
  }
}

export const handleIncidentWorkflowFn = inngest.createFunction(
  {
    id: "handle-incident",
    triggers: [{ event: "incident/detected" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { incidentId } = event.data;

    const incident = await step.run("load-incident", async () => {
      const result = await db.query.incidents.findFirst({
        where: eq(incidents.id, incidentId),
      });
      if (!result) throw new Error(`Incident ${incidentId} not found`);
      return result;
    });

    const supervisor = await step.run("find-supervisor", async () => {
      return await db.query.users.findFirst({
        where: and(
          eq(users.branchId, incident.branchId),
          or(eq(users.role, "SUPERVISOR"), eq(users.role, "GERENTE"))
        ),
      });
    });

    if (supervisor) {
      await step.run("notify-supervisor", async () => {
        await sendWhatsAppNotification(
          supervisor.id,
          `🚨 INCIDENTE DETECTADO\n\n${incident.title}\nSeverity: ${incident.severity}\n\nPor favor revisa el dashboard.`
        );
      });
    } else {
      console.warn(`No supervisor found for branch ${incident.branchId}`);
    }

    await step.sleep("wait-30m", "30m");

    const status = await step.run("check-status", async () => {
      const result = await db.query.incidents.findFirst({
        where: eq(incidents.id, incidentId),
        columns: { status: true },
      });
      return result?.status;
    });

    if (status === "RESOLVED") {
      if (supervisor) {
        await step.run("notify-resolved", async () => {
          await sendWhatsAppNotification(supervisor.id, `✅ Incidente ${incident.title} resuelto.`);
        });
      }
      return;
    }

    await step.run("escalate-incident", async () => {
      await db.update(incidents)
        .set({ status: "ESCALATED", updatedAt: new Date() })
        .where(eq(incidents.id, incidentId));
    });

    if (supervisor && supervisor.companyId) {
      const manager = await step.run("find-manager", async () => {
        return await db.query.users.findFirst({
          where: and(eq(users.companyId, supervisor.companyId), eq(users.role, "ADMIN")),
        });
      });

      if (manager) {
        await step.run("notify-manager", async () => {
          await sendWhatsAppNotification(
            manager.id,
            `🔥 INCIDENTE ESCALADO (No Resuelto en 30m)\n\n${incident.title}\nSucursal: ${incident.branchId}\n\nRequiere atención inmediata.`
          );
        });
      }
    }
  }
);

export const incidentEscalationChainFn = inngest.createFunction(
  {
    id: "incident-escalation-chain",
    triggers: [{ event: "incident/escalation.requested" }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { incidentId, chain } = event.data;

    for (let i = 0; i < chain.length; i++) {
      const level = chain[i];
      const delayMinutes = level.triggerAfterMinutes || 0;

      if (delayMinutes > 0) {
        await step.sleep(`level-${level.level}-delay`, `${delayMinutes}m`);
      }

      await step.run(`execute-level-${level.level}`, async () => {
        const currentIncident = await db.query.incidents.findFirst({
          where: eq(incidents.id, incidentId),
          columns: { status: true },
        });

        if (currentIncident?.status === "RESOLVED") {
          throw new Error(`Incident ${incidentId} already resolved`);
        }

        await EscalationService.executeEscalationLevel(incidentId, level);
      });
    }
  }
);
