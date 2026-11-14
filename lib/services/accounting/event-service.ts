import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { accountingEvents, branches, dailySalesCuts, expensePayments, operatingExpenses, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission } from "@/lib/permissions";
import type { AccountingContext } from "./journal-service";
import { getCompanyOpeningDateIn, isCompanyPostingEnabledIn } from "./activation-service";
import { ensureRecognitionIn, isAccountingPostingEnabled, postPaymentIn } from "./expense-adapter";
import { finishAccountingEventIn, recordAccountingEventIn } from "./event-store";
import { postSalesEventIn } from "./sales-adapter";
import { postSettlementEventIn, recoverSettlementFacts } from "./settlement-adapter";
import { postPurchaseEventIn, PURCHASE_EVENTS } from "./purchase-adapter";
import { postPayrollEventIn, PAYROLL_SOURCES } from "./payroll-adapter";
import { postPettyCashEventIn, PETTY_CASH_SOURCES } from "./petty-cash-adapter";
import { isInventoryAccountingEnabled, postInventoryEventIn, recoverInventoryFacts } from "./inventory-adapter";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
const id = z.uuid();
export const pendingAccountingQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  branchId: z.uuid().optional(),
}).strict();

async function authorize(tx: Tx, ctx: AccountingContext, action: "read" | "publish") {
  const [actor] = await tx.select({ role: users.role, branchId: users.branchId }).from(users).where(and(
    eq(users.companyId, ctx.companyId), eq(users.id, ctx.actorId),
    eq(users.active, true), isNull(users.deletedAt),
  )).limit(1);
  if (!actor || actor.role !== ctx.role || !hasPermission(actor.role, "accounting", action)) {
    throw ApiError.forbidden("No tienes permiso para consultar o recuperar hechos contables.");
  }
  const scope = resolveBranchScope(actor.role, actor.branchId);
  if (scope.kind === "NONE" || (action === "publish" && scope.kind !== "ALL")) {
    throw ApiError.forbidden("No tienes alcance para recuperar estos hechos contables.");
  }
  return scope;
}

