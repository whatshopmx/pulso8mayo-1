import { and, eq, isNull, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { hasPermission } from "@/lib/permissions";
import { resolveBranchScope, type BranchScope } from "@/lib/branch-scope";
import {
  accountingJournals,
  accountingAccounts,
  accountingOpenings,
  accountingJournalLines,
  accountingSourceLinks,
  companyBankAccounts,
  costCenters,
  expensePayments,
  financialPeriods,
  operatingExpenses,
  paymentRunItems,
  paymentRuns,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { MAX_CENTS } from "./amounts";
import { insertJournalLines, postInTransaction } from "./journal-service";
import { resolveRuleIn, ruleBlockerMessage } from "./mapping-service";
import { recordAccountingEventIn, finishAccountingEventIn } from "./event-store";

/**
 * FC-09 — gasto reconocido y pagos parciales.
 *
 * Un gasto aprobado produce **una** obligación (cargo al gasto, abono a
 * proveedores) y cada abono confirmado produce **una** salida (cargo a
 * proveedores, abono a la cuenta de pago). Reconocer el gasto y pagarlo son
 * hechos distintos: pagar no vuelve a registrar el gasto, y reconocer no afirma
 * que ya salió el dinero.
 *
 * Idempotencia: la póliza de cada hecho lleva `source_type`/`source_id`/
 * `event_type` con versión; el índice único de `accounting_journals` y el lock
 * de asesor por fuente impiden dos pólizas para el mismo hecho. Además, la
 * aplicación de pago guarda su `accountingJournalId`. Los abonos manuales
 * parciales exigen un `paymentId` estable en sus entradas públicas: reintentar
 * con los mismos datos devuelve el hecho original; cambiarlos produce conflicto.
 *
 * Los bloqueos de configuración (regla, cuenta, fecha) **no** borran el hecho:
 * la aplicación queda registrada con `pendingReason` y sin póliza, para que
 * FC-10 la recupere. Los errores de identidad, ámbito o periodo cerrado sí
 * rechazan la operación completa.
 */
export const EXPENSE_RECOGNIZED = "EXPENSE_RECOGNIZED";
export const EXPENSE_PAYMENT = "EXPENSE_PAYMENT";

/** Roles que la regla debe mapear, por hecho. */
export const EXPENSE_ROLES = { debit: "EXPENSE", credit: "PAYABLE" } as const;
export const PAYMENT_ROLES = { debit: "PAYABLE", credit: "PAYMENT_SOURCE" } as const;

/**
 * La contabilización automática se habilita por entorno y solo después de
 * aplicar las migraciones contables. Sin la bandera, los servicios operativos
 * conservan su comportamiento anterior y no tocan `expense_payments`; FC-20
 * sustituirá esta bandera por activación por empresa.
 */
export function isAccountingPostingEnabled() {
  return process.env.ACCOUNTING_POSTING_ENABLED === "1";
}

export interface ExpenseAccountingContext { companyId: string; actorId: string }
type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type ExpenseRow = typeof operatingExpenses.$inferSelect;
type PaymentRow = typeof expensePayments.$inferSelect;
type RuleEntry = Awaited<ReturnType<typeof resolveRuleIn>>["entries"][number];

const day = z.iso.date().refine(value => value >= "0001-01-01", "Fecha inválida.");
const uuid = z.uuid();

const paymentInputSchema = z.object({
  // The caller keeps this UUID across retries of the same manual abono.
  paymentId: z.uuid().optional(),
  expenseId: z.uuid(),
  amountCents: z.number().int().min(1).max(MAX_CENTS),
  paidAt: day,
  paymentMethod: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "DOMICILIADO", "CHEQUE"]).nullable().optional(),
  source: z.enum(["MANUAL", "TREASURY"]),
  paymentRunItemId: z.uuid().nullable().optional(),
  reference: z.string().trim().min(1).max(200).nullable().optional(),
}).strict();
export type ExpensePaymentInput = z.input<typeof paymentInputSchema>;

function databaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
}

function mapError(error: unknown, fallback: string): never {
  if (isApiError(error)) throw error;
  if (error instanceof ZodError) throw ApiError.badRequest("Revisa los datos del pago.");
  if (error instanceof RangeError) throw ApiError.badRequest(error.message);
  const code = databaseCode(error);
  if (code === "23505") throw ApiError.conflict("Ese hecho ya tiene una póliza o esa partida ya tiene un abono.");
  if (code === "23503") throw ApiError.notFound("El gasto o la partida no existe en esta empresa.");
  if (code === "23514") throw ApiError.conflict("El gasto o pago no cumple las reglas contables u operativas.");
  if (["40001", "40P01", "0A000"].includes(code ?? "")) throw ApiError.conflict("Repite la operación en una transacción READ COMMITTED.");
  throw ApiError.internal(fallback);
}

