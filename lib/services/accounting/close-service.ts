import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import {
  accountingEvents,
  accountingInventoryValuations,
  accountingJournals,
  accountingOpenings,
  accountingPeriodCloses,
  financialPeriods,
  pnlSnapshots,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";
import { getRoleScope } from "@/lib/rbac/resource-scope";
import { logDataAccess } from "@/lib/security/audit";
import { freezePnLPeriodIn } from "@/lib/services/pnl-snapshot-service";

export interface CloseContext {
  companyId: string;
  actorId: string;
  role: Role;
}

export interface CloseBlockerItem {
  id: string;
  reference: string;
  date: string | null;
  reason: string;
}

export interface CloseBlocker {
  code:
    | "DRAFT_JOURNALS"
    | "PENDING_EVENTS"
    | "PENDING_INVENTORY_VALUATIONS"
    | "UNBALANCED_JOURNALS"
    | "OPENING_OVERLAP";
  count: number;
  message: string;
  items: CloseBlockerItem[];
}

export interface TrialBalanceSnapshotRow {
  accountId: string;
  code: string;
  name: string;
  kind: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
  openingDebitCents: number;
  openingCreditCents: number;
  periodDebitCents: number;
  periodCreditCents: number;
  closingDebitCents: number;
  closingCreditCents: number;
}

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];

const periodInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

const reopenInputSchema = periodInputSchema.extend({
  reason: z.string().trim().min(5, "El motivo de reapertura debe tener al menos 5 caracteres.").max(500),
});