export function listPendingAccountingEvents(ctx: AccountingContext, input: z.input<typeof pendingAccountingQuery>) {
  const companyId = id.parse(ctx.companyId), query = pendingAccountingQuery.parse(input);
  return withCompanyContext({ companyId, actorId: ctx.actorId }, async tx => {
    const scope = await authorize(tx, ctx, "read");
    if (scope.kind === "BRANCH" && query.branchId && scope.branchId !== query.branchId) {
      throw ApiError.forbidden("La sucursal no está en tu ámbito.");
    }
    const branchId = scope.kind === "BRANCH" ? scope.branchId : query.branchId;
    const where = and(eq(accountingEvents.companyId, companyId), eq(accountingEvents.status, "PENDING"),
      branchId ? eq(accountingEvents.branchId, branchId) : undefined);
    const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(accountingEvents).where(where);
    const items = await tx.select({
      id: accountingEvents.id, branchId: accountingEvents.branchId,
      sourceType: accountingEvents.sourceType, sourceId: accountingEvents.sourceId,
      eventType: accountingEvents.eventType, sourceVersion: accountingEvents.sourceVersion,
      accountingDate: accountingEvents.accountingDate, attempts: accountingEvents.attempts,
      lastError: accountingEvents.lastError, createdAt: accountingEvents.createdAt,
      updatedAt: accountingEvents.updatedAt, nextAttemptAt: accountingEvents.nextAttemptAt,
      ageSeconds: sql<number>`greatest(0, floor(extract(epoch from (now() - ${accountingEvents.createdAt}))))::float8`,
    }).from(accountingEvents).where(where).orderBy(asc(accountingEvents.createdAt), asc(accountingEvents.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return { items, total: count.total, page: query.page, pageSize: query.pageSize };
  });
}

/** Internal worker boundary: the tenant comes from the server's company catalog. */
export function dueAccountingEvents(companyId: string) {
  return withCompanyContext({ companyId: id.parse(companyId) }, async tx => {
    if (!(await isCompanyPostingEnabledIn(tx, companyId))) return [];
    return tx.select({ id: accountingEvents.id })
      .from(accountingEvents).where(and(eq(accountingEvents.companyId, companyId),
        eq(accountingEvents.status, "PENDING"), lte(accountingEvents.nextAttemptAt, new Date())))
      .orderBy(asc(accountingEvents.nextAttemptAt), asc(accountingEvents.id)).limit(25);
  });
}

/** Bounded repair sweep for eligible sources saved before the outbox existed. */
export function recoverMissingAccountingEvents(companyId: string) {
  if (!isAccountingPostingEnabled()) throw new ApiError("La contabilización automática aún no está habilitada.", 503);
  return withCompanyContext({ companyId: id.parse(companyId) }, async tx => {
    if (!(await isCompanyPostingEnabledIn(tx, companyId))) {
      return { expenses: 0, payments: 0, sales: 0, settlements: 0, skipped: true };
    }
    const openingDate = await getCompanyOpeningDateIn(tx, companyId);
    const expenses = await tx.select({ id: operatingExpenses.id, branchId: operatingExpenses.branchId,
      actorId: operatingExpenses.approvedBy, date: operatingExpenses.businessDate }).from(operatingExpenses).where(and(
      eq(operatingExpenses.companyId, companyId), inArray(operatingExpenses.status, ["APPROVED", "PAID"]),
      openingDate ? gt(operatingExpenses.businessDate, openingDate) : undefined,
      isNotNull(operatingExpenses.approvedBy), notExists(tx.select({ id: accountingEvents.id }).from(accountingEvents).where(and(
        eq(accountingEvents.companyId, companyId), eq(accountingEvents.sourceType, "OPERATING_EXPENSE"),
        eq(accountingEvents.sourceId, operatingExpenses.id), eq(accountingEvents.eventType, "EXPENSE_RECOGNIZED"),
        eq(accountingEvents.sourceVersion, 1),
      ))),
    )).orderBy(asc(operatingExpenses.id)).limit(25);
    for (const expense of expenses) await recordAccountingEventIn(tx, { companyId, branchId: expense.branchId,
      sourceType: "OPERATING_EXPENSE", sourceId: expense.id, eventType: "EXPENSE_RECOGNIZED",
      actorId: expense.actorId!, accountingDate: expense.date });
    const payments = await tx.select().from(expensePayments).where(and(
      eq(expensePayments.companyId, companyId), eq(expensePayments.status, "CONFIRMED"),
      openingDate ? gt(expensePayments.paidAt, openingDate) : undefined,
      notExists(tx.select({ id: accountingEvents.id }).from(accountingEvents).where(and(
        eq(accountingEvents.companyId, companyId), eq(accountingEvents.sourceType, "EXPENSE_PAYMENT"),
        eq(accountingEvents.sourceId, expensePayments.id), eq(accountingEvents.eventType, "EXPENSE_PAYMENT"),
        eq(accountingEvents.sourceVersion, 1),
      ))),
    )).orderBy(asc(expensePayments.id)).limit(25);
    for (const payment of payments) await recordAccountingEventIn(tx, { companyId, branchId: payment.branchId,
      sourceType: "EXPENSE_PAYMENT", sourceId: payment.id, eventType: "EXPENSE_PAYMENT",
      actorId: payment.confirmedBy!, accountingDate: payment.paidAt });
    const sales = await tx.select({ id: dailySalesCuts.id, branchId: dailySalesCuts.branchId,
      businessDate: dailySalesCuts.businessDate, receivedBy: dailySalesCuts.receivedBy }).from(dailySalesCuts)
      .innerJoin(branches, and(eq(branches.id, dailySalesCuts.branchId), eq(branches.companyId, companyId)))
      .innerJoin(users, and(eq(users.id, dailySalesCuts.receivedBy), eq(users.companyId, companyId))).where(and(
      eq(dailySalesCuts.companyId, companyId), eq(dailySalesCuts.status, "VALIDATED"), isNotNull(dailySalesCuts.receivedBy),
      openingDate ? gt(dailySalesCuts.businessDate, openingDate) : undefined,
      notExists(tx.select({ id: accountingEvents.id }).from(accountingEvents).where(and(
        eq(accountingEvents.companyId, companyId), eq(accountingEvents.sourceType, "DAILY_SALES_CUT"),
        eq(accountingEvents.sourceId, dailySalesCuts.id), eq(accountingEvents.eventType, "SALE_RECOGNIZED"),
        eq(accountingEvents.sourceVersion, 1),
      ))),
    )).orderBy(asc(dailySalesCuts.id)).limit(25);
    for (const cut of sales) await recordAccountingEventIn(tx, { companyId, branchId: cut.branchId,
      sourceType: "DAILY_SALES_CUT", sourceId: cut.id, eventType: "SALE_RECOGNIZED", sourceVersion: 1,
      actorId: cut.receivedBy!, accountingDate: cut.businessDate });
    return { expenses: expenses.length, payments: payments.length, sales: sales.length,
      settlements: await recoverSettlementFacts(tx, companyId),
      ...(isInventoryAccountingEnabled() ? { inventory: await recoverInventoryFacts(tx, companyId) } : {}) };
  });
}

async function processIn(tx: Tx, companyId: string, eventId: string, posterId?: string) {
  const [event] = await tx.select().from(accountingEvents).where(and(
    eq(accountingEvents.companyId, companyId), eq(accountingEvents.id, eventId),
  )).limit(1);
  if (!event) throw ApiError.notFound("Hecho contable no encontrado en esta empresa.");
  if (event.status === "POSTED") return { journal: { id: event.journalId! }, reason: null };
  if (event.sourceType === "DAILY_SALES_CUT" || event.sourceType === "SALES_REFUND") return postSalesEventIn(tx, event);
  // The settlement adapter holds the sales company lock itself, in the same
  // order as the reconciliation that captured the fact; no source row lock here.
  if (event.sourceType === "GATEWAY_SETTLEMENT") return postSettlementEventIn(tx, event);
  if (Object.hasOwn(PURCHASE_EVENTS, event.sourceType)) return postPurchaseEventIn(tx, event);
  if (Object.hasOwn(PAYROLL_SOURCES, event.sourceType)) return postPayrollEventIn(tx, event, posterId);
  if (Object.hasOwn(PETTY_CASH_SOURCES, event.sourceType)) return postPettyCashEventIn(tx, event, posterId);
  if (event.sourceType === "INVENTORY_MOVEMENT") return postInventoryEventIn(tx, event);

  // Match the source transaction's lock order. Locking the outbox first would
  // deadlock with approval/settlement, which hold their source before the fact.
  if (event.sourceType === "OPERATING_EXPENSE") {
    const [expense] = await tx.select().from(operatingExpenses).where(and(
      eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, event.sourceId),
    )).for("update").limit(1);
    if (expense && expense.branchId === event.branchId) {
      return ensureRecognitionIn(tx, companyId, event.actorId, expense);
    }
  } else {
    const [payment] = await tx.select().from(expensePayments).where(and(
      eq(expensePayments.companyId, companyId), eq(expensePayments.id, event.sourceId),
    )).for("update").limit(1);
    if (payment && payment.branchId === event.branchId && payment.status === "CONFIRMED") {
      await tx.select({ id: operatingExpenses.id }).from(operatingExpenses).where(and(
        eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, payment.expenseId),
      )).for("update").limit(1);
      const result = await postPaymentIn(tx, companyId, event.actorId, payment);
      await tx.update(expensePayments).set({ pendingReason: result.journal ? null : result.reason, updatedAt: new Date() })
        .where(and(eq(expensePayments.companyId, companyId), eq(expensePayments.id, payment.id)));
      return result;
    }
  }
  const result = { journal: null, reason: "El origen del hecho no existe o ya no es elegible en esta sucursal." };
  await finishAccountingEventIn(tx, event, result);
  return result;
}

