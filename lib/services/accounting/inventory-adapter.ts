import { and, asc, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { accountingAccounts, accountingEvents, accountingInventoryValuations, accountingJournalLines,
  accountingJournals, accountingOpenings, branches, financialPeriods, users } from "@/lib/db/schema";
import { finishAccountingEventIn, recordAccountingEventIn } from "./event-store";
import { isAccountingPostingEnabled } from "./expense-adapter";
import { inventoryPlan, isInventoryValuationEnabled, type InventoryKind } from "./inventory-contract";
import { insertJournalLines, postInTransaction } from "./journal-service";
import { resolveRuleIn, ruleBlockerMessage } from "./mapping-service";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Event = typeof accountingEvents.$inferSelect;
type Fact = typeof accountingInventoryValuations.$inferSelect;
export const INVENTORY_EVENTS = { USAGE: "INVENTORY_USED", USAGE_RETURN: "INVENTORY_USAGE_RETURNED", WASTE: "INVENTORY_WASTED",
  TRANSFER_OUT: "INVENTORY_SHIPPED", TRANSFER_IN: "INVENTORY_RECEIVED", TRANSFER_WASTE: "INVENTORY_TRANSIT_WASTED" } as const;

/** Separate opt-in keeps deployed posting compatible before the additive FC-14 migration. */
export function isInventoryAccountingEnabled() {
  return isAccountingPostingEnabled() && isInventoryValuationEnabled();
}

/** Physical source and immutable cost commit together in SQL; only enabled workers enqueue them. */
export async function recoverInventoryFacts(tx: Tx, companyId: string) {
  if (!isInventoryAccountingEnabled()) return 0;
  const facts = await tx.select().from(accountingInventoryValuations).where(and(
    eq(accountingInventoryValuations.companyId, companyId), isNotNull(accountingInventoryValuations.actorId),
    notExists(tx.select({ id: accountingEvents.id }).from(accountingEvents).where(and(
      eq(accountingEvents.companyId, companyId), eq(accountingEvents.sourceType, "INVENTORY_MOVEMENT"),
      eq(accountingEvents.sourceId, accountingInventoryValuations.movementId), eq(accountingEvents.sourceVersion, 1),
    ))),
  )).orderBy(asc(accountingInventoryValuations.capturedAt), asc(accountingInventoryValuations.movementId)).limit(25);
  for (const fact of facts) await recordAccountingEventIn(tx, { companyId, branchId: fact.branchId,
    sourceType: "INVENTORY_MOVEMENT", sourceId: fact.movementId, eventType: INVENTORY_EVENTS[fact.kind], sourceVersion: 1,
    accountingDate: fact.accountingDate, actorId: fact.actorId! });
  return facts.length;
}

async function originalLines(tx: Tx, fact: Fact) {
  const originals = await tx.select({ id: accountingInventoryValuations.movementId, status: accountingEvents.status,
    journalId: accountingEvents.journalId }).from(accountingInventoryValuations)
    .leftJoin(accountingEvents, and(eq(accountingEvents.companyId, fact.companyId), eq(accountingEvents.sourceType, "INVENTORY_MOVEMENT"),
      eq(accountingEvents.sourceId, accountingInventoryValuations.movementId), eq(accountingEvents.sourceVersion, 1)))
    .where(and(eq(accountingInventoryValuations.companyId, fact.companyId), fact.kind === "USAGE_RETURN"
      ? eq(accountingInventoryValuations.movementId, fact.originalMovementId!)
      : and(eq(accountingInventoryValuations.referenceId, fact.referenceId!), eq(accountingInventoryValuations.itemId, fact.itemId),
        eq(accountingInventoryValuations.kind, "TRANSFER_OUT"))));
  if (!originals.length || originals.some(row => row.status !== "POSTED" || !row.journalId)) return null;
  return tx.select().from(accountingJournalLines).where(and(eq(accountingJournalLines.companyId, fact.companyId),
    inArray(accountingJournalLines.journalId, originals.map(row => row.journalId!))));
}

/** Durable retry never reads a live item/batch cost or rewrites a captured source. */
export async function postInventoryEventIn(tx: Tx, supplied: Event) {
  const pending = async (event: Event, reason: string) => {
    const result = { journal: null, reason }; await finishAccountingEventIn(tx, event, result); return result;
  };
  if (!isInventoryAccountingEnabled()) return pending(supplied, "La contabilización de inventario aún no está habilitada.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${supplied.companyId},615))`);
  const [event] = await tx.select().from(accountingEvents).where(and(eq(accountingEvents.companyId, supplied.companyId), eq(accountingEvents.id, supplied.id))).limit(1);
  if (!event) return { journal: null, reason: "El hecho contable ya no está disponible." };
  if (event.status === "POSTED") return { journal: { id: event.journalId! }, reason: null };
  const [fact] = await tx.select().from(accountingInventoryValuations).where(and(
    eq(accountingInventoryValuations.companyId, event.companyId), eq(accountingInventoryValuations.movementId, event.sourceId))).limit(1);
  if (!fact || fact.branchId !== event.branchId || fact.accountingDate !== event.accountingDate || fact.actorId !== event.actorId
    || INVENTORY_EVENTS[fact.kind] !== event.eventType || event.sourceType !== "INVENTORY_MOVEMENT" || event.sourceVersion !== 1) {
    return pending(event, "El hecho no corresponde al movimiento y valoración originales.");
  }
  if (fact.pendingReason || fact.amountCents === null) return pending(event, fact.pendingReason ?? "Falta el costo original congelado.");
  const [actor] = await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, event.companyId), eq(users.id, event.actorId),
    eq(users.active, true), isNull(users.deletedAt))).limit(1);
  const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.companyId, event.companyId),
    eq(branches.id, event.branchId), eq(branches.active, true), eq(branches.ownershipType, "OWNED"))).limit(1);
  if (!actor || !branch) return pending(event, "El actor o la sucursal propia ya no son elegibles en la empresa.");
  const [opening] = await tx.select({ date: accountingOpenings.openingDate }).from(accountingOpenings)
    .where(eq(accountingOpenings.companyId, event.companyId)).limit(1);
  if (!opening || fact.accountingDate <= opening.date) return pending(event, "El movimiento requiere una apertura revisada anterior a su fecha.");
  const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(eq(financialPeriods.companyId, event.companyId),
    eq(financialPeriods.year, Number(fact.accountingDate.slice(0, 4))), eq(financialPeriods.month, Number(fact.accountingDate.slice(5, 7))),
    eq(financialPeriods.status, "CLOSED"))).limit(1);
  if (closed) return pending(event, "El periodo del movimiento está cerrado; requiere revisión antes de publicar.");
  if (fact.kind.startsWith("TRANSFER")) {
    const [source] = (await tx.execute<{ reason: string | null }>(sql`select accounting_inventory_source_blocker(${event.companyId}::uuid,${fact.movementId}::uuid) reason`)).rows;
    if (source.reason) return pending(event, source.reason);
  }
  let plan: ReturnType<typeof inventoryPlan>;
  try { plan = inventoryPlan(fact.kind as InventoryKind, fact.amountCents); }
  catch (error) { if (!(error instanceof RangeError)) throw error; return pending(event, error.message); }
  const anchored = ["USAGE_RETURN", "TRANSFER_IN", "TRANSFER_WASTE"].includes(fact.kind);
  const originals = anchored ? await originalLines(tx, fact) : null;
  if (anchored && !originals) return pending(event, "Falta la contabilización del consumo o envío original.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.companyId},505))`);
  const rule = await resolveRuleIn(tx, event.companyId, event.eventType, fact.accountingDate), blocker = ruleBlockerMessage(rule);
  if (blocker) return pending(event, blocker);
  const lines = [];
  for (const line of plan) {
    const entry = rule.entries.find(entry => entry.role === line.role), costCenterId = entry?.costCenterId ?? null;
    if (!entry?.accountId) return pending(event, `Falta la cuenta explícita de ${line.role} para inventario.`);
    const [account] = await tx.select().from(accountingAccounts).where(and(eq(accountingAccounts.companyId, event.companyId), eq(accountingAccounts.id, entry.accountId))).limit(1);
    const kind = ["COGS", "WASTE"].includes(line.role) ? "EXPENSE" : "ASSET";
    if (!account || account.kind !== kind || !account.active || !account.postable || account.validFrom > fact.accountingDate
      || (account.validTo && account.validTo < fact.accountingDate)) return pending(event, `La cuenta de ${line.role} no es utilizable en la fecha del movimiento.`);
    if (originals && (fact.kind === "USAGE_RETURN" || line.role === "IN_TRANSIT")) {
      const anchors = originals.filter(saved => saved.memo === `INVENTORY:${line.role}`);
      if (!anchors.length || anchors.some(saved => saved.accountId !== entry.accountId || saved.costCenterId !== costCenterId)) {
        return pending(event, `La cuenta o centro de ${line.role} no coincide con el movimiento original.`);
      }
    }
    lines.push({ accountId: entry.accountId, costCenterId, debitCents: line.debitCents, creditCents: line.creditCents, memo: `INVENTORY:${line.role}` });
  }
  const [draft] = await tx.insert(accountingJournals).values({ companyId: event.companyId, branchId: event.branchId,
    accountingDate: fact.accountingDate, businessDate: fact.accountingDate, description: `Inventario ${fact.kind}: ${fact.movementId}`,
    sourceType: event.sourceType, sourceId: event.sourceId, eventType: event.eventType, sourceVersion: event.sourceVersion,
    ruleId: rule.rule!.id, ruleVersion: rule.rule!.version, createdBy: event.actorId, updatedBy: event.actorId }).returning();
  await insertJournalLines(tx, event.companyId, draft.id, lines);
  const journal = await postInTransaction(tx, event.companyId, event.actorId, draft.id, draft.version, "Movimiento y valoración originales congelados.");
  await finishAccountingEventIn(tx, event, { journal, reason: null });
  return { journal, reason: null };
}