export function monthBounds(year: number, month: number) {
  const monthStr = String(month).padStart(2, "0");
  const periodStart = `${year}-${monthStr}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { periodStart, periodEnd, monthStr };
}

function databaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
}

function mapCloseError(error: unknown, fallback: string): never {
  if (isApiError(error)) throw error;
  if (error instanceof ZodError) {
    throw ApiError.badRequest(error.issues[0]?.message ?? "Revisa los datos del cierre financiero.");
  }
  const code = databaseCode(error);
  if (code === "23505") throw ApiError.conflict("Ya existe una versión de cierre activa para este periodo.");
  if (code === "23514") {
    const message = error instanceof Error ? error.message : fallback;
    throw ApiError.conflict(message);
  }
  if (["40001", "40P01", "0A000"].includes(code ?? "")) {
    throw ApiError.conflict("Repite la operación en una transacción READ COMMITTED.");
  }
  throw ApiError.internal(fallback);
}

async function authorizeCloseActor(
  tx: Tx,
  ctx: CloseContext,
  action: "read" | "publish" | "reverse",
) {
  if (getRoleScope(ctx.role) !== "COMPANY" || !hasPermission(ctx.role, "accounting", action)) {
    throw ApiError.forbidden(
      action === "reverse"
        ? "No tienes permiso para reabrir periodos contables cerrados."
        : "No tienes permiso para operar el cierre contable.",
    );
  }
  const [actor] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, ctx.actorId),
        eq(users.companyId, ctx.companyId),
        eq(users.role, ctx.role),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!actor) {
    throw ApiError.forbidden("El actor no está activo en esta empresa con ese permiso.");
  }
  return actor;
}

/**
 * Evalúa pendientes bloqueantes que impiden el cierre definitivo del periodo.
 * No oculta diferencias ni publica borradores automáticamente.
 */
export async function getPeriodCloseBlockersIn(
  tx: Tx,
  companyId: string,
  year: number,
  month: number,
): Promise<CloseBlocker[]> {
  const { periodStart, periodEnd } = monthBounds(year, month);
  const blockers: CloseBlocker[] = [];

  const draftJournals = await tx
    .select({
      id: accountingJournals.id,
      accountingDate: accountingJournals.accountingDate,
      description: accountingJournals.description,
    })
    .from(accountingJournals)
    .where(
      and(
        eq(accountingJournals.companyId, companyId),
        eq(accountingJournals.status, "DRAFT"),
        gte(accountingJournals.accountingDate, periodStart),
        lte(accountingJournals.accountingDate, periodEnd),
      ),
    )
    .limit(20);

  if (draftJournals.length > 0) {
    blockers.push({
      code: "DRAFT_JOURNALS",
      count: draftJournals.length,
      message: `Hay ${draftJournals.length} póliza(s) en borrador dentro de ${year}-${String(month).padStart(2, "0")}; publícalas o descártalas antes de cerrar.`,
      items: draftJournals.map(j => ({
        id: j.id,
        reference: j.description,
        date: j.accountingDate,
        reason: "Póliza en estado DRAFT.",
      })),
    });
  }

  const endTimestamp = new Date(`${periodEnd}T23:59:59.999Z`);
  const pendingEvents = await tx
    .select({
      id: accountingEvents.id,
      sourceType: accountingEvents.sourceType,
      sourceId: accountingEvents.sourceId,
      accountingDate: accountingEvents.accountingDate,
      lastError: accountingEvents.lastError,
    })
    .from(accountingEvents)
    .where(
      and(
        eq(accountingEvents.companyId, companyId),
        eq(accountingEvents.status, "PENDING"),
        or(
          and(
            gte(accountingEvents.accountingDate, periodStart),
            lte(accountingEvents.accountingDate, periodEnd),
          ),
          and(isNull(accountingEvents.accountingDate), lte(accountingEvents.createdAt, endTimestamp)),
        ),
      ),
    )
    .limit(20);

  if (pendingEvents.length > 0) {
    blockers.push({
      code: "PENDING_EVENTS",
      count: pendingEvents.length,
      message: `Hay ${pendingEvents.length} evento(s) contable(s) pendiente(s) en ${year}-${String(month).padStart(2, "0")}.`,
      items: pendingEvents.map(e => ({
        id: e.id,
        reference: `${e.sourceType}:${e.sourceId}`,
        date: e.accountingDate,
        reason: e.lastError ?? "Pendiente de contabilización.",
      })),
    });
  }

  const pendingValuations = await tx
    .select({
      movementId: accountingInventoryValuations.movementId,
      kind: accountingInventoryValuations.kind,
      accountingDate: accountingInventoryValuations.accountingDate,
      pendingReason: accountingInventoryValuations.pendingReason,
    })
    .from(accountingInventoryValuations)
    .where(
      and(
        eq(accountingInventoryValuations.companyId, companyId),
        isNull(accountingInventoryValuations.amountCents),
        lte(accountingInventoryValuations.accountingDate, periodEnd),
      ),
    )
    .limit(20);

  if (pendingValuations.length > 0) {
    blockers.push({
      code: "PENDING_INVENTORY_VALUATIONS",
      count: pendingValuations.length,
      message: `Hay ${pendingValuations.length} movimiento(s) de inventario sin costo valorado hasta ${periodEnd}.`,
      items: pendingValuations.map(v => ({
        id: v.movementId,
        reference: `INVENTORY:${v.kind}`,
        date: v.accountingDate,
        reason: v.pendingReason ?? "Falta valoración de costo congelada.",
      })),
    });
  }

  const unbalanced = await tx.execute<{
    id: string;
    number: number | null;
    accounting_date: string;
    debit: string;
    credit: string;
  }>(sql`
    SELECT j.id, j.number, j.accounting_date::text AS accounting_date,
      coalesce(sum(l.debit_cents), 0)::text AS debit,
      coalesce(sum(l.credit_cents), 0)::text AS credit
    FROM accounting_journals j
    LEFT JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
    WHERE j.company_id = ${companyId}
      AND j.status = 'POSTED'
      AND j.accounting_date BETWEEN ${periodStart} AND ${periodEnd}
    GROUP BY j.id, j.number, j.accounting_date
    HAVING coalesce(sum(l.debit_cents), 0) <> coalesce(sum(l.credit_cents), 0)
    LIMIT 10
  `);

  if (unbalanced.rows.length > 0) {
    blockers.push({
      code: "UNBALANCED_JOURNALS",
      count: unbalanced.rows.length,
      message: `Se detectaron ${unbalanced.rows.length} póliza(s) descuadrada(s) en el periodo.`,
      items: unbalanced.rows.map(r => ({
        id: r.id,
        reference: `Póliza #${r.number ?? "?"}`,
        date: r.accounting_date,
        reason: `Cargos (${r.debit}) difieren de abonos (${r.credit}).`,
      })),
    });
  }

  const [opening] = await tx
    .select({ id: accountingOpenings.id, openingDate: accountingOpenings.openingDate, journalId: accountingOpenings.journalId })
    .from(accountingOpenings)
    .where(and(eq(accountingOpenings.companyId, companyId), lte(accountingOpenings.openingDate, periodEnd)))
    .limit(1);

  if (opening) {
    const overlap = await tx
      .select({ id: accountingJournals.id, accountingDate: accountingJournals.accountingDate, description: accountingJournals.description })
      .from(accountingJournals)
      .where(
        and(
          eq(accountingJournals.companyId, companyId),
          eq(accountingJournals.status, "POSTED"),
          lte(accountingJournals.accountingDate, opening.openingDate),
          sql`${accountingJournals.id} <> ${opening.journalId}`,
        ),
      )
      .limit(10);
    if (overlap.length > 0) {
      blockers.push({
        code: "OPENING_OVERLAP",
        count: overlap.length,
        message: `Hay ${overlap.length} póliza(s) publicada(s) en o antes de la fecha de apertura (${opening.openingDate}).`,
        items: overlap.map(j => ({
          id: j.id,
          reference: j.description,
          date: j.accountingDate,
          reason: "Solapa con la póliza de apertura.",
        })),
      });
    }
  }

  return blockers;
}

