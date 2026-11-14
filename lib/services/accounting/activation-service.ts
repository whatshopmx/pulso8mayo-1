import { and, asc, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import {
  accountingAccounts,
  accountingCompanySettings,
  accountingEvents,
  accountingJournals,
  accountingOpenings,
  accountingPeriodCloses,
  dailySalesCuts,
  expensePayments,
  operatingExpenses,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";
import { getRoleScope } from "@/lib/rbac/resource-scope";
import { totalsOf } from "./amounts";
import { isAccountingPostingEnabled } from "./expense-adapter";
import { openingSchema } from "./opening-service";
import { getPnlToCashBridge } from "./pnl-bridge-service";

export type PilotMode = "DISABLED" | "COMPARISON" | "ACTIVE";

export interface ActivationContext {
  companyId: string;
  actorId: string;
  role: Role;
}

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];

const activateSchema = z.object({
  mode: z.enum(["COMPARISON", "ACTIVE"]).default("COMPARISON"),
  postingEnabled: z.boolean().default(true),
  reviewEnabled: z.boolean().default(true),
  openingDate: z.iso.date().optional(),
  requireOpening: z.boolean().default(true),
}).strict();

const disableSchema = z.object({
  reason: z.string().trim().min(5, "Indica el motivo de desactivación (mínimo 5 caracteres).").max(500),
}).strict();

const metricsQuerySchema = z.object({
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
}).strict();

async function hasCompanySettingsTableIn(tx: Tx): Promise<boolean> {
  const res = await tx.execute(sql`select to_regclass('accounting_company_settings') as reg`);
  const row = res.rows?.[0] as { reg?: string | null } | undefined;
  return Boolean(row?.reg);
}

/**
 * Checks if automatic posting is enabled for a specific company.
 * Falls back to the global env flag when no per-company row exists or before
 * migration 0150 is applied, preserving compatibility with older test setups.
 */
export async function isCompanyPostingEnabledIn(tx: Tx, companyId: string): Promise<boolean> {
  if (!isAccountingPostingEnabled()) return false;
  if (!(await hasCompanySettingsTableIn(tx))) return true;
  const [row] = await tx
    .select({
      mode: accountingCompanySettings.mode,
      postingEnabled: accountingCompanySettings.postingEnabled,
    })
    .from(accountingCompanySettings)
    .where(eq(accountingCompanySettings.companyId, companyId))
    .limit(1);
  if (!row) return true;
  return row.mode !== "DISABLED" && row.postingEnabled;
}

export async function isCompanyPostingEnabled(companyId: string): Promise<boolean> {
  if (!isAccountingPostingEnabled()) return false;
  const parsed = z.uuid().parse(companyId);
  return withCompanyContext({ companyId: parsed }, tx => isCompanyPostingEnabledIn(tx, parsed));
}

/** Returns the company's immutable opening date (or configured pilot start date). */
export async function getCompanyOpeningDateIn(tx: Tx, companyId: string): Promise<string | null> {
  const [opening] = await tx
    .select({ openingDate: accountingOpenings.openingDate })
    .from(accountingOpenings)
    .where(eq(accountingOpenings.companyId, companyId))
    .limit(1);
  if (opening?.openingDate) return opening.openingDate;
  if (!(await hasCompanySettingsTableIn(tx))) return null;
  const [setting] = await tx
    .select({ openingDate: accountingCompanySettings.openingDate })
    .from(accountingCompanySettings)
    .where(eq(accountingCompanySettings.companyId, companyId))
    .limit(1);
  return setting?.openingDate ?? null;
}

async function runAuthorized<T>(
  ctx: ActivationContext,
  action: "read" | "manage",
  operation: (tx: Tx, companyId: string, actorId: string) => Promise<T>,
): Promise<T> {
  try {
    const canRead = hasPermission(ctx.role, "accounting", "read");
    const canManage = hasPermission(ctx.role, "settings", "update") && hasPermission(ctx.role, "accounting", "publish");
    if (action === "read" && !canRead) {
      throw ApiError.forbidden("No tienes permiso para consultar el estado del piloto contable.");
    }
    if (action === "manage" && !canManage) {
      throw ApiError.forbidden("Activar o desactivar el piloto contable requiere permisos de configuración y publicación.");
    }
    if (getRoleScope(ctx.role) !== "COMPANY") {
      throw ApiError.forbidden("La operación del piloto contable requiere alcance de toda la empresa.");
    }
    const principal = z.object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) })
      .parse({ companyId: ctx.companyId, actorId: ctx.actorId });
    return await withCompanyContext(principal, async tx => {
      const [actor] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, principal.companyId),
        eq(users.id, principal.actorId),
        eq(users.role, ctx.role),
        eq(users.active, true),
        isNull(users.deletedAt),
      )).limit(1);
      if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa con ese permiso.");
      return operation(tx, principal.companyId, principal.actorId);
    });
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof ZodError) throw ApiError.badRequest("Revisa los parámetros del piloto contable.");
    throw ApiError.internal("No se pudo procesar la configuración del piloto contable.");
  }
}