async function run<T>(ctx: ExpenseAccountingContext, action: "read" | "publish",
  operation: (tx: Tx, companyId: string, actorId: string, scope: BranchScope) => Promise<T>) {
  try {
    const principal = z.object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) }).parse(ctx);
    return await withCompanyContext(principal, async tx => {
      const [actor] = await tx.select({ id: users.id, role: users.role, branchId: users.branchId }).from(users).where(and(
        eq(users.id, principal.actorId), eq(users.companyId, principal.companyId),
        eq(users.active, true), isNull(users.deletedAt),
      )).limit(1);
      if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa.");
      const scope = resolveBranchScope(actor.role, actor.branchId);
      if (!hasPermission(actor.role, "accounting", action) || scope.kind === "NONE"
        || (action === "publish" && scope.kind !== "ALL")) {
        throw ApiError.forbidden("No tienes permiso para operar estos hechos contables.");
      }
      return operation(tx, principal.companyId, principal.actorId, scope);
    });
  } catch (error) {
    return mapError(error, "No se pudo procesar el hecho contable del gasto.");
  }
}

function text(value: string, max: number) {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Fecha de devengo explícita del gasto: nunca se infiere de `createdAt`. */
export function expenseAccountingDate(expense: Pick<ExpenseRow, "businessDate">) {
  return expense.businessDate ?? null;
}

async function lockExpense(tx: Tx, companyId: string, expenseId: string) {
  const [expense] = await tx.select().from(operatingExpenses).where(and(
    eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, expenseId),
  )).limit(1).for("update");
  return expense ?? null;
}

async function isPeriodClosed(tx: Tx, companyId: string, date: string) {
  const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(
    eq(financialPeriods.companyId, companyId),
    eq(financialPeriods.year, Number(date.slice(0, 4))),
    eq(financialPeriods.month, Number(date.slice(5, 7))),
    eq(financialPeriods.status, "CLOSED"),
  )).limit(1);
  return Boolean(closed);
}

/** Motivo por el que el gasto todavía no puede reconocerse, o `null`. */
function expenseBlocker(expense: ExpenseRow, date: string | null): string | null {
  if (!["APPROVED", "PAID"].includes(expense.status)) {
    return "El gasto no está aprobado: aprobarlo es lo que crea la obligación contable.";
  }
  if (!expense.approvedBy) return "El gasto no tiene aprobación registrada con un actor.";
  if (!date) return "El gasto no tiene fecha de negocio explícita; no se infiere la fecha contable.";
  if (expense.amount <= 0) return "El gasto no tiene un importe positivo.";
  if (expense.taxAmount === null) return "Falta documentar el impuesto del gasto; cero debe declararse explícitamente.";
  if (!Number.isSafeInteger(expense.taxAmount) || expense.taxAmount < 0 || expense.taxAmount >= expense.amount) {
    return "El impuesto documentado debe ser no negativo y menor al importe bruto del gasto.";
  }
  if (expense.invoiceId) return "El gasto está vinculado a una factura; requiere resolver la fuente canónica antes de contabilizar.";
  return null;
}

function entryOf(entries: RuleEntry[], role: string) {
  return entries.find(entry => entry.role === role) ?? null;
}

/** Roles faltantes de la regla resuelta, con un mensaje accionable. */
function missingRoles(entries: RuleEntry[], roles: readonly string[]) {
  const missing = roles.filter(role => !entryOf(entries, role));
  const labels: Record<string, string> = { EXPENSE: "gastos sin partida", PAYABLE: "obligaciones por pagar",
    PAYMENT_SOURCE: "salida de pagos manuales", RECOVERABLE_TAX: "impuesto documentado del gasto" };
  return missing.length === 0 ? null
    : `Faltan cuentas para ${missing.map(role => labels[role] ?? "un componente de la operación").join(", ")}. Revisa Cuentas para cada operación en Preparar contabilidad.`;
}

async function existingJournal(tx: Tx, companyId: string, sourceType: string, sourceId: string, eventType: string) {
  const [journal] = await tx.select().from(accountingJournals).where(and(
    eq(accountingJournals.companyId, companyId),
    eq(accountingJournals.sourceType, sourceType),
    eq(accountingJournals.sourceId, sourceId),
    eq(accountingJournals.eventType, eventType),
    eq(accountingJournals.sourceVersion, 1),
  )).limit(1);
  return journal ?? null;
}

async function postFresh(tx: Tx, companyId: string, actorId: string, journal: JournalDraft) {
  const [draft] = await tx.insert(accountingJournals).values({
    companyId, accountingDate: journal.accountingDate, businessDate: journal.businessDate,
    description: journal.description, currency: "MXN", branchId: journal.branchId,
    sourceType: journal.sourceType, sourceId: journal.sourceId, sourceVersion: 1,
    eventType: journal.eventType, ruleId: journal.ruleId, ruleVersion: journal.ruleVersion,
    createdBy: actorId, updatedBy: actorId,
  }).returning();
  if (!draft) throw ApiError.internal("No se pudo crear la póliza del hecho.");
  await insertJournalLines(tx, companyId, draft.id, journal.lines);
  return postInTransaction(tx, companyId, actorId, draft.id, draft.version, journal.reason);
}

