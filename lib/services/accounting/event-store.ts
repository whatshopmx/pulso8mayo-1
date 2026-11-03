import { and, eq, sql } from "drizzle-orm";
import { accountingEvents } from "@/lib/db/schema";
import type { withCompanyContext } from "@/lib/db/tenant-context";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Fact = Pick<typeof accountingEvents.$inferInsert,
  "companyId" | "branchId" | "sourceType" | "sourceId" | "eventType" | "actorId" | "accountingDate" | "sourceVersion">;

/** Called inside the transaction that saves the source; never sends a network event. */
export async function recordAccountingEventIn(tx: Tx, fact: Fact) {
  await tx.insert(accountingEvents).values(fact).onConflictDoNothing({ target: [
    accountingEvents.companyId, accountingEvents.sourceType, accountingEvents.sourceId,
    accountingEvents.eventType, accountingEvents.sourceVersion,
  ] });
}

/** The source lock is held by the adapter. Posted events never change again. */
export async function finishAccountingEventIn(tx: Tx, fact: Pick<Fact, "companyId" | "sourceType" | "sourceId" | "eventType" | "sourceVersion">,
  result: { journal: { id: string } | null; reason: string | null }) {
  await tx.update(accountingEvents).set({
    status: result.journal ? "POSTED" : "PENDING", journalId: result.journal?.id ?? null,
    attempts: sql`${accountingEvents.attempts} + 1`,
    lastError: result.journal ? null : (result.reason ?? "Falta configuración contable.").slice(0, 500),
    updatedAt: new Date(), nextAttemptAt: new Date(Date.now() + 5 * 60_000),
  }).where(and(
    eq(accountingEvents.companyId, fact.companyId), eq(accountingEvents.sourceType, fact.sourceType),
    eq(accountingEvents.sourceId, fact.sourceId), eq(accountingEvents.eventType, fact.eventType),
    eq(accountingEvents.sourceVersion, fact.sourceVersion ?? 1), eq(accountingEvents.status, "PENDING"),
  ));
}