async function attempt(companyId: string, eventId: string, ctx?: AccountingContext) {
  id.parse(companyId); id.parse(eventId);
  if (!isAccountingPostingEnabled()) throw new ApiError("La contabilización automática aún no está habilitada.", 503);
  // Authorization failures must never update diagnostics of an inaccessible fact.
  let authorized = !ctx;
  try {
    return await withCompanyContext({ companyId, actorId: ctx?.actorId }, async tx => {
      if (ctx) { await authorize(tx, ctx, "publish"); authorized = true; }
      if (!(await isCompanyPostingEnabledIn(tx, companyId))) {
        if (ctx) throw new ApiError("La contabilización automática está desactivada para esta empresa.", 409);
        return { journal: null, reason: "La contabilización automática está desactivada para esta empresa." };
      }
      return processIn(tx, companyId, eventId, ctx?.actorId);
    });
  } catch (error) {
    if (authorized && !(isApiError(error) && error.statusCode === 404)) {
      // Independent transaction: a failed SQL statement rolls back the posting,
      // then leaves a safe error for the next cron/retry. Never expose raw SQL.
      await withCompanyContext({ companyId }, tx => tx.update(accountingEvents).set({
        attempts: sql`${accountingEvents.attempts} + 1`, lastError: "No se pudo publicar el hecho. Reintenta; si persiste, revisa el servicio contable.",
        updatedAt: new Date(), nextAttemptAt: new Date(Date.now() + 5 * 60_000),
      }).where(and(eq(accountingEvents.companyId, companyId), eq(accountingEvents.id, eventId),
        eq(accountingEvents.status, "PENDING"))));
    }
    throw error;
  }
}

export function processAccountingEvent(companyId: string, eventId: string) { return attempt(companyId, eventId); }

/** Authenticated manual retry; published journals and closed periods stay intact. */
export function retryAccountingEvent(ctx: AccountingContext, eventId: string) { return attempt(ctx.companyId, eventId, ctx); }