interface JournalDraft {
  accountingDate: string; businessDate: string | null; description: string;
  branchId: string | null; sourceType: string; sourceId: string; eventType: string;
  ruleId: string; ruleVersion: number;
  lines: { accountId: string; costCenterId: string | null; debitCents: number;
    creditCents: number; memo: string | null }[];
  reason: string;
}

/**
 * Reconoce la obligación del gasto una sola vez. Devuelve la póliza existente o
 * creada, o el motivo por el que el hecho queda pendiente.
 */
export async function ensureRecognitionIn(tx: Tx, companyId: string, actorId: string, expense: ExpenseRow) {
  const fact = { companyId, actorId, branchId: expense.branchId, sourceId: expense.id,
    sourceType: "OPERATING_EXPENSE", eventType: EXPENSE_RECOGNIZED, accountingDate: expenseAccountingDate(expense) };
  await recordAccountingEventIn(tx, fact);
  const result = await recognizeIn(tx, companyId, actorId, expense);
  await finishAccountingEventIn(tx, fact, result);
  return result;
}

async function recognizeIn(tx: Tx, companyId: string, actorId: string, expense: ExpenseRow) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:expense:${expense.id}`}, 510))`);
  const existing = await existingJournal(tx, companyId, "OPERATING_EXPENSE", expense.id, EXPENSE_RECOGNIZED);
  if (existing) return { journal: existing, reason: null as string | null };

  const plan = await expenseRecognitionPlanIn(tx, companyId, expense);
  if (plan.reason || !plan.date || !plan.preview.rule || !plan.debit || !plan.credit) {
    return { journal: null, reason: plan.reason ?? "La configuración del gasto está incompleta." };
  }
  const { date, preview, debit, credit } = plan;
  const memo = text(`Gasto ${expense.category}: ${expense.description}`, 200);
  const journal = await postFresh(tx, companyId, actorId, {
    accountingDate: date, businessDate: date, description: text(`Gasto reconocido: ${expense.description}`, 500),
    branchId: expense.branchId, sourceType: "OPERATING_EXPENSE", sourceId: expense.id,
    eventType: EXPENSE_RECOGNIZED, ruleId: preview.rule!.id, ruleVersion: preview.rule!.version,
    reason: "Reconocimiento automático del gasto aprobado.",
    lines: recognitionLines(expense, preview.entries, debit, credit, memo),
  });
  return { journal, reason: null as string | null };
}