async function buildTrialBalanceSnapshotIn(
  tx: Tx,
  companyId: string,
  periodStart: string,
  periodEnd: string,
) {
  const summaryResult = await tx.execute<{
    journal_count: number;
    max_number: number;
    total_debit: string;
    total_credit: string;
  }>(sql`
    SELECT
      count(DISTINCT j.id)::int AS journal_count,
      coalesce(max(j.number), 0)::int AS max_number,
      coalesce(sum(l.debit_cents), 0)::text AS total_debit,
      coalesce(sum(l.credit_cents), 0)::text AS total_credit
    FROM accounting_journals j
    LEFT JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
    WHERE j.company_id = ${companyId}
      AND j.status = 'POSTED'
      AND j.accounting_date BETWEEN ${periodStart} AND ${periodEnd}
  `);
  const summary = summaryResult.rows[0] ?? {
    journal_count: 0,
    max_number: 0,
    total_debit: "0",
    total_credit: "0",
  };

  const rowsResult = await tx.execute<{
    account_id: string;
    code: string;
    name: string;
    kind: TrialBalanceSnapshotRow["kind"];
    normal_balance: TrialBalanceSnapshotRow["normalBalance"];
    opening_debit: string;
    opening_credit: string;
    period_debit: string;
    period_credit: string;
  }>(sql`
    SELECT
      a.id AS account_id,
      a.code,
      a.name,
      a.kind,
      a.normal_balance,
      coalesce(sum(CASE WHEN j.accounting_date < ${periodStart} THEN l.debit_cents ELSE 0 END), 0)::text AS opening_debit,
      coalesce(sum(CASE WHEN j.accounting_date < ${periodStart} THEN l.credit_cents ELSE 0 END), 0)::text AS opening_credit,
      coalesce(sum(CASE WHEN j.accounting_date >= ${periodStart} AND j.accounting_date <= ${periodEnd} THEN l.debit_cents ELSE 0 END), 0)::text AS period_debit,
      coalesce(sum(CASE WHEN j.accounting_date >= ${periodStart} AND j.accounting_date <= ${periodEnd} THEN l.credit_cents ELSE 0 END), 0)::text AS period_credit
    FROM accounting_accounts a
    LEFT JOIN accounting_journal_lines l ON l.company_id = a.company_id AND l.account_id = a.id
    LEFT JOIN accounting_journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      AND j.status = 'POSTED' AND j.accounting_date <= ${periodEnd}
    WHERE a.company_id = ${companyId}
    GROUP BY a.id, a.code, a.name, a.kind, a.normal_balance
    HAVING coalesce(sum(l.debit_cents), 0) <> 0 OR coalesce(sum(l.credit_cents), 0) <> 0
    ORDER BY a.code ASC
  `);

  const trialBalance: TrialBalanceSnapshotRow[] = rowsResult.rows.map(r => {
    const openingDebitCents = Number(r.opening_debit);
    const openingCreditCents = Number(r.opening_credit);
    const periodDebitCents = Number(r.period_debit);
    const periodCreditCents = Number(r.period_credit);
    return {
      accountId: r.account_id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      normalBalance: r.normal_balance,
      openingDebitCents,
      openingCreditCents,
      periodDebitCents,
      periodCreditCents,
      closingDebitCents: openingDebitCents + periodDebitCents,
      closingCreditCents: openingCreditCents + periodCreditCents,
    };
  });

  return {
    journalCount: Number(summary.journal_count),
    maxJournalNumber: Number(summary.max_number),
    totalDebitCents: Number(summary.total_debit),
    totalCreditCents: Number(summary.total_credit),
    trialBalance,
  };
}

