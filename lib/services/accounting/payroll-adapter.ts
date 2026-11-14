import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { accountingAccounts, accountingEvents, accountingJournalLines, accountingJournals, accountingPayrollFacts,
  accountingSourceLinks, companyBankAccounts, financialPeriods, paymentRunItems, paymentRuns, payrollPayslips, payrollRuns, users } from "@/lib/db/schema";
import type { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { loadPayrollPaymentSnapshot } from "@/lib/treasury/payroll-payment-source";
import { parsePayrollSnapshot, type PayrollPaymentSnapshot, type PayrollSnapshotReceipt } from "@/lib/treasury/payroll-snapshot";
import { sumCents } from "./amounts";
import { recordAccountingEventIn, finishAccountingEventIn } from "./event-store";
import { isAccountingPostingEnabled } from "./expense-adapter";
import { insertJournalLines, postInTransaction } from "./journal-service";
import { resolveRuleIn, ruleBlockerMessage } from "./mapping-service";
import { payrollNetCents, payrollPlan } from "./payroll-contract";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Event = typeof accountingEvents.$inferSelect;
type Snapshot = { kind: "RECOGNITION" | "PAYMENT"; periodStart: string; periodEnd: string;
  receipt: PayrollSnapshotReceipt; amountCents: number; bankAccountId: string | null };
export const PAYROLL_SOURCES = { PAYROLL_PAYSLIP: "PAYROLL_RECOGNIZED", PAYROLL_PAYMENT: "PAYROLL_PAID" } as const;
export const payrollLock = (tx: Tx, companyId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId},616))`);

async function activeActor(tx: Tx, companyId: string, actorId: string) {
  const [actor] = await tx.select({ role: users.role }).from(users).where(and(eq(users.companyId, companyId),
    eq(users.id, actorId), eq(users.active, true), isNull(users.deletedAt))).limit(1);
  if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa.");
  return actor;
}

async function eventOf(tx: Tx, companyId: string, eventId: string) {
  const [event] = await tx.select().from(accountingEvents).where(and(eq(accountingEvents.companyId, companyId),
    eq(accountingEvents.id, eventId))).limit(1);
  if (!event) throw ApiError.notFound("El hecho de nómina no existe en esta empresa.");
  return event;
}

async function capture(tx: Tx, companyId: string, actorId: string, runId: string,
  snapshot: Snapshot, paymentItemId?: string, paidAt?: string) {
  const [existing] = await tx.select({ eventId: accountingPayrollFacts.eventId }).from(accountingPayrollFacts).where(and(
    eq(accountingPayrollFacts.companyId, companyId), eq(accountingPayrollFacts.payslipId, snapshot.receipt.payslipId),
    eq(accountingPayrollFacts.kind, snapshot.kind), paymentItemId ? eq(accountingPayrollFacts.paymentRunItemId, paymentItemId) : undefined,
  )).limit(1);
  if (existing) return eventOf(tx, companyId, existing.eventId);
  const factId = randomUUID(), sourceType = snapshot.kind === "RECOGNITION" ? "PAYROLL_PAYSLIP" : "PAYROLL_PAYMENT";
  const sourceId = snapshot.kind === "RECOGNITION" ? snapshot.receipt.payslipId : factId;
  const identity = { companyId, actorId, branchId: snapshot.receipt.branchId, sourceType, sourceId,
    eventType: PAYROLL_SOURCES[sourceType], sourceVersion: 1, accountingDate: paidAt ?? snapshot.periodEnd };
  await recordAccountingEventIn(tx, identity);
  const [event] = await tx.select().from(accountingEvents).where(and(eq(accountingEvents.companyId, companyId),
    eq(accountingEvents.sourceType, sourceType), eq(accountingEvents.sourceId, sourceId), eq(accountingEvents.sourceVersion, 1))).limit(1);
  if (snapshot.kind === "RECOGNITION") {
    const [overlap] = await tx.select({ id: accountingPayrollFacts.id }).from(accountingPayrollFacts)
      .innerJoin(payrollRuns, eq(payrollRuns.id, accountingPayrollFacts.payrollRunId)).where(and(
        eq(accountingPayrollFacts.companyId, companyId), eq(accountingPayrollFacts.kind, "RECOGNITION"),
        sql`${accountingPayrollFacts.snapshot}->'receipt'->>'employeeId'=${snapshot.receipt.employeeId}`,
        sql`${accountingPayrollFacts.payrollRunId}<>${runId}::uuid`,
        sql`${payrollRuns.periodStart}<=${snapshot.periodEnd}::date AND ${payrollRuns.periodEnd}>=${snapshot.periodStart}::date`,
        sql`(${payrollRuns.aguinaldoFiscalYear} IS NULL)=(SELECT aguinaldo_fiscal_year IS NULL FROM payroll_runs WHERE id=${runId}::uuid)`,
      )).limit(1);
    if (overlap) {
      await finishAccountingEventIn(tx, event, { journal: null, reason: "Otro recibo ya reconoce este empleado y periodo; requiere revisión de solapamiento." });
      return event;
    }
  }
  await tx.insert(accountingPayrollFacts).values({ id: factId, eventId: event.id, companyId, payrollRunId: runId,
    payslipId: snapshot.receipt.payslipId, paymentRunItemId: paymentItemId ?? null, kind: snapshot.kind, declaredBy: actorId, snapshot });
  return event;
}

/** Called with the transaction that transitions the payroll run to COMPLETED. */
export async function capturePayrollRunIn(tx: Tx, companyId: string, actorId: string, runId: string) {
  if (!isAccountingPostingEnabled()) return [];
  await payrollLock(tx, companyId); await activeActor(tx, companyId, actorId);
  const allocation = await loadPayrollPaymentSnapshot(tx, companyId, runId);
  const results = [];
  for (const receipt of allocation.receipts) {
    const event = await capture(tx, companyId, actorId, runId, { kind: "RECOGNITION", periodStart: allocation.periodStart,
      periodEnd: allocation.periodEnd, receipt, amountCents: payrollNetCents(receipt), bankAccountId: null });
    results.push(await postPayrollEventIn(tx, event));
  }
  return results;
}

/** Treasury confirmation and immutable per-receipt cash facts share a transaction. */
export async function capturePayrollPaymentIn(tx: Tx, companyId: string, actorId: string, itemId: string) {
  if (!isAccountingPostingEnabled()) return [];
  await payrollLock(tx, companyId); await activeActor(tx, companyId, actorId);
  const [item] = await tx.select({ snapshot: paymentRunItems.payrollSnapshot, runId: paymentRunItems.referenceId,
    status: paymentRunItems.settlementStatus, settledAt: paymentRunItems.settledAt, reference: paymentRunItems.settlementReference,
    bankAccountId: paymentRuns.sourceBankAccountId }).from(paymentRunItems).innerJoin(paymentRuns, and(
      eq(paymentRuns.id, paymentRunItems.paymentRunId), eq(paymentRuns.companyId, companyId)))
    .where(and(eq(paymentRunItems.id, itemId), eq(paymentRunItems.itemType, "PAYROLL"))).limit(1);
  if (!item || item.status !== "CONFIRMED" || !item.settledAt || !item.reference?.trim()) {
    throw ApiError.conflict("El pago de nómina no está confirmado con fecha y referencia.");
  }
  const allocation: PayrollPaymentSnapshot = parsePayrollSnapshot(item.snapshot);
  if (allocation.companyId !== companyId || allocation.payrollRunId !== item.runId) throw ApiError.conflict("El reparto no corresponde a esta nómina y empresa.");
  const results = [];
  for (const receipt of allocation.receipts) {
    const amountCents = payrollNetCents(receipt);
    if (!amountCents) continue;
    const event = await capture(tx, companyId, actorId, item.runId, { kind: "PAYMENT", periodStart: allocation.periodStart,
      periodEnd: allocation.periodEnd, receipt, amountCents, bankAccountId: item.bankAccountId }, itemId, item.settledAt.toISOString().slice(0, 10));
    results.push(await postPayrollEventIn(tx, event));
  }
  return results;
}

export async function postPayrollEventIn(tx: Tx, input: Event, posterId?: string) {
  if (!isAccountingPostingEnabled()) return { journal: null, reason: "La contabilización automática está deshabilitada." };
  await payrollLock(tx, input.companyId);
  const event = await eventOf(tx, input.companyId, input.id);
  if (event.status === "POSTED") return { journal: { id: event.journalId! }, reason: null };
  const pending = async (reason: string) => {
    const result = { journal: null, reason }; await finishAccountingEventIn(tx, event, result); return result;
  };
  const actorId = posterId ?? event.actorId, actor = await activeActor(tx, event.companyId, actorId);
  if (!hasPermission(actor.role, "accounting", "publish")) return pending("La nómina requiere publicación por un responsable contable autorizado.");
  const [fact] = await tx.select().from(accountingPayrollFacts).where(and(eq(accountingPayrollFacts.companyId, event.companyId),
    eq(accountingPayrollFacts.eventId, event.id))).limit(1);
  if (!fact || !event.accountingDate) return pending(event.lastError ?? "Falta el recibo confirmado y congelado de nómina.");
  const snapshot = fact.snapshot as Snapshot;
  const [receipt] = await tx.select({ status: payrollPayslips.cfdiStatus }).from(payrollPayslips).where(eq(payrollPayslips.id, fact.payslipId)).limit(1);
  if (receipt?.status !== "TIMBRADO") return pending("El recibo ya no está timbrado; requiere revisión y corrección auditada.");
  const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(eq(financialPeriods.companyId, event.companyId),
    eq(financialPeriods.year, Number(event.accountingDate.slice(0, 4))), eq(financialPeriods.month, Number(event.accountingDate.slice(5, 7))),
    eq(financialPeriods.status, "CLOSED"))).limit(1);
  if (closed) return pending("El periodo de nómina está cerrado; requiere revisión antes de publicar.");
  let anchor: { snapshot: Record<string, unknown>; journalId: string } | undefined;
  if (snapshot.kind === "PAYMENT") {
    [anchor] = await tx.select({ snapshot: accountingPayrollFacts.snapshot, journalId: accountingEvents.journalId })
      .from(accountingPayrollFacts).innerJoin(accountingEvents, and(eq(accountingEvents.id, accountingPayrollFacts.eventId), eq(accountingEvents.status, "POSTED")))
      .where(and(eq(accountingPayrollFacts.companyId, event.companyId), eq(accountingPayrollFacts.payslipId, fact.payslipId), eq(accountingPayrollFacts.kind, "RECOGNITION"))).limit(1);
    if (!anchor) return pending("Falta la obligación original de nómina publicada.");
    if (JSON.stringify(anchor.snapshot.receipt) !== JSON.stringify(snapshot.receipt)) return pending("El pago no coincide con el recibo reconocido originalmente.");
    const used = await tx.select({ snapshot: accountingPayrollFacts.snapshot }).from(accountingPayrollFacts)
      .innerJoin(accountingEvents, and(eq(accountingEvents.id, accountingPayrollFacts.eventId), eq(accountingEvents.status, "POSTED")))
      .where(and(eq(accountingPayrollFacts.companyId, event.companyId), eq(accountingPayrollFacts.payslipId, fact.payslipId), eq(accountingPayrollFacts.kind, "PAYMENT")));
    if (sumCents([...used.map(row => Number(row.snapshot.amountCents)), snapshot.amountCents]) > Number(anchor.snapshot.amountCents)) {
      return pending("El pago excede el neto pendiente de nómina.");
    }
  }
  const plan = snapshot.kind === "RECOGNITION" ? payrollPlan({ kind: "RECOGNITION", ...snapshot.receipt })
    : payrollPlan({ kind: "PAYMENT", amountCents: snapshot.amountCents, netCents: Number(anchor!.snapshot.amountCents), paidCents: 0 });
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.companyId},505))`);
  const rule = await resolveRuleIn(tx, event.companyId, event.eventType, event.accountingDate), blocker = ruleBlockerMessage(rule);
  if (blocker) return pending(blocker);
  const lines: Parameters<typeof insertJournalLines>[3] = [];
  for (const line of plan) {
    const entry = rule.entries.find(entry => entry.role === line.role);
    let accountId = entry?.accountId, costCenterId = entry?.costCenterId ?? null;
    if (line.role === "PAYMENT_SOURCE") {
      const [bank] = snapshot.bankAccountId ? await tx.select({ accountId: accountingSourceLinks.accountId }).from(companyBankAccounts)
        .innerJoin(accountingSourceLinks, and(eq(accountingSourceLinks.companyId, event.companyId), eq(accountingSourceLinks.bankAccountId, companyBankAccounts.id)))
        .where(and(eq(companyBankAccounts.companyId, event.companyId), eq(companyBankAccounts.id, snapshot.bankAccountId),
          eq(companyBankAccounts.active, true), eq(companyBankAccounts.currency, "MXN"))).limit(1) : [];
      accountId = bank?.accountId; costCenterId = null;
    }
    if (!accountId) return pending(`Falta una cuenta explícita para ${line.role} de nómina.`);
    const [account] = await tx.select().from(accountingAccounts).where(and(eq(accountingAccounts.companyId, event.companyId), eq(accountingAccounts.id, accountId))).limit(1);
    const kind = line.role === "PAYROLL_EXPENSE" ? "EXPENSE" : line.role === "PAYMENT_SOURCE" ? "ASSET" : "LIABILITY";
    if (!account || account.kind !== kind || !account.active || !account.postable || account.validFrom > event.accountingDate
      || (account.validTo && account.validTo < event.accountingDate)) return pending(`La cuenta de ${line.role} no es utilizable en la fecha de nómina.`);
    if (anchor && line.role === "PAYROLL_PAYABLE") {
      const saved = await tx.select().from(accountingJournalLines).where(and(eq(accountingJournalLines.companyId, event.companyId),
        eq(accountingJournalLines.journalId, anchor.journalId), eq(accountingJournalLines.memo, "PAYROLL:PAYROLL_PAYABLE")));
      if (saved.length !== 1 || saved[0].accountId !== accountId || saved[0].costCenterId !== costCenterId) {
        return pending("La cuenta o centro del pago no coincide con la obligación original de nómina.");
      }
    }
    if (line.role === "TIPS_PAYABLE") {
      const [balance] = await tx.select({ cents: sql<string>`coalesce(sum(${accountingJournalLines.creditCents}-${accountingJournalLines.debitCents}),0)::text` })
        .from(accountingJournalLines).innerJoin(accountingJournals, and(eq(accountingJournals.id, accountingJournalLines.journalId), eq(accountingJournals.companyId, event.companyId)))
        .where(and(eq(accountingJournalLines.companyId, event.companyId), eq(accountingJournalLines.accountId, accountId),
          eq(accountingJournals.status, "POSTED"), sql`${accountingJournals.accountingDate}<=${event.accountingDate}::date`));
      if (!Number.isSafeInteger(Number(balance.cents)) || Number(balance.cents) < line.debitCents) return pending("Falta el pasivo original de propinas; no se crea otro gasto.");
    }
    lines.push({ accountId, costCenterId, debitCents: line.debitCents, creditCents: line.creditCents, memo: `PAYROLL:${line.role}` });
  }
  const [draft] = await tx.insert(accountingJournals).values({ companyId: event.companyId, branchId: event.branchId,
    accountingDate: event.accountingDate, businessDate: event.accountingDate, description: `Nómina ${snapshot.kind}: ${fact.payslipId}`,
    sourceType: event.sourceType, sourceId: event.sourceId, eventType: event.eventType, sourceVersion: 1,
    ruleId: rule.rule!.id, ruleVersion: rule.rule!.version, createdBy: actorId, updatedBy: actorId }).returning();
  await insertJournalLines(tx, event.companyId, draft.id, lines);
  const journal = await postInTransaction(tx, event.companyId, actorId, draft.id, draft.version, "Recibo confirmado y pago documentado sin repetir costo.");
  await finishAccountingEventIn(tx, event, { journal, reason: null });
  return { journal, reason: null };
}