/** Shared by read-only preparation and posting, under the configuration lock. */
async function expenseRecognitionPlanIn(tx: Tx, companyId: string, expense: ExpenseRow) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 505))`);
  const date = expenseAccountingDate(expense);
  const preview = await resolveRuleIn(tx, companyId, EXPENSE_RECOGNIZED, date ?? "0001-01-01");
  let debit = entryOf(preview.entries, EXPENSE_ROLES.debit);
  const credit = entryOf(preview.entries, EXPENSE_ROLES.credit);
  const blocked = expenseBlocker(expense, date);
  if (blocked || !date) return { date, preview, debit, credit, reason: blocked ?? "Falta la fecha de negocio del gasto." };
  if (expense.costCenterId) {
    const [link] = await tx.select({ id: accountingSourceLinks.id, accountId: accountingAccounts.id, accountCode: accountingAccounts.code,
      accountName: accountingAccounts.name, accountActive: accountingAccounts.active,
      accountPostable: accountingAccounts.postable, accountValidFrom: accountingAccounts.validFrom,
      accountValidTo: accountingAccounts.validTo, kind: accountingAccounts.kind,
      centerActive: costCenters.active,
    }).from(accountingSourceLinks).innerJoin(accountingAccounts, and(
      eq(accountingAccounts.companyId, companyId), eq(accountingAccounts.id, accountingSourceLinks.accountId),
    )).innerJoin(costCenters, and(eq(costCenters.companyId, companyId), eq(costCenters.id, accountingSourceLinks.costCenterId)))
      .where(and(eq(accountingSourceLinks.companyId, companyId), eq(accountingSourceLinks.costCenterId, expense.costCenterId))).limit(1);
    if (!link) return { date, preview, debit, credit, reason: "La partida del gasto no tiene una cuenta contable vinculada. Revisa Partidas en Preparar contabilidad." };
    if (!link.centerActive || !link.accountActive || !link.accountPostable || !["EXPENSE", "ASSET"].includes(link.kind)
      || link.accountValidFrom > date || (link.accountValidTo !== null && link.accountValidTo < date)) {
      return { date, preview, debit, credit, reason: "La cuenta vinculada a la partida debe ser de gasto o activo, de movimiento, activa y vigente en la fecha del gasto; la partida debe estar activa." };
    }
    debit = { ...link, role: EXPENSE_ROLES.debit, required: true, costCenterId: expense.costCenterId };
  }
  const ruleReason = preview.rule ? ruleBlockerMessage(preview) : `No hay configuración contable vigente para reconocer gastos el ${date}.`;
  const rolesReason = missingRoles(preview.entries, [...(expense.costCenterId ? [] : [EXPENSE_ROLES.debit]), EXPENSE_ROLES.credit,
    ...(expense.taxAmount! > 0 ? ["RECOVERABLE_TAX"] : [])]);
  const reason = ruleReason ?? rolesReason ?? (await isPeriodClosed(tx, companyId, date)
    ? `El periodo de ${date.slice(0, 7)} está cerrado; el gasto no se puede reconocer en esa fecha.` : null);
  if (reason) return { date, preview, debit, credit, reason };
  const used = [debit, credit, ...(expense.taxAmount! > 0 ? [entryOf(preview.entries, "RECOVERABLE_TAX")] : [])];
  const invalid = used.some(entry => !entry || !entry.accountActive || !entry.accountPostable
    || entry.accountValidFrom > date || (entry.accountValidTo !== null && entry.accountValidTo < date));
  if (invalid) return { date, preview, debit, credit,
    reason: "Una cuenta utilizada por el gasto no está activa, no es de movimiento o no está vigente en su fecha. Revisa las cuentas de esta operación." };
  const [opening] = await tx.select({ date: accountingOpenings.openingDate }).from(accountingOpenings)
    .where(eq(accountingOpenings.companyId, companyId)).limit(1);
  return { date, preview, debit, credit, reason: opening && date <= opening.date
    ? `La fecha del gasto debe ser posterior a la apertura del ${opening.date}.` : null };
}

function recognitionLines(expense: ExpenseRow, entries: RuleEntry[], debit: RuleEntry, credit: RuleEntry, memo: string) {
  return [
      { accountId: debit.accountId, costCenterId: expense.costCenterId ?? debit.costCenterId ?? null,
        debitCents: expense.amount - expense.taxAmount!, creditCents: 0, memo },
      ...(expense.taxAmount! > 0 ? [{ accountId: entryOf(entries, "RECOVERABLE_TAX")!.accountId,
        costCenterId: entryOf(entries, "RECOVERABLE_TAX")!.costCenterId ?? null,
        debitCents: expense.taxAmount!, creditCents: 0, memo }] : []),
      { accountId: credit.accountId, costCenterId: credit.costCenterId ?? null,
        debitCents: 0, creditCents: expense.amount, memo },
    ];
}

/** Resolves the actual expense without creating events, drafts or journal lines. */
export function previewExpenseRecognition(ctx: ExpenseAccountingContext, expenseId: string) {
  return run(ctx, "read", async (tx, companyId, _actorId, scope) => {
    if (scope.kind !== "ALL") throw ApiError.forbidden("La preparación requiere alcance de empresa.");
    const [expense] = await tx.select().from(operatingExpenses).where(and(
      eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, uuid.parse(expenseId)),
    )).limit(1);
    if (!expense) throw ApiError.notFound("El gasto no existe en esta empresa.");
    const existing = await existingJournal(tx, companyId, "OPERATING_EXPENSE", expense.id, EXPENSE_RECOGNIZED);
    if (existing?.status === "POSTED") {
      const lines = await tx.select({ accountId: accountingAccounts.id, accountCode: accountingAccounts.code,
        accountName: accountingAccounts.name, debitCents: accountingJournalLines.debitCents, creditCents: accountingJournalLines.creditCents,
      }).from(accountingJournalLines).innerJoin(accountingAccounts, and(eq(accountingAccounts.companyId, companyId),
        eq(accountingAccounts.id, accountingJournalLines.accountId)))
        .where(and(eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.journalId, existing.id)));
      return { description: expense.description, date: existing.accountingDate, published: true, reason: null, lines };
    }
    const plan = await expenseRecognitionPlanIn(tx, companyId, expense);
    const lines = !plan.reason && plan.debit && plan.credit
      ? recognitionLines(expense, plan.preview.entries, plan.debit, plan.credit, "Vista previa").map(line => {
        const account = [plan.debit!, ...plan.preview.entries].find(entry => entry.accountId === line.accountId)!;
        return { ...line, accountCode: account.accountCode, accountName: account.accountName };
      }) : [];
    return { description: expense.description, date: plan.date, published: false, reason: plan.reason, lines };
  });
}

/**
 * Reintenta la póliza del pago confirmado. Una aplicación confirmada sin póliza
 * conserva `pendingReason` y espera a FC-10 cuando falta configuración.
 */
export async function postPaymentIn(tx: Tx, companyId: string, actorId: string, payment: PaymentRow) {
  if (payment.status !== "CONFIRMED") return { journal: null, reason: "Solo un pago confirmado se contabiliza." };
  const fact = { companyId, actorId, branchId: payment.branchId, sourceId: payment.id,
    sourceType: "EXPENSE_PAYMENT", eventType: EXPENSE_PAYMENT, accountingDate: payment.paidAt };
  await recordAccountingEventIn(tx, fact);
  const result = await postConfirmedPaymentIn(tx, companyId, actorId, payment);
  await finishAccountingEventIn(tx, fact, result);
  return result;
}

async function postConfirmedPaymentIn(tx: Tx, companyId: string, actorId: string, payment: PaymentRow) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:expense-payment:${payment.id}`}, 510))`);
  const existing = await existingJournal(tx, companyId, "EXPENSE_PAYMENT", payment.id, EXPENSE_PAYMENT);
  if (existing) return { journal: existing, reason: null as string | null };
  if (payment.accountingJournalId) {
    const [linked] = await tx.select().from(accountingJournals).where(and(
      eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, payment.accountingJournalId),
    )).limit(1);
    if (linked) return { journal: linked, reason: null as string | null };
  }

  const [expense] = await tx.select().from(operatingExpenses).where(and(
    eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, payment.expenseId),
  )).limit(1);
  if (!expense) return { journal: null, reason: "El gasto del pago ya no existe en esta empresa." };
  const recognized = await ensureRecognitionIn(tx, companyId, actorId, expense);
  if (!recognized.journal) {
    return { journal: null, reason: `Falta la obligación del gasto: ${recognized.reason}` };
  }

  const date = payment.paidAt;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 505))`);
  const preview = await resolveRuleIn(tx, companyId, EXPENSE_PAYMENT, date);
  const ruleReason = ruleBlockerMessage(preview);
  const rolesReason = missingRoles(preview.entries, [PAYMENT_ROLES.debit,
    ...(payment.source === "TREASURY" ? [] : [PAYMENT_ROLES.credit])]);
  const reason = ruleReason ?? rolesReason ?? (await isPeriodClosed(tx, companyId, date)
    ? `El periodo de ${date.slice(0, 7)} está cerrado; el pago no se puede contabilizar en esa fecha.` : null);
  if (reason) return { journal: null, reason };

  const debit = entryOf(preview.entries, PAYMENT_ROLES.debit)!;
  let creditAccountId = entryOf(preview.entries, PAYMENT_ROLES.credit)?.accountId;
  let creditCostCenterId = entryOf(preview.entries, PAYMENT_ROLES.credit)?.costCenterId ?? null;
  if (payment.source === "TREASURY") {
    // Source-link/account guards use this same company lock. Keep the link
    // stable from resolution through posting, including recovery of old facts.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 505))`);
    // Identity comes from the signed run. Never match sensitive account numbers
    // or silently use the generic PAYMENT_SOURCE account for an unknown bank.
    const [source] = await tx.select({ bankAccountId: paymentRuns.sourceBankAccountId,
      active: companyBankAccounts.active, currency: companyBankAccounts.currency,
      accountId: accountingSourceLinks.accountId,
    }).from(paymentRunItems).innerJoin(paymentRuns, and(
      eq(paymentRuns.id, paymentRunItems.paymentRunId), eq(paymentRuns.companyId, companyId),
    )).leftJoin(companyBankAccounts, and(
      eq(companyBankAccounts.companyId, companyId), eq(companyBankAccounts.id, paymentRuns.sourceBankAccountId),
    )).leftJoin(accountingSourceLinks, and(
      eq(accountingSourceLinks.companyId, companyId), eq(accountingSourceLinks.bankAccountId, companyBankAccounts.id),
    )).where(eq(paymentRunItems.id, payment.paymentRunItemId!)).limit(1);
    if (!source?.bankAccountId) return { journal: null,
      reason: "La corrida no identifica una cuenta bancaria de origen del catálogo; no se infiere por su número." };
    if (!source.active || source.currency !== "MXN") return { journal: null,
      reason: "La cuenta bancaria de origen no está activa en MXN. Revisa el catálogo antes de contabilizar." };
    if (!source.accountId) return { journal: null,
      reason: "La cuenta bancaria de origen no tiene vínculo contable. Configúralo antes de contabilizar." };
    const [account] = await tx.select().from(accountingAccounts).where(and(
      eq(accountingAccounts.companyId, companyId), eq(accountingAccounts.id, source.accountId),
    )).limit(1);
    if (!account || account.kind !== "ASSET" || !account.active || !account.postable || account.validFrom > date
      || (account.validTo !== null && account.validTo < date)) return { journal: null,
      reason: "La cuenta contable del banco debe ser un activo de movimiento, activo y vigente en la fecha del pago." };
    creditAccountId = source.accountId;
    creditCostCenterId = null;
  }
  // Settle the liability actually posted, rather than re-resolving the
  // recognition rule at payment time (its account may have changed).
  const obligations = await tx.select({
    accountId: accountingJournalLines.accountId, costCenterId: accountingJournalLines.costCenterId,
    creditCents: accountingJournalLines.creditCents,
  }).from(accountingJournalLines).where(and(
    eq(accountingJournalLines.companyId, companyId),
    eq(accountingJournalLines.journalId, recognized.journal.id),
    sql`${accountingJournalLines.creditCents} > 0`,
  )).limit(2);
  const obligation = obligations[0];
  if (recognized.journal.status !== "POSTED" || obligations.length !== 1
    || obligation.creditCents !== expense.amount || obligation.accountId !== debit.accountId
    || obligation.costCenterId !== (debit.costCenterId ?? null)) {
    return { journal: null, reason: "La regla de pago no coincide con la obligación original del gasto (cuenta o centro de costo). Revisa la regla antes de contabilizar el pago." };
  }
  const memo = text(`Pago de gasto: ${expense.description}`, 200);
  const journal = await postFresh(tx, companyId, actorId, {
    accountingDate: date, businessDate: date, description: text(`Pago de gasto: ${expense.description}`, 500),
    branchId: payment.branchId, sourceType: "EXPENSE_PAYMENT", sourceId: payment.id,
    eventType: EXPENSE_PAYMENT, ruleId: preview.rule!.id, ruleVersion: preview.rule!.version,
    reason: "Contabilización automática del pago confirmado.",
    lines: [
      { accountId: obligation.accountId, costCenterId: obligation.costCenterId,
        debitCents: payment.amountCents, creditCents: 0, memo },
      { accountId: creditAccountId!, costCenterId: creditCostCenterId,
        debitCents: 0, creditCents: payment.amountCents, memo },
    ],
  });
  await tx.update(expensePayments).set({ accountingJournalId: journal.id, pendingReason: null, updatedAt: new Date() })
    .where(and(eq(expensePayments.companyId, companyId), eq(expensePayments.id, payment.id)));
  return { journal, reason: null as string | null };
}

