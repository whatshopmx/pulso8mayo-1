import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import {
  accountingAccounts,
  accountingEvents,
  accountingJournals,
  accountingOpenings,
  accountingPettyCashFacts,
  accountingSourceLinks,
  companyBankAccounts,
  costCenters,
  financialPeriods,
  operatingExpenses,
  paymentRunItems,
  paymentRuns,
  pettyCashFunds,
  pettyCashTransactions,
  users,
} from "@/lib/db/schema";
import type { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { finishAccountingEventIn, recordAccountingEventIn } from "./event-store";
import { isAccountingPostingEnabled } from "./expense-adapter";
import { insertJournalLines, postInTransaction } from "./journal-service";
import { resolveRuleIn, ruleBlockerMessage } from "./mapping-service";
import {
  isPettyCashOpeningConcept,
  normalizeAccountingVoucherKey,
  pettyCashPlan,
} from "./petty-cash-contract";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Event = typeof accountingEvents.$inferSelect;

export type PettyCashSnapshot =
  | {
      kind: "OUT";
      transactionId: string;
      fundId: string;
      branchId: string;
      amountCents: number;
      taxCents: number;
      costCenterId: string | null;
      voucherKey: string;
      accountingDate: string;
    }
  | {
      kind: "REPLENISHMENT";
      transactionId: string;
      fundId: string;
      branchId: string;
      paymentRunItemId: string;
      amountCents: number;
      bankAccountId: string | null;
      accountingDate: string;
    };

export const PETTY_CASH_SOURCES = {
  PETTY_CASH_OUT: "PETTY_CASH_EXPENSE",
  PETTY_CASH_REPLENISHMENT: "PETTY_CASH_REPLENISHED",
} as const;

export const pettyCashLock = (tx: Tx, companyId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId},617))`);

async function activeActor(tx: Tx, companyId: string, actorId: string) {
  const [actor] = await tx
    .select({ role: users.role })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.id, actorId),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa.");
  return actor;
}

async function eventOf(tx: Tx, companyId: string, eventId: string) {
  const [event] = await tx
    .select()
    .from(accountingEvents)
    .where(and(eq(accountingEvents.companyId, companyId), eq(accountingEvents.id, eventId)))
    .limit(1);
  if (!event) throw ApiError.notFound("El hecho de caja chica no existe en esta empresa.");
  return event;
}

/**
 * Checks whether a canonical voucher key is already used by another non-rejected
 * operating expense or petty cash outflow in the same company.
 */
export async function hasDuplicateVoucherIn(
  tx: Tx,
  companyId: string,
  voucherKey: string,
  opts: {
    excludeExpenseId?: string;
    excludeTransactionId?: string;
    excludeFactId?: string;
  } = {},
): Promise<boolean> {
  const [dupExpense] = await tx
    .select({ id: operatingExpenses.id })
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        ne(operatingExpenses.status, "REJECTED"),
        opts.excludeExpenseId ? ne(operatingExpenses.id, opts.excludeExpenseId) : undefined,
        sql`upper(btrim(regexp_replace(${operatingExpenses.voucherReference}, '\s+', ' ', 'g'))) = ${voucherKey}`,
      ),
    )
    .limit(1);
  if (dupExpense) return true;

  const [dupTx] = await tx
    .select({ id: pettyCashTransactions.id })
    .from(pettyCashTransactions)
    .innerJoin(
      pettyCashFunds,
      and(
        eq(pettyCashFunds.id, pettyCashTransactions.fundId),
        eq(pettyCashFunds.companyId, companyId),
      ),
    )
    .where(
      and(
        eq(pettyCashTransactions.type, "OUT"),
        opts.excludeTransactionId ? ne(pettyCashTransactions.id, opts.excludeTransactionId) : undefined,
        sql`upper(btrim(regexp_replace(${pettyCashTransactions.voucherReference}, '\s+', ' ', 'g'))) = ${voucherKey}`,
      ),
    )
    .limit(1);
  if (dupTx) return true;

  const [dupFact] = await tx
    .select({ id: accountingPettyCashFacts.id })
    .from(accountingPettyCashFacts)
    .where(
      and(
        eq(accountingPettyCashFacts.companyId, companyId),
        eq(accountingPettyCashFacts.voucherKey, voucherKey),
        opts.excludeFactId ? ne(accountingPettyCashFacts.id, opts.excludeFactId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(dupFact);
}

async function ensureFactForEventIn(tx: Tx, event: Event, actorId: string) {
  const [existing] = await tx
    .select()
    .from(accountingPettyCashFacts)
    .where(
      and(
        eq(accountingPettyCashFacts.companyId, event.companyId),
        eq(accountingPettyCashFacts.eventId, event.id),
      ),
    )
    .limit(1);
  if (existing) return { fact: existing, reason: null as string | null };

  const [row] = await tx
    .select({
      tx: pettyCashTransactions,
      fundId: pettyCashFunds.id,
      branchId: pettyCashFunds.branchId,
    })
    .from(pettyCashTransactions)
    .innerJoin(
      pettyCashFunds,
      and(
        eq(pettyCashFunds.id, pettyCashTransactions.fundId),
        eq(pettyCashFunds.companyId, event.companyId),
      ),
    )
    .where(eq(pettyCashTransactions.id, event.sourceId))
    .limit(1);

  if (!row) {
    return { fact: null, reason: "El movimiento de caja chica ya no existe en esta empresa." };
  }

  if (event.sourceType === "PETTY_CASH_OUT") {
    if (row.tx.type !== "OUT") {
      return { fact: null, reason: "El movimiento no corresponde a una salida de caja chica." };
    }
    if (!row.tx.businessDate || !event.accountingDate || row.tx.businessDate !== event.accountingDate) {
      return {
        fact: null,
        reason: "La salida de caja chica no tiene fecha de negocio explícita; no se infiere la fecha contable.",
      };
    }
    if (row.tx.amount <= 0) {
      return { fact: null, reason: "La salida de caja chica debe tener un importe positivo." };
    }
    if (row.tx.taxAmount === null || row.tx.taxAmount === undefined) {
      return {
        fact: null,
        reason: "Falta documentar el impuesto de la salida de caja chica; cero debe declararse explícitamente.",
      };
    }
    if (!Number.isSafeInteger(row.tx.taxAmount) || row.tx.taxAmount < 0 || row.tx.taxAmount >= row.tx.amount) {
      return {
        fact: null,
        reason: "El impuesto documentado debe ser no negativo y menor al importe bruto de caja chica.",
      };
    }
    let voucherKey: string;
    try {
      voucherKey = normalizeAccountingVoucherKey(row.tx.voucherReference);
    } catch (error) {
      return {
        fact: null,
        reason: error instanceof Error ? error.message : "Falta la clave documental del comprobante de caja chica.",
      };
    }
    const snapshot: PettyCashSnapshot = {
      kind: "OUT",
      transactionId: row.tx.id,
      fundId: row.fundId,
      branchId: row.branchId,
      amountCents: row.tx.amount,
      taxCents: row.tx.taxAmount,
      costCenterId: row.tx.costCenterId ?? null,
      voucherKey,
      accountingDate: row.tx.businessDate,
    };
    const [created] = await tx
      .insert(accountingPettyCashFacts)
      .values({
        id: randomUUID(),
        eventId: event.id,
        companyId: event.companyId,
        branchId: row.branchId,
        fundId: row.fundId,
        transactionId: row.tx.id,
        paymentRunItemId: null,
        kind: "OUT",
        voucherKey,
        declaredBy: actorId,
        snapshot,
      })
      .returning();
    return { fact: created, reason: null as string | null };
  }

  if (row.tx.type !== "REPLENISHMENT" || isPettyCashOpeningConcept(row.tx.concept)) {
    return {
      fact: null,
      reason: "La apertura o reapertura del fondo no se contabiliza como reposición operativa.",
    };
  }
  if (!row.tx.paymentRunItemId) {
    return {
      fact: null,
      reason: "La reposición de caja chica requiere vincular la partida confirmada de tesorería (PETTY_CASH_REIMBURSEMENT).",
    };
  }
  const [payment] = await tx
    .select({
      id: paymentRunItems.id,
      amountCents: paymentRunItems.amountCents,
      status: paymentRunItems.settlementStatus,
      settledAt: paymentRunItems.settledAt,
      reference: paymentRunItems.settlementReference,
      bankAccountId: paymentRuns.sourceBankAccountId,
    })
    .from(paymentRunItems)
    .innerJoin(
      paymentRuns,
      and(
        eq(paymentRuns.id, paymentRunItems.paymentRunId),
        eq(paymentRuns.companyId, event.companyId),
      ),
    )
    .where(
      and(
        eq(paymentRunItems.id, row.tx.paymentRunItemId),
        eq(paymentRunItems.itemType, "PETTY_CASH_REIMBURSEMENT"),
        eq(paymentRunItems.referenceId, row.fundId),
      ),
    )
    .limit(1);

  if (!payment || payment.status !== "CONFIRMED" || !payment.settledAt || !payment.reference?.trim()) {
    return {
      fact: null,
      reason: "La partida de reposición de caja chica aún no está confirmada con fecha y referencia en tesorería.",
    };
  }
  if (payment.amountCents !== row.tx.amount) {
    return {
      fact: null,
      reason: "El importe de la reposición de caja chica no coincide con la partida confirmada de tesorería.",
    };
  }
  const expectedDate = row.tx.businessDate ?? payment.settledAt.toISOString().slice(0, 10);
  if (!event.accountingDate || event.accountingDate !== expectedDate) {
    return {
      fact: null,
      reason: "La fecha contable de la reposición no coincide con la fecha del movimiento o liquidación.",
    };
  }
  const snapshot: PettyCashSnapshot = {
    kind: "REPLENISHMENT",
    transactionId: row.tx.id,
    fundId: row.fundId,
    branchId: row.branchId,
    paymentRunItemId: payment.id,
    amountCents: row.tx.amount,
    bankAccountId: payment.bankAccountId ?? null,
    accountingDate: expectedDate,
  };
  const [created] = await tx
    .insert(accountingPettyCashFacts)
    .values({
      id: randomUUID(),
      eventId: event.id,
      companyId: event.companyId,
      branchId: row.branchId,
      fundId: row.fundId,
      transactionId: row.tx.id,
      paymentRunItemId: payment.id,
      kind: "REPLENISHMENT",
      voucherKey: null,
      declaredBy: actorId,
      snapshot,
    })
    .returning();
  return { fact: created, reason: null as string | null };
}

/** Captures a petty cash outflow (OUT) within the same transaction that deducts the fund balance. */
export async function capturePettyCashOutflowIn(
  tx: Tx,
  companyId: string,
  actorId: string,
  transactionId: string,
) {
  if (!isAccountingPostingEnabled()) {
    return { journal: null, reason: "La contabilización automática está deshabilitada." };
  }
  await pettyCashLock(tx, companyId);
  await activeActor(tx, companyId, actorId);
  const [row] = await tx
    .select({
      id: pettyCashTransactions.id,
      type: pettyCashTransactions.type,
      businessDate: pettyCashTransactions.businessDate,
      branchId: pettyCashFunds.branchId,
    })
    .from(pettyCashTransactions)
    .innerJoin(
      pettyCashFunds,
      and(
        eq(pettyCashFunds.id, pettyCashTransactions.fundId),
        eq(pettyCashFunds.companyId, companyId),
      ),
    )
    .where(eq(pettyCashTransactions.id, transactionId))
    .limit(1);
  if (!row || row.type !== "OUT") {
    throw ApiError.notFound("La salida de caja chica no existe en esta empresa.");
  }
  const identity = {
    companyId,
    actorId,
    branchId: row.branchId,
    sourceType: "PETTY_CASH_OUT",
    sourceId: row.id,
    eventType: PETTY_CASH_SOURCES.PETTY_CASH_OUT,
    sourceVersion: 1,
    accountingDate: row.businessDate ?? null,
  };
  await recordAccountingEventIn(tx, identity);
  const [event] = await tx
    .select()
    .from(accountingEvents)
    .where(
      and(
        eq(accountingEvents.companyId, companyId),
        eq(accountingEvents.sourceType, identity.sourceType),
        eq(accountingEvents.sourceId, identity.sourceId),
        eq(accountingEvents.sourceVersion, 1),
      ),
    )
    .limit(1);
  return postPettyCashEventIn(tx, event, actorId);
}

/** Captures a petty cash replenishment (excluding fund opening/reopening). */
export async function capturePettyCashReplenishmentIn(
  tx: Tx,
  companyId: string,
  actorId: string,
  transactionId: string,
) {
  if (!isAccountingPostingEnabled()) {
    return { journal: null, reason: "La contabilización automática está deshabilitada." };
  }
  await pettyCashLock(tx, companyId);
  await activeActor(tx, companyId, actorId);
  const [row] = await tx
    .select({
      id: pettyCashTransactions.id,
      type: pettyCashTransactions.type,
      concept: pettyCashTransactions.concept,
      businessDate: pettyCashTransactions.businessDate,
      paymentRunItemId: pettyCashTransactions.paymentRunItemId,
      branchId: pettyCashFunds.branchId,
    })
    .from(pettyCashTransactions)
    .innerJoin(
      pettyCashFunds,
      and(
        eq(pettyCashFunds.id, pettyCashTransactions.fundId),
        eq(pettyCashFunds.companyId, companyId),
      ),
    )
    .where(eq(pettyCashTransactions.id, transactionId))
    .limit(1);
  if (!row || row.type !== "REPLENISHMENT") {
    throw ApiError.notFound("La reposición de caja chica no existe en esta empresa.");
  }
  if (isPettyCashOpeningConcept(row.concept)) {
    return { journal: null, reason: null };
  }
  let accountingDate = row.businessDate ?? null;
  if (!accountingDate && row.paymentRunItemId) {
    const [item] = await tx
      .select({ settledAt: paymentRunItems.settledAt })
      .from(paymentRunItems)
      .innerJoin(
        paymentRuns,
        and(eq(paymentRuns.id, paymentRunItems.paymentRunId), eq(paymentRuns.companyId, companyId)),
      )
      .where(eq(paymentRunItems.id, row.paymentRunItemId))
      .limit(1);
    if (item?.settledAt) {
      accountingDate = item.settledAt.toISOString().slice(0, 10);
    }
  }
  const identity = {
    companyId,
    actorId,
    branchId: row.branchId,
    sourceType: "PETTY_CASH_REPLENISHMENT",
    sourceId: row.id,
    eventType: PETTY_CASH_SOURCES.PETTY_CASH_REPLENISHMENT,
    sourceVersion: 1,
    accountingDate,
  };
  await recordAccountingEventIn(tx, identity);
  const [event] = await tx
    .select()
    .from(accountingEvents)
    .where(
      and(
        eq(accountingEvents.companyId, companyId),
        eq(accountingEvents.sourceType, identity.sourceType),
        eq(accountingEvents.sourceId, identity.sourceId),
        eq(accountingEvents.sourceVersion, 1),
      ),
    )
    .limit(1);
  return postPettyCashEventIn(tx, event, actorId);
}

/** Invoked when a PETTY_CASH_REIMBURSEMENT treasury item is confirmed. */
export async function capturePettyCashReplenishmentByItemIn(
  tx: Tx,
  companyId: string,
  actorId: string,
  paymentRunItemId: string,
) {
  if (!isAccountingPostingEnabled()) return null;
  const [row] = await tx
    .select({ id: pettyCashTransactions.id })
    .from(pettyCashTransactions)
    .innerJoin(
      pettyCashFunds,
      and(
        eq(pettyCashFunds.id, pettyCashTransactions.fundId),
        eq(pettyCashFunds.companyId, companyId),
      ),
    )
    .where(
      and(
        eq(pettyCashTransactions.type, "REPLENISHMENT"),
        eq(pettyCashTransactions.paymentRunItemId, paymentRunItemId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return capturePettyCashReplenishmentIn(tx, companyId, actorId, row.id);
}

export async function postPettyCashEventIn(tx: Tx, input: Event, posterId?: string) {
  if (!isAccountingPostingEnabled()) {
    return { journal: null, reason: "La contabilización automática está deshabilitada." };
  }
  await pettyCashLock(tx, input.companyId);
  const event = await eventOf(tx, input.companyId, input.id);
  if (event.status === "POSTED") {
    return { journal: { id: event.journalId! }, reason: null };
  }
  const pending = async (reason: string) => {
    const result = { journal: null, reason };
    await finishAccountingEventIn(tx, event, result);
    return result;
  };
  const actorId = posterId ?? event.actorId;
  const actor = await activeActor(tx, event.companyId, actorId);
  if (!hasPermission(actor.role, "accounting", "publish")) {
    return pending("Caja chica requiere publicación por un responsable contable autorizado.");
  }

  const { fact, reason: factReason } = await ensureFactForEventIn(tx, event, actorId);
  if (!fact || !event.accountingDate) {
    return pending(factReason ?? event.lastError ?? "Falta el hecho documentado de caja chica.");
  }
  const snapshot = fact.snapshot as PettyCashSnapshot;

  const [closed] = await tx
    .select({ id: financialPeriods.id })
    .from(financialPeriods)
    .where(
      and(
        eq(financialPeriods.companyId, event.companyId),
        eq(financialPeriods.year, Number(event.accountingDate.slice(0, 4))),
        eq(financialPeriods.month, Number(event.accountingDate.slice(5, 7))),
        eq(financialPeriods.status, "CLOSED"),
      ),
    )
    .limit(1);
  if (closed) {
    return pending("El periodo de caja chica está cerrado; requiere revisión antes de publicar.");
  }

  const [opening] = await tx
    .select({ date: accountingOpenings.openingDate })
    .from(accountingOpenings)
    .where(eq(accountingOpenings.companyId, event.companyId))
    .limit(1);
  if (opening && event.accountingDate <= opening.date) {
    return pending(`La fecha de caja chica debe ser posterior a la apertura del ${opening.date}.`);
  }

  if (snapshot.kind === "OUT") {
    const duplicated = await hasDuplicateVoucherIn(tx, event.companyId, snapshot.voucherKey, {
      excludeTransactionId: snapshot.transactionId,
      excludeFactId: fact.id,
    });
    if (duplicated) {
      return pending(
        "El comprobante ya está registrado en gastos operativos o en otro movimiento de caja chica; requiere revisión para evitar duplicación.",
      );
    }
  }

  const plan =
    snapshot.kind === "OUT"
      ? pettyCashPlan({ kind: "OUT", amountCents: snapshot.amountCents, taxCents: snapshot.taxCents })
      : pettyCashPlan({ kind: "REPLENISHMENT", amountCents: snapshot.amountCents });

  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.companyId},505))`);
  const rule = await resolveRuleIn(tx, event.companyId, event.eventType, event.accountingDate);
  const blocker = ruleBlockerMessage(rule);
  if (blocker) return pending(blocker);

  const lines: Parameters<typeof insertJournalLines>[3] = [];
  for (const line of plan) {
    const entry = rule.entries.find(candidate => candidate.role === line.role);
    let accountId = entry?.accountId;
    let costCenterId = entry?.costCenterId ?? null;

    if (line.role === "EXPENSE" && snapshot.kind === "OUT" && snapshot.costCenterId) {
      const [link] = await tx
        .select({
          accountId: accountingSourceLinks.accountId,
          centerActive: costCenters.active,
        })
        .from(accountingSourceLinks)
        .innerJoin(
          costCenters,
          and(
            eq(costCenters.companyId, event.companyId),
            eq(costCenters.id, accountingSourceLinks.costCenterId),
          ),
        )
        .where(
          and(
            eq(accountingSourceLinks.companyId, event.companyId),
            eq(accountingSourceLinks.costCenterId, snapshot.costCenterId),
          ),
        )
        .limit(1);
      if (!link || !link.centerActive) {
        return pending("La partida de caja chica no tiene una cuenta activa vinculada.");
      }
      accountId = link.accountId;
      costCenterId = snapshot.costCenterId;
    } else if (line.role === "PAYMENT_SOURCE" && snapshot.kind === "REPLENISHMENT") {
      const [bank] = snapshot.bankAccountId
        ? await tx
            .select({ accountId: accountingSourceLinks.accountId })
            .from(companyBankAccounts)
            .innerJoin(
              accountingSourceLinks,
              and(
                eq(accountingSourceLinks.companyId, event.companyId),
                eq(accountingSourceLinks.bankAccountId, companyBankAccounts.id),
              ),
            )
            .where(
              and(
                eq(companyBankAccounts.companyId, event.companyId),
                eq(companyBankAccounts.id, snapshot.bankAccountId),
                eq(companyBankAccounts.active, true),
                eq(companyBankAccounts.currency, "MXN"),
              ),
            )
            .limit(1)
        : [];
      accountId = bank?.accountId;
      costCenterId = null;
    }

    if (!accountId) {
      return pending(`Falta una cuenta explícita para ${line.role} de caja chica.`);
    }
    const [account] = await tx
      .select()
      .from(accountingAccounts)
      .where(and(eq(accountingAccounts.companyId, event.companyId), eq(accountingAccounts.id, accountId)))
      .limit(1);
    const allowedKinds =
      line.role === "EXPENSE"
        ? snapshot.kind === "OUT" && snapshot.costCenterId
          ? ["EXPENSE", "ASSET"]
          : ["EXPENSE"]
        : ["ASSET"];
    if (
      !account
      || !allowedKinds.includes(account.kind)
      || !account.active
      || !account.postable
      || account.validFrom > event.accountingDate
      || (account.validTo && account.validTo < event.accountingDate)
    ) {
      return pending(`La cuenta de ${line.role} no es utilizable en la fecha de caja chica.`);
    }
    lines.push({
      accountId,
      costCenterId,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      memo: `PETTY_CASH:${line.role}`,
    });
  }

  const [draft] = await tx
    .insert(accountingJournals)
    .values({
      companyId: event.companyId,
      branchId: event.branchId,
      accountingDate: event.accountingDate,
      businessDate: event.accountingDate,
      description: `Caja chica ${snapshot.kind}: ${fact.transactionId}`,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      eventType: event.eventType,
      sourceVersion: 1,
      ruleId: rule.rule!.id,
      ruleVersion: rule.rule!.version,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();
  await insertJournalLines(tx, event.companyId, draft.id, lines);
  const journal = await postInTransaction(
    tx,
    event.companyId,
    actorId,
    draft.id,
    draft.version,
    snapshot.kind === "OUT"
      ? "Gasto de caja chica con comprobante e impuesto documentados."
      : "Reposición de caja chica desde cuenta bancaria propia sin crear gasto.",
  );
  await finishAccountingEventIn(tx, event, { journal, reason: null });
  return { journal, reason: null };
}
