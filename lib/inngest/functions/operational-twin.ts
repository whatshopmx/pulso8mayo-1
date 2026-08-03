import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { domainEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { recalculateTwin, recalculateCorporateTwin } from "@/lib/services/operational-twin-engine";

/**
 * Inngest handler that processes emitted domain events. Marks the event as processed,
 * triggers the branch Twin recalculation, and dispatches a group-level Corporate Twin recalculation.
 */
export const processDomainEvent = inngest.createFunction(
  {
    id: "process-domain-event",
    triggers: [{ event: "domain/event.emitted" }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { eventId, branchId, companyId } = event.data;

    // 1. Mark domain event as processed in the DB ledger
    await step.run("mark-event-processed", async () => {
      await db
        .update(domainEvents)
        .set({
          processed: true,
          processedAt: new Date(),
        })
        .where(eq(domainEvents.id, eventId));
    });

    // 2. Project operational changes to the branch's Twin
    const updatedTwin = await step.run("recalculate-twin", async () => {
      return await recalculateTwin(branchId);
    });

    // 3. Notify Corporate Twin engine to aggregate group stats
    await step.run("dispatch-corporate-recalculation", async () => {
      await inngest.send({
        name: "corporate/twin.recalculate",
        data: {
          companyId,
        },
      });
    });

    return { success: true, branchId, updatedTwinId: updatedTwin?.id };
  }
);

/**
 * Inngest handler that runs corporate projection calculations for the entire company/group.
 */
export const processCorporateTwinUpdate = inngest.createFunction(
  {
    id: "process-corporate-twin-update",
    triggers: [{ event: "corporate/twin.recalculate" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { companyId } = event.data;

    const updatedCorpTwin = await step.run("recalculate-corporate-twin", async () => {
      return await recalculateCorporateTwin(companyId);
    });

    return { success: true, companyId, updatedCorpTwinId: updatedCorpTwin?.id };
  }
);