/** Suma confirmada de abonos de un gasto. */
export async function confirmedPaidCents(tx: Pick<Tx, "select">, companyId: string, expenseId: string) {
  const [row] = await tx.select({ total: sql<number>`coalesce(sum(${expensePayments.amountCents}), 0)::int` })
    .from(expensePayments).where(and(
      eq(expensePayments.companyId, companyId), eq(expensePayments.expenseId, expenseId),
      eq(expensePayments.status, "CONFIRMED"),
    ));
  return row?.total ?? 0;
}

/** Saldo pendiente del gasto; nunca negativo. */
export async function remainingExpenseCents(tx: Pick<Tx, "select">, companyId: string, expenseId: string) {
  const [expense] = await tx.select({ amount: operatingExpenses.amount }).from(operatingExpenses).where(and(
    eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, expenseId),
  )).limit(1);
  if (!expense) return null;
  const paid = await confirmedPaidCents(tx, companyId, expenseId);
  return Math.max(expense.amount - paid, 0);
}

function assertNotLegacyPaid(expense: ExpenseRow, confirmedCents: number) {
  if (expense.status === "PAID" && confirmedCents !== expense.amount) {
    throw ApiError.conflict("El gasto figura pagado sin aplicaciones que expliquen su importe. Revisa el pago histórico antes de registrar otro abono.");
  }
}

