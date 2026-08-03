import { db } from "@/lib/db";
import { domainEvents } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

export interface EmitDomainEventInput {
  companyId: string;
  branchId: string;
  eventType: string;
  payload: Record<string, any>;
}

/**
 * Emit a domain event. Saves it to the immutable database event ledger
 * and dispatches it to Inngest to trigger the Policy Engine and Projections.
 */
export async function emitDomainEvent({
  companyId,
  branchId,
  eventType,
  payload,
}: EmitDomainEventInput) {
  // 1. Log domain event in the DB ledger
  const [event] = await db
    .insert(domainEvents)
    .values({
      companyId,
      branchId,
      eventType,
      payload,
      processed: false,
    })
    .returning();

  // 2. Dispatch to Inngest for async, event-driven twin updating
  try {
    await inngest.send({
      name: "domain/event.emitted",
      data: {
        eventId: event.id,
        eventType,
        branchId,
        companyId,
      },
    });
  } catch (error) {
    console.warn(
      `[DomainEventService] Warning: Failed to send event to Inngest (Inngest server might be offline):`,
      error instanceof Error ? error.message : error
    );
  }

  return event;
}