/** Preview opening balance import without publishing or modifying any ledger state. */
export function previewCompanyOpening(
  ctx: ActivationContext,
  input: z.input<typeof openingSchema>,
) {
  return runAuthorized(ctx, "read", async (tx, companyId) => {
    if (!hasPermission(ctx.role, "settings", "update")) {
      throw ApiError.forbidden("No tienes permiso para previsualizar la apertura contable.");
    }
    const data = openingSchema.parse(input);
    const totals = totalsOf(data.lines);
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!totals.balanced) {
      blockers.push(`La apertura no cuadra: cargos ${totals.debitCents} y abonos ${totals.creditCents}.`);
    }

    const [existingOpening] = await tx
      .select({ id: accountingOpenings.id, openingDate: accountingOpenings.openingDate })
      .from(accountingOpenings)
      .where(eq(accountingOpenings.companyId, companyId))
      .limit(1);
    if (existingOpening) {
      blockers.push(`La empresa ya tiene una apertura registrada al ${existingOpening.openingDate}.`);
    }

    const [overlappingJournal] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(accountingJournals)
      .where(and(
        eq(accountingJournals.companyId, companyId),
        eq(accountingJournals.status, "POSTED"),
        lte(accountingJournals.accountingDate, data.openingDate),
      ));
    if ((overlappingJournal?.count ?? 0) > 0) {
      blockers.push(
        `Existen ${overlappingJournal.count} póliza(s) publicadas en o antes del ${data.openingDate}; la apertura no puede solaparlas.`,
      );
    }

    const accountIds = [...new Set(data.lines.map(l => l.accountId))];
    const accounts = await tx
      .select({
        id: accountingAccounts.id,
        code: accountingAccounts.code,
        name: accountingAccounts.name,
        active: accountingAccounts.active,
        postable: accountingAccounts.postable,
        validFrom: accountingAccounts.validFrom,
        validTo: accountingAccounts.validTo,
      })
      .from(accountingAccounts)
      .where(eq(accountingAccounts.companyId, companyId));
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    for (const accId of accountIds) {
      const acc = accountMap.get(accId);
      if (!acc) {
        blockers.push(`Cuenta ${accId} no existe en el catálogo de esta empresa.`);
        continue;
      }
      if (!acc.active || !acc.postable) {
        blockers.push(`Cuenta ${acc.code} (${acc.name}) está inactiva o no es afectable.`);
      }
      if (acc.validFrom > data.openingDate || (acc.validTo && acc.validTo < data.openingDate)) {
        blockers.push(`Cuenta ${acc.code} no está vigente al ${data.openingDate}.`);
      }
    }

    const [expCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(operatingExpenses)
      .where(and(eq(operatingExpenses.companyId, companyId), lte(operatingExpenses.businessDate, data.openingDate)));
    const [payCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(expensePayments)
      .where(and(eq(expensePayments.companyId, companyId), lte(expensePayments.paidAt, data.openingDate)));
    const [cutCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(dailySalesCuts)
      .where(and(eq(dailySalesCuts.companyId, companyId), lte(dailySalesCuts.businessDate, data.openingDate)));

    const historicalExcluded = {
      operatingExpenses: expCount?.count ?? 0,
      expensePayments: payCount?.count ?? 0,
      dailySalesCuts: cutCount?.count ?? 0,
    };
    const totalHistorical = historicalExcluded.operatingExpenses
      + historicalExcluded.expensePayments
      + historicalExcluded.dailySalesCuts;
    if (totalHistorical > 0) {
      warnings.push(
        `Se excluirán ${totalHistorical} operación(es) históricas en o antes del ${data.openingDate} para no solapar la apertura.`,
      );
    }

    return {
      ready: blockers.length === 0,
      requiresConfirmation: true,
      published: false,
      openingDate: data.openingDate,
      totals,
      lineCount: data.lines.length,
      documentCount: data.documents.length,
      blockers,
      warnings,
      historicalExcluded,
    };
  });
}

export function getCompanyPilotStatus(ctx: ActivationContext) {
  return runAuthorized(ctx, "read", async (tx, companyId) => {
    const [setting] = await tx
      .select()
      .from(accountingCompanySettings)
      .where(eq(accountingCompanySettings.companyId, companyId))
      .limit(1);
    const [opening] = await tx
      .select({ id: accountingOpenings.id, openingDate: accountingOpenings.openingDate })
      .from(accountingOpenings)
      .where(eq(accountingOpenings.companyId, companyId))
      .limit(1);

    return {
      companyId,
      envPostingEnabled: isAccountingPostingEnabled(),
      mode: (setting?.mode ?? "DISABLED") as PilotMode,
      postingEnabled: setting ? (setting.mode !== "DISABLED" && setting.postingEnabled) : false,
      reviewEnabled: setting?.reviewEnabled ?? false,
      openingDate: opening?.openingDate ?? setting?.openingDate ?? null,
      openingPosted: Boolean(opening),
      activatedAt: setting?.activatedAt ?? null,
      disabledAt: setting?.disabledAt ?? null,
      disableReason: setting?.disableReason ?? null,
    };
  });
}

/** Gradually enables the accounting pilot for a single company. */
export function activateCompanyPilot(
  ctx: ActivationContext,
  input: z.input<typeof activateSchema>,
) {
  return runAuthorized(ctx, "manage", async (tx, companyId, actorId) => {
    const data = activateSchema.parse(input);
    const [opening] = await tx
      .select({ id: accountingOpenings.id, openingDate: accountingOpenings.openingDate })
      .from(accountingOpenings)
      .where(eq(accountingOpenings.companyId, companyId))
      .limit(1);

    if (data.requireOpening && data.postingEnabled && !opening) {
      throw ApiError.conflict("Publica y revisa la apertura contable antes de activar la contabilización de la empresa.");
    }

    const effectiveOpeningDate = opening?.openingDate ?? data.openingDate ?? null;
    const now = new Date();
    const [saved] = await tx
      .insert(accountingCompanySettings)
      .values({
        companyId,
        mode: data.mode,
        postingEnabled: data.postingEnabled,
        reviewEnabled: data.reviewEnabled,
        openingDate: effectiveOpeningDate,
        activatedAt: now,
        activatedBy: actorId,
        disabledAt: null,
        disabledBy: null,
        disableReason: null,
        updatedBy: actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accountingCompanySettings.companyId,
        set: {
          mode: data.mode,
          postingEnabled: data.postingEnabled,
          reviewEnabled: data.reviewEnabled,
          openingDate: effectiveOpeningDate,
          activatedAt: now,
          activatedBy: actorId,
          disabledAt: null,
          disabledBy: null,
          disableReason: null,
          updatedBy: actorId,
          updatedAt: now,
        },
      })
      .returning();
    return saved;
  });
}

/**
 * Reversible rollback: stops new events and automatic posting for this company
 * while preserving all journals, openings, closes and outbox evidence intact.
 */
export function disableCompanyPilot(
  ctx: ActivationContext,
  input: z.input<typeof disableSchema>,
) {
  return runAuthorized(ctx, "manage", async (tx, companyId, actorId) => {
    const data = disableSchema.parse(input);
    const now = new Date();
    const [opening] = await tx
      .select({ openingDate: accountingOpenings.openingDate })
      .from(accountingOpenings)
      .where(eq(accountingOpenings.companyId, companyId))
      .limit(1);

    const [saved] = await tx
      .insert(accountingCompanySettings)
      .values({
        companyId,
        mode: "DISABLED",
        postingEnabled: false,
        reviewEnabled: false,
        openingDate: opening?.openingDate ?? null,
        disabledAt: now,
        disabledBy: actorId,
        disableReason: data.reason,
        updatedBy: actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accountingCompanySettings.companyId,
        set: {
          mode: "DISABLED",
          postingEnabled: false,
          disabledAt: now,
          disabledBy: actorId,
          disableReason: data.reason,
          updatedBy: actorId,
          updatedAt: now,
        },
      })
      .returning();
    return saved;
  });
}

/** Measures backlog, failures, posting latency and P&L-to-cash differences per company. */
export async function measureCompanyPilotMetrics(
  ctx: ActivationContext,
  input: z.input<typeof metricsQuerySchema> = {},
) {
  const query = metricsQuerySchema.parse(input);
  const now = new Date();
  const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = now.toISOString().slice(0, 10);
  const fromDate = query.fromDate ?? defaultFrom;
  const toDate = query.toDate ?? defaultTo;

  const base = await runAuthorized(ctx, "read", async (tx, companyId) => {
    const [setting] = await tx
      .select()
      .from(accountingCompanySettings)
      .where(eq(accountingCompanySettings.companyId, companyId))
      .limit(1);
    const [opening] = await tx
      .select({ id: accountingOpenings.id, openingDate: accountingOpenings.openingDate })
      .from(accountingOpenings)
      .where(eq(accountingOpenings.companyId, companyId))
      .limit(1);

    const [backlogRow] = await tx
      .select({
        pendingCount: sql<number>`count(*) filter (where ${accountingEvents.status} = 'PENDING')::int`,
        failedCount: sql<number>`count(*) filter (where ${accountingEvents.status} = 'PENDING' and ${accountingEvents.attempts} > 0 and ${accountingEvents.lastError} is not null)::int`,
        postedCount: sql<number>`count(*) filter (where ${accountingEvents.status} = 'POSTED')::int`,
        oldestPendingAt: sql<Date | null>`min(${accountingEvents.createdAt}) filter (where ${accountingEvents.status} = 'PENDING')`,
        maxAgeSeconds: sql<number>`coalesce(max(greatest(0, floor(extract(epoch from (now() - ${accountingEvents.createdAt}))))) filter (where ${accountingEvents.status} = 'PENDING'), 0)::float8`,
        avgPostingSeconds: sql<number>`coalesce(avg(greatest(0, extract(epoch from (${accountingEvents.updatedAt} - ${accountingEvents.createdAt})))) filter (where ${accountingEvents.status} = 'POSTED'), 0)::float8`,
      })
      .from(accountingEvents)
      .where(eq(accountingEvents.companyId, companyId));

    const recentErrors = await tx
      .select({
        error: accountingEvents.lastError,
        count: sql<number>`count(*)::int`,
      })
      .from(accountingEvents)
      .where(and(
        eq(accountingEvents.companyId, companyId),
        eq(accountingEvents.status, "PENDING"),
        isNotNull(accountingEvents.lastError),
      ))
      .groupBy(accountingEvents.lastError)
      .orderBy(desc(sql`count(*)`), asc(accountingEvents.lastError))
      .limit(10);

    const [latestClose] = await tx
      .select({
        year: accountingPeriodCloses.year,
        month: accountingPeriodCloses.month,
        version: accountingPeriodCloses.version,
        status: accountingPeriodCloses.status,
        closedAt: accountingPeriodCloses.closedAt,
      })
      .from(accountingPeriodCloses)
      .where(eq(accountingPeriodCloses.companyId, companyId))
      .orderBy(desc(accountingPeriodCloses.closedAt))
      .limit(1);

    return {
      companyId,
      activation: {
        mode: (setting?.mode ?? "DISABLED") as PilotMode,
        postingEnabled: setting ? (setting.mode !== "DISABLED" && setting.postingEnabled) : false,
        reviewEnabled: setting?.reviewEnabled ?? false,
        openingDate: opening?.openingDate ?? setting?.openingDate ?? null,
        openingPosted: Boolean(opening),
      },
      backlog: {
        pendingCount: backlogRow?.pendingCount ?? 0,
        failedCount: backlogRow?.failedCount ?? 0,
        postedCount: backlogRow?.postedCount ?? 0,
        oldestPendingAt: backlogRow?.oldestPendingAt ?? null,
        maxAgeSeconds: backlogRow?.maxAgeSeconds ?? 0,
        avgPostingSeconds: backlogRow?.avgPostingSeconds ?? 0,
        recentErrors: recentErrors.map(e => ({ error: e.error ?? "", count: e.count })),
      },
      latestClose: latestClose ?? null,
    };
  });

  const bridge = await getPnlToCashBridge(
    { companyId: ctx.companyId, actorId: ctx.actorId, role: ctx.role },
    { fromDate, toDate },
  );

  const byCategory = bridge.items.reduce(
    (acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + item.amountCents;
      return acc;
    },
    { ESTIMACION: 0, FECHA: 0, FUENTE: 0 } as Record<"ESTIMACION" | "FECHA" | "FUENTE", number>,
  );

  return {
    ...base,
    differences: {
      fromDate,
      toDate,
      operationalOperatingProfitCents: bridge.operationalOperatingProfitCents,
      accountingNetIncomeCents: bridge.accountingNetIncomeCents,
      operationalToAccountingDeltaCents: bridge.operationalToAccountingDeltaCents,
      accountingToOperatingCashDeltaCents: bridge.accountingToOperatingCashDeltaCents,
      unexplainedAccountingToCashCents: bridge.unexplainedAccountingToCashCents,
      itemCount: bridge.items.length,
      byCategory,
    },
  };
}