/**
 * Salda el gasto en la operación cuando la suma confirmada alcanza su importe.
 * Nunca lo revierte ni lo marca pagado antes de tiempo.
 */
export async function settleExpenseIn(tx: Tx, companyId: string, actorId: string, expenseId: string) {
  const [expense] = await tx.select().from(operatingExpenses).where(and(
    eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, expenseId),
  )).limit(1).for("update");
  if (!expense) return null;
  const paid = await confirmedPaidCents(tx, companyId, expenseId);
  if (paid !== expense.amount || expense.status === "PAID") return expense;
  const [latest] = await tx.select({ paidAt: expensePayments.paidAt, method: expensePayments.paymentMethod })
    .from(expensePayments).where(and(
      eq(expensePayments.companyId, companyId), eq(expensePayments.expenseId, expenseId),
      eq(expensePayments.status, "CONFIRMED"),
    )).orderBy(sql`${expensePayments.confirmedAt} DESC`).limit(1);
  const closedAt = latest?.paidAt ?? expense.dueDate;
  const [updated] = await tx.update(operatingExpenses).set({
    status: "PAID", paidAt: closedAt ? new Date(`${closedAt}T12:00:00.000Z`) : new Date(),
    paidBy: actorId, ...(latest?.method ? { paymentMethod: latest.method } : {}), updatedAt: new Date(),
  }).where(and(eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, expenseId),
    eq(operatingExpenses.status, expense.status))).returning();
  return updated ?? expense;
}