/**
 * Cierra el periodo contable y congela el snapshot P&L y balanza dentro de una
 * sola transacción protegida por el lock compartido 505 (serializado contra
 * publicación concurrente de pólizas).
 */
export async function closeAccountingPeriodIn(
  tx: Tx,
  params: { companyId: string; year: number; month: number; closedBy: string },
) {
  const { companyId, year, month, closedBy } = params;
  // Shared lock 505 serializes period close against concurrent journal posting.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 505))`);

  let [period] = await tx
    .select()
    .from(financialPeriods)
    .where(
      and(
        eq(financialPeriods.companyId, companyId),
        eq(financialPeriods.year, year),
        eq(financialPeriods.month, month),
      ),
    )
    .limit(1)
    .for("update");

  if (!period) {
    [period] = await tx
      .insert(financialPeriods)
      .values({ companyId, year, month, status: "OPEN", closeVersion: 0 })
      .returning();
  }

  if (period.status === "CLOSED") {
    const [activeClose] = await tx
      .select()
      .from(accountingPeriodCloses)
      .where(
        and(
          eq(accountingPeriodCloses.companyId, companyId),
          eq(accountingPeriodCloses.year, year),
          eq(accountingPeriodCloses.month, month),
          eq(accountingPeriodCloses.status, "ACTIVE"),
        ),
      )
      .limit(1);
    return { period, close: activeClose ?? null, alreadyClosed: true };
  }

  const blockers = await getPeriodCloseBlockersIn(tx, companyId, year, month);
  if (blockers.length > 0) {
    throw ApiError.conflict(blockers.map(b => b.message).join(" "), { blockers });
  }

  const { periodStart, periodEnd } = monthBounds(year, month);
  const tb = await buildTrialBalanceSnapshotIn(tx, companyId, periodStart, periodEnd);
  if (tb.totalDebitCents !== tb.totalCreditCents) {
    throw ApiError.conflict("Los cargos y abonos del periodo no cuadran; el cierre se aborta.");
  }

  const maxRow = await tx.execute<{ max_version: number }>(sql`
    SELECT coalesce(max(version), 0)::int AS max_version
    FROM accounting_period_closes
    WHERE company_id = ${companyId} AND year = ${year} AND month = ${month}
  `);
  const nextVersion = Number(maxRow.rows[0]?.max_version ?? 0) + 1;

  // Freeze P&L inside the same transaction so any snapshot error rolls back the close.
  const freeze = await freezePnLPeriodIn(tx, companyId, periodStart, periodEnd, closedBy, {
    closeVersion: nextVersion,
  });

  const [close] = await tx
    .insert(accountingPeriodCloses)
    .values({
      companyId,
      periodId: period.id,
      year,
      month,
      version: nextVersion,
      status: "ACTIVE",
      journalCount: tb.journalCount,
      maxJournalNumber: tb.maxJournalNumber,
      totalDebitCents: tb.totalDebitCents,
      totalCreditCents: tb.totalCreditCents,
      trialBalance: tb.trialBalance as unknown as Record<string, unknown>[],
      pnlSnapshot: freeze.rows ?? [],
      closedBy,
    })
    .returning();

  await tx
    .update(pnlSnapshots)
    .set({ accountingCloseId: close.id, closeVersion: nextVersion })
    .where(
      and(
        eq(pnlSnapshots.companyId, companyId),
        eq(pnlSnapshots.periodStart, periodStart),
        eq(pnlSnapshots.periodEnd, periodEnd),
      ),
    );

  const [updatedPeriod] = await tx
    .update(financialPeriods)
    .set({
      status: "CLOSED",
      closeVersion: nextVersion,
      closedAt: close.closedAt,
      closedBy,
      updatedAt: new Date(),
    })
    .where(eq(financialPeriods.id, period.id))
    .returning();

  return { period: updatedPeriod, close, alreadyClosed: false };
}

