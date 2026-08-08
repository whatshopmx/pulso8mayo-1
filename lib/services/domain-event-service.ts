import { db } from "@/lib/db";
import { domainEvents } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

/**
 * Domain event types — the immutable DB ledger (`domain_events.event_type`).
 *
 * Source: docs/pulso-executive-os-v2.md §5 (unified event bus). Sprint 1 adds the
 * Executive, Risk, Financial and Compliance events; existing operational events
 * are listed for completeness so callers get autocomplete.
 *
 * The union is OPT-IN: `EmitDomainEventInput.eventType` still accepts arbitrary
 * strings (`| (string & {})`) so legacy callers that emit undeclared literals
 * keep compiling. New code should emit a member of this union.
 */
export type DomainEventType =
  // Operational (existing)
  | 'InventoryVarianceDetected'
  | 'ShiftClockIn'
  | 'ShiftClockOut'
  | 'ShiftBreak'
  | 'IncidentDetected'
  | 'IncidentEscalated'
  | 'DocumentExpiring'
  // Executive (Sprint 1)
  | 'EXECUTIVE_TWIN_UPDATED'
  | 'MORNING_BRIEF_GENERATED'
  | 'RISK_THRESHOLD_BREACHED'
  | 'EXPANSION_OPPORTUNITY'
  // Financial
  | 'CASH_FLOW_UPDATED'
  | 'BUDGET_EXCEEDED'
  | 'PAYMENT_EXECUTED'
  /** Arqueo de caja fuera de tolerancia (faltante o sobrante de efectivo). */
  | 'CashVarianceDetected'
  // Compliance
  | 'COMPLIANCE_SCORE_CHANGED'
  | 'DOCUMENT_EXPIRING'
  | 'AUDIT_DUE';

export interface EmitDomainEventInput {
  companyId: string;
  branchId: string;
  /** Accepts a known `DomainEventType` (autocomplete) or any legacy string literal. */
  eventType: DomainEventType | (string & {});
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