/**
 * Registra un abono dentro de la transacción del llamador.
 *
 * `MANUAL` nace confirmado (alguien declaró que pagó, con fecha y actor) y se
 * contabiliza de inmediato si hay configuración. `TREASURY` nace pendiente:
 * solo la liquidación con evidencia lo confirma y solo entonces descuenta saldo.
 */
export async function insertPaymentIn(tx: Tx, companyId: string, actorId: string, input: ExpensePaymentInput) {
  const data = paymentInputSchema.parse(input);
  const expense = await lockExpense(tx, companyId, data.expenseId);
  if (!expense) throw ApiError.notFound("El gasto no existe en esta empresa.");
  if (data.paymentId) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:payment-request:${data.paymentId}`}, 510))`);
    const [existing] = await tx.select().from(expensePayments).where(and(
      eq(expensePayments.companyId, companyId), eq(expensePayments.id, data.paymentId),
    )).limit(1);
    if (existing) {
      if (existing.expenseId !== data.expenseId || existing.amountCents !== data.amountCents
        || existing.paidAt !== data.paidAt || existing.source !== data.source
        || existing.paymentMethod !== (data.paymentMethod ?? null)
        || existing.reference !== (data.reference ?? null)
        || existing.paymentRunItemId !== (data.paymentRunItemId ?? null)) {
        throw ApiError.conflict("La identidad del abono ya se usó con otros datos. Usa una nueva para otro pago.");
      }
      const journal = await existingJournal(tx, companyId, "EXPENSE_PAYMENT", existing.id, EXPENSE_PAYMENT);
      return { payment: existing, journal, pendingReason: existing.pendingReason };
    }
  }
  if (!["APPROVED", "PAID"].includes(expense.status)) {
    throw ApiError.conflict("Solo un gasto aprobado puede recibir pagos.");
  }
  const paid = await confirmedPaidCents(tx, companyId, expense.id);
  assertNotLegacyPaid(expense, paid);
  const remaining = expense.amount - paid;
  if (data.amountCents > remaining) {
    throw ApiError.conflict(`El abono excede el saldo pendiente (${remaining} centavos).`);
  }
  const confirmed = data.source === "MANUAL";
  const [payment] = await tx.insert(expensePayments).values({
    ...(data.paymentId ? { id: data.paymentId } : {}),
    companyId, branchId: expense.branchId, expenseId: expense.id, amountCents: data.amountCents,
    paidAt: data.paidAt, paymentMethod: data.paymentMethod ?? null, source: data.source,
    paymentRunItemId: data.paymentRunItemId ?? null, reference: data.reference ?? null,
    status: confirmed ? "CONFIRMED" : "PENDING",
    createdBy: actorId,
    ...(confirmed ? { confirmedBy: actorId, confirmedAt: new Date() } : {}),
  }).returning();
  if (!payment) throw ApiError.internal("No se pudo registrar el abono.");
  if (!confirmed) return { payment, journal: null, pendingReason: null as string | null, reason: null as string | null };

  const posted = await postPaymentIn(tx, companyId, actorId, payment);
  if (!posted.journal && posted.reason) {
    await tx.update(expensePayments).set({ pendingReason: posted.reason, updatedAt: new Date() })
      .where(and(eq(expensePayments.companyId, companyId), eq(expensePayments.id, payment.id)));
  }
  await settleExpenseIn(tx, companyId, actorId, expense.id);
  return { payment, journal: posted.journal, pendingReason: posted.journal ? null : posted.reason };
}

/** Confirma una aplicación PENDING (partida de tesorería liquidada). */
export async function confirmPaymentIn(tx: Tx, companyId: string, actorId: string,
  input: { paymentId: string; paidAt: string; reference?: string | null }) {
  const { paymentId, paidAt, reference } = z.object({
    paymentId: z.uuid(), paidAt: day, reference: z.string().trim().min(1).max(200).nullable().optional(),
  }).strict().parse(input);
  const [payment] = await tx.select().from(expensePayments).where(and(
    eq(expensePayments.companyId, companyId), eq(expensePayments.id, paymentId),
  )).limit(1).for("update");
  if (!payment) throw ApiError.notFound("La aplicación de pago no existe en esta empresa.");
  if (payment.status === "CONFIRMED") return { payment, journal: null, pendingReason: null as string | null, already: true };
  if (payment.status !== "PENDING") throw ApiError.conflict("Un pago rechazado no se puede confirmar.");

  // Serialize all confirmations against this expense, including applications
  // scheduled in different runs before either one was settled.
  const expense = await lockExpense(tx, companyId, payment.expenseId);
  if (!expense) throw ApiError.notFound("El gasto no existe en esta empresa.");
  const paid = await confirmedPaidCents(tx, companyId, expense.id);
  assertNotLegacyPaid(expense, paid);
  if (payment.amountCents > expense.amount - paid) {
    throw ApiError.conflict("El abono excede el saldo pendiente del gasto.");
  }

  const [updated] = await tx.update(expensePayments).set({
    status: "CONFIRMED", paidAt, confirmedBy: actorId, confirmedAt: new Date(),
    reference: reference ?? payment.reference, updatedAt: new Date(),
  }).where(and(eq(expensePayments.companyId, companyId), eq(expensePayments.id, paymentId),
    eq(expensePayments.status, "PENDING"))).returning();
  if (!updated) throw ApiError.conflict("La aplicación cambió desde tu última lectura.");
  const posted = await postPaymentIn(tx, companyId, actorId, updated);
  const pendingReason = posted.journal ? null : posted.reason;
  if (pendingReason) {
    await tx.update(expensePayments).set({ pendingReason, updatedAt: new Date() })
      .where(and(eq(expensePayments.companyId, companyId), eq(expensePayments.id, paymentId)));
  }
  await settleExpenseIn(tx, companyId, actorId, updated.expenseId);
  return { payment: updated, journal: posted.journal, pendingReason, already: false };
}