export async function closeAccountingPeriod(
  ctx: CloseContext,
  input: { year: number; month: number },
) {
  try {
    const parsed = periodInputSchema.parse(input);
    return await withCompanyContext({ companyId: ctx.companyId, actorId: ctx.actorId }, async tx => {
      await authorizeCloseActor(tx, ctx, "publish");
      return closeAccountingPeriodIn(tx, {
        companyId: ctx.companyId,
        year: parsed.year,
        month: parsed.month,
        closedBy: ctx.actorId,
      });
    });
  } catch (error) {
    return mapCloseError(error, "No se pudo cerrar el periodo contable.");
  }
}

export async function reopenAccountingPeriodIn(
  tx: Tx,
  params: { companyId: string; year: number; month: number; reopenedBy: string; reason: string },
) {
  const { companyId, year, month, reopenedBy, reason } = params;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 505))`);

  const [period] = await tx
    .select()
    .from(financialPeriods)
    .where(
      and(
        eq(financialPeriods.companyId, companyId),
        eq(financialPeriods.year, year),
        eq(financialPeriods.month, month),
      ),
    )
    .limit(1)
    .for("update");

  if (!period || period.status !== "CLOSED") {
    throw ApiError.conflict(`El periodo ${year}-${String(month).padStart(2, "0")} no está cerrado.`);
  }

  const now = new Date();
  const [superseded] = await tx
    .update(accountingPeriodCloses)
    .set({
      status: "SUPERSEDED",
      reopenedBy,
      reopenedAt: now,
      reopenReason: reason,
    })
    .where(
      and(
        eq(accountingPeriodCloses.companyId, companyId),
        eq(accountingPeriodCloses.year, year),
        eq(accountingPeriodCloses.month, month),
        eq(accountingPeriodCloses.status, "ACTIVE"),
      ),
    )
    .returning();

  const [updatedPeriod] = await tx
    .update(financialPeriods)
    .set({
      status: "OPEN",
      closedAt: null,
      closedBy: null,
      reopenedAt: now,
      reopenedBy,
      reopenReason: reason,
      updatedAt: now,
    })
    .where(eq(financialPeriods.id, period.id))
    .returning();

  return { period: updatedPeriod, supersededClose: superseded ?? null };
}

export async function reopenAccountingPeriod(
  ctx: CloseContext,
  input: { year: number; month: number; reason: string },
) {
  try {
    const parsed = reopenInputSchema.parse(input);
    const result = await withCompanyContext({ companyId: ctx.companyId, actorId: ctx.actorId }, async tx => {
      await authorizeCloseActor(tx, ctx, "reverse");
      return reopenAccountingPeriodIn(tx, {
        companyId: ctx.companyId,
        year: parsed.year,
        month: parsed.month,
        reopenedBy: ctx.actorId,
        reason: parsed.reason,
      });
    });

    await logDataAccess({
      userId: ctx.actorId,
      companyId: ctx.companyId,
      action: "UPDATE",
      resource: "financial_periods",
      resourceId: `${parsed.year}-${String(parsed.month).padStart(2, "0")}`,
      decision: {
        allowed: true,
        reason: parsed.reason,
      },
    });
    return result;
  } catch (error) {
    return mapCloseError(error, "No se pudo reabrir el periodo contable.");
  }
}

export async function getPeriodCloseBlockers(
  ctx: CloseContext,
  input: { year: number; month: number },
) {
  try {
    const parsed = periodInputSchema.parse(input);
    return await withCompanyContext({ companyId: ctx.companyId, actorId: ctx.actorId }, async tx => {
      await authorizeCloseActor(tx, ctx, "read");
      return getPeriodCloseBlockersIn(tx, ctx.companyId, parsed.year, parsed.month);
    });
  } catch (error) {
    return mapCloseError(error, "No se pudieron consultar los pendientes del periodo.");
  }
}

export async function listPeriodCloseVersions(
  ctx: CloseContext,
  input: { year: number; month: number },
) {
  try {
    const parsed = periodInputSchema.parse(input);
    return await withCompanyContext({ companyId: ctx.companyId, actorId: ctx.actorId }, async tx => {
      await authorizeCloseActor(tx, ctx, "read");
      return tx
        .select()
        .from(accountingPeriodCloses)
        .where(
          and(
            eq(accountingPeriodCloses.companyId, ctx.companyId),
            eq(accountingPeriodCloses.year, parsed.year),
            eq(accountingPeriodCloses.month, parsed.month),
          ),
        )
        .orderBy(desc(accountingPeriodCloses.version));
    });
  } catch (error) {
    return mapCloseError(error, "No se pudieron consultar las versiones del cierre.");
  }
}