/** Registra el rechazo de una partida: no genera salida ni póliza. */
export async function failPaymentIn(tx: Tx, companyId: string, actorId: string,
  input: { paymentId: string; reason: string }) {
  const { paymentId, reason } = z.object({
    paymentId: z.uuid(), reason: z.string().trim().min(5).max(500),
  }).strict().parse(input);
  const [payment] = await tx.select().from(expensePayments).where(and(
    eq(expensePayments.companyId, companyId), eq(expensePayments.id, paymentId),
  )).limit(1).for("update");
  if (!payment) throw ApiError.notFound("La aplicación de pago no existe en esta empresa.");
  if (payment.status === "FAILED") return payment;
  if (payment.status !== "PENDING") throw ApiError.conflict("Un pago confirmado no se puede rechazar.");
  const [failed] = await tx.update(expensePayments).set({
    status: "FAILED", failureReason: reason, updatedAt: new Date(),
  }).where(and(eq(expensePayments.companyId, companyId), eq(expensePayments.id, paymentId),
    eq(expensePayments.status, "PENDING"))).returning();
  if (!failed) throw ApiError.conflict("La aplicación cambió desde tu última lectura.");
  return failed;
}

/** Reconocimiento explícito e idempotente de un gasto. */
export function recognizeExpense(ctx: ExpenseAccountingContext, expenseId: string) {
  return run(ctx, "publish", async (tx, companyId, actorId) => {
    const id = uuid.parse(expenseId);
    const expense = await lockExpense(tx, companyId, id);
    if (!expense) throw ApiError.notFound("El gasto no existe en esta empresa.");
    const result = await ensureRecognitionIn(tx, companyId, actorId, expense);
    if (!result.journal) throw ApiError.conflict(result.reason ?? "El gasto no se puede reconocer todavía.");
    return result.journal;
  }).catch(error => mapError(error, "No se pudo reconocer el gasto."));
}

/** Registro manual de un abono completo o parcial. */
export function recordExpensePayment(ctx: ExpenseAccountingContext, input: ExpensePaymentInput) {
  return run(ctx, "publish", (tx, companyId, actorId) => {
    if (input.source === "MANUAL" && !input.paymentId) {
      throw ApiError.badRequest("Conserva un paymentId UUID para reintentar el mismo abono manual.");
    }
    return insertPaymentIn(tx, companyId, actorId, input);
  })
    .catch(error => mapError(error, "No se pudo registrar el pago del gasto."));
}

/** Abonos de un gasto, del más reciente al más antiguo (máximo 100). */
export function listExpensePayments(ctx: ExpenseAccountingContext, expenseId: string) {
  return run(ctx, "read", async (tx, companyId, _actorId, scope) => {
    const id = uuid.parse(expenseId);
    const [expense] = await tx.select({ id: operatingExpenses.id }).from(operatingExpenses).where(and(
      eq(operatingExpenses.companyId, companyId), eq(operatingExpenses.id, id),
      scope.kind === "BRANCH" ? eq(operatingExpenses.branchId, scope.branchId) : undefined,
    )).limit(1);
    if (!expense) throw ApiError.notFound("El gasto no existe en tu ámbito.");
    const items = await tx.select({
      id: expensePayments.id, amountCents: expensePayments.amountCents, paidAt: expensePayments.paidAt,
      status: expensePayments.status, source: expensePayments.source,
      paymentMethod: expensePayments.paymentMethod, reference: expensePayments.reference,
      failureReason: expensePayments.failureReason, pendingReason: expensePayments.pendingReason,
      accountingJournalId: expensePayments.accountingJournalId,
      paymentRunItemId: expensePayments.paymentRunItemId, confirmedAt: expensePayments.confirmedAt,
    }).from(expensePayments).where(and(
      eq(expensePayments.companyId, companyId), eq(expensePayments.expenseId, id),
    )).orderBy(sql`${expensePayments.createdAt} DESC`).limit(100);
    return { items, remainingCents: await remainingExpenseCents(tx, companyId, id) };
  });
}
