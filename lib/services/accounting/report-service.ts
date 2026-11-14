import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { resolveBranchScope, type BranchScope } from "@/lib/branch-scope";
import {
  accountingAccounts,
  accountingOpenings,
  branches,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";

export interface ReportContext {
  companyId: string;
  actorId: string;
  role: Role;
}

type AccountKind = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
type NormalBalance = "DEBIT" | "CREDIT";

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  kind: AccountKind;
  normalBalance: NormalBalance;
  openingDebitCents: number;
  openingCreditCents: number;
  openingNetCents: number;
  periodDebitCents: number;
  periodCreditCents: number;
  periodNetCents: number;
  closingDebitCents: number;
  closingCreditCents: number;
  closingNetCents: number;
}

export interface StatementAccountRow {
  accountId: string;
  code: string;
  name: string;
  kind: AccountKind;
  normalBalance: NormalBalance;
  amountCents: number;
}

export interface CorporateUnassignedRow {
  accountId: string;
  code: string;
  name: string;
  kind: AccountKind;
  debitCents: number;
  creditCents: number;
}

export interface UnassignedCorporateSummary {
  declared: boolean;
  journalCount: number;
  totalDebitCents: number;
  totalCreditCents: number;
  netIncomeImpactCents: number;
  declaration: string;
  accounts: CorporateUnassignedRow[];
}

export interface LedgerEntryRow {
  journalId: string;
  journalNumber: number | null;
  accountingDate: string;
  description: string;
  branchId: string | null;
  branchName: string | null;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  debitCents: number;
  creditCents: number;
  runningBalanceCents: number;
}

const daySchema = z.iso.date().refine(v => v >= "0001-01-01", "Fecha inválida.");

export const reportQuerySchema = z
  .object({
    fromDate: daySchema,
    toDate: daySchema,
    branchId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine(d => d.fromDate <= d.toDate, {
    message: "La fecha inicial no puede ser posterior a la fecha final.",
  });

export const ledgerQuerySchema = z
  .object({
    accountId: z.uuid(),
    fromDate: daySchema,
    toDate: daySchema,
    branchId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine(d => d.fromDate <= d.toDate, {
    message: "La fecha inicial no puede ser posterior a la fecha final.",
  });

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];

function netByNormalBalance(normalBalance: NormalBalance, debitCents: number, creditCents: number) {
  return normalBalance === "DEBIT" ? debitCents - creditCents : creditCents - debitCents;
}

function mapReportError(error: unknown, fallback: string): never {
  if (isApiError(error)) throw error;
  if (error instanceof ZodError) {
    throw ApiError.badRequest(error.issues[0]?.message ?? "Revisa los parámetros del reporte contable.");
  }
  throw ApiError.internal(fallback);
}

async function authorizeReportActor(
  tx: Tx,
  ctx: ReportContext,
  requestedBranchId?: string | null,
): Promise<{ companyId: string; scope: BranchScope; effectiveBranchId: string | null; branchName: string | null }> {
  if (!hasPermission(ctx.role, "accounting", "read")) {
    throw ApiError.forbidden("No tienes permiso para consultar reportes contables.");
  }
  const principal = z
    .object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) })
    .parse({ companyId: ctx.companyId, actorId: ctx.actorId });

  const [actor] = await tx
    .select({ id: users.id, branchId: users.branchId })
    .from(users)
    .where(
      and(
        eq(users.id, principal.actorId),
        eq(users.companyId, principal.companyId),
        eq(users.role, ctx.role),
        eq(users.active, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa con ese permiso.");

  const scope = resolveBranchScope(ctx.role, actor.branchId);
  if (scope.kind === "NONE") {
    throw ApiError.forbidden("No tienes una sucursal asignada para consultar reportes contables.");
  }

  let effectiveBranchId: string | null = requestedBranchId ?? null;
  if (scope.kind === "BRANCH") {
    if (requestedBranchId && requestedBranchId !== scope.branchId) {
      throw ApiError.forbidden("No tienes acceso a esta sucursal.");
    }
    effectiveBranchId = scope.branchId;
  }

  let branchName: string | null = null;
  if (effectiveBranchId) {
    const [branch] = await tx
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.id, effectiveBranchId), eq(branches.companyId, principal.companyId)))
      .limit(1);
    if (!branch) throw ApiError.notFound("La sucursal indicada no existe en esta empresa.");
    branchName = branch.name;
  }

  return { companyId: principal.companyId, scope, effectiveBranchId, branchName };
}

export async function getAccountingStatements(
  ctx: ReportContext,
  input: z.input<typeof reportQuerySchema>,
) {
  try {
    const data = reportQuerySchema.parse(input);
    const fiscalYearStart = `${data.toDate.slice(0, 4)}-01-01`;

    return await withCompanyContext({ companyId: ctx.companyId }, async tx => {
      const { companyId, scope, effectiveBranchId, branchName } = await authorizeReportActor(
        tx,
        ctx,
        data.branchId ?? null,
      );

      const branchFilter = effectiveBranchId
        ? sql`AND j.branch_id = ${effectiveBranchId}`
        : sql``;

      // 1. Trial Balance: opening (< fromDate) + period ([fromDate, toDate]) = closing (<= toDate)
      const tbResult = await tx.execute<{
        account_id: string;
        code: string;
        name: string;
        kind: AccountKind;
        normal_balance: NormalBalance;
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
          coalesce(sum(CASE WHEN j.accounting_date < ${data.fromDate} THEN l.debit_cents ELSE 0 END), 0)::text AS opening_debit,
          coalesce(sum(CASE WHEN j.accounting_date < ${data.fromDate} THEN l.credit_cents ELSE 0 END), 0)::text AS opening_credit,
          coalesce(sum(CASE WHEN j.accounting_date >= ${data.fromDate} AND j.accounting_date <= ${data.toDate} THEN l.debit_cents ELSE 0 END), 0)::text AS period_debit,
          coalesce(sum(CASE WHEN j.accounting_date >= ${data.fromDate} AND j.accounting_date <= ${data.toDate} THEN l.credit_cents ELSE 0 END), 0)::text AS period_credit
        FROM accounting_accounts a
        LEFT JOIN accounting_journal_lines l
          ON l.company_id = a.company_id AND l.account_id = a.id
        LEFT JOIN accounting_journals j
          ON j.company_id = l.company_id
          AND j.id = l.journal_id
          AND j.status = 'POSTED'
          AND j.accounting_date <= ${data.toDate}
          ${branchFilter}
        WHERE a.company_id = ${companyId}
        GROUP BY a.id, a.code, a.name, a.kind, a.normal_balance
        HAVING coalesce(sum(CASE WHEN j.id IS NOT NULL THEN l.debit_cents ELSE 0 END), 0) <> 0
            OR coalesce(sum(CASE WHEN j.id IS NOT NULL THEN l.credit_cents ELSE 0 END), 0) <> 0
        ORDER BY a.code ASC
      `);

      const trialBalanceRows: TrialBalanceRow[] = tbResult.rows.map(r => {
        const openingDebitCents = Number(r.opening_debit);
        const openingCreditCents = Number(r.opening_credit);
        const periodDebitCents = Number(r.period_debit);
        const periodCreditCents = Number(r.period_credit);
        const closingDebitCents = openingDebitCents + periodDebitCents;
        const closingCreditCents = openingCreditCents + periodCreditCents;
        const openingNetCents = netByNormalBalance(r.normal_balance, openingDebitCents, openingCreditCents);
        const periodNetCents = netByNormalBalance(r.normal_balance, periodDebitCents, periodCreditCents);
        const closingNetCents = netByNormalBalance(r.normal_balance, closingDebitCents, closingCreditCents);

        return {
          accountId: r.account_id,
          code: r.code,
          name: r.name,
          kind: r.kind,
          normalBalance: r.normal_balance,
          openingDebitCents,
          openingCreditCents,
          openingNetCents,
          periodDebitCents,
          periodCreditCents,
          periodNetCents,
          closingDebitCents,
          closingCreditCents,
          closingNetCents,
        };
      });

      const tbTotals = trialBalanceRows.reduce(
        (acc, r) => ({
          openingDebitCents: acc.openingDebitCents + r.openingDebitCents,
          openingCreditCents: acc.openingCreditCents + r.openingCreditCents,
          periodDebitCents: acc.periodDebitCents + r.periodDebitCents,
          periodCreditCents: acc.periodCreditCents + r.periodCreditCents,
          closingDebitCents: acc.closingDebitCents + r.closingDebitCents,
          closingCreditCents: acc.closingCreditCents + r.closingCreditCents,
        }),
        {
          openingDebitCents: 0,
          openingCreditCents: 0,
          periodDebitCents: 0,
          periodCreditCents: 0,
          closingDebitCents: 0,
          closingCreditCents: 0,
        },
      );

      // 2. Income Statement for [fromDate, toDate]
      const incomeAccounts: StatementAccountRow[] = [];
      const expenseAccounts: StatementAccountRow[] = [];
      for (const r of trialBalanceRows) {
        if (r.kind === "INCOME" && r.periodNetCents !== 0) {
          incomeAccounts.push({
            accountId: r.accountId,
            code: r.code,
            name: r.name,
            kind: r.kind,
            normalBalance: r.normalBalance,
            amountCents: r.periodNetCents,
          });
        } else if (r.kind === "EXPENSE" && r.periodNetCents !== 0) {
          expenseAccounts.push({
            accountId: r.accountId,
            code: r.code,
            name: r.name,
            kind: r.kind,
            normalBalance: r.normalBalance,
            amountCents: r.periodNetCents,
          });
        }
      }
      const totalIncomeCents = incomeAccounts.reduce((s, r) => s + r.amountCents, 0);
      const totalExpenseCents = expenseAccounts.reduce((s, r) => s + r.amountCents, 0);
      const netIncomeCents = totalIncomeCents - totalExpenseCents;

      // 3. Balance Sheet as of toDate, with explicit prior-year retained earnings + current-year result (no hidden plug)
      const assets: StatementAccountRow[] = [];
      const liabilities: StatementAccountRow[] = [];
      const equity: StatementAccountRow[] = [];
      for (const r of trialBalanceRows) {
        if (r.closingNetCents === 0) continue;
        const item: StatementAccountRow = {
          accountId: r.accountId,
          code: r.code,
          name: r.name,
          kind: r.kind,
          normalBalance: r.normalBalance,
          amountCents: r.closingNetCents,
        };
        if (r.kind === "ASSET") assets.push(item);
        else if (r.kind === "LIABILITY") liabilities.push(item);
        else if (r.kind === "EQUITY") equity.push(item);
      }

      const fyResult = await tx.execute<{
        prior_income: string;
        prior_expense: string;
        current_income: string;
        current_expense: string;
      }>(sql`
        SELECT
          coalesce(sum(CASE WHEN j.accounting_date < ${fiscalYearStart} AND a.kind = 'INCOME' THEN l.credit_cents - l.debit_cents ELSE 0 END), 0)::text AS prior_income,
          coalesce(sum(CASE WHEN j.accounting_date < ${fiscalYearStart} AND a.kind = 'EXPENSE' THEN l.debit_cents - l.credit_cents ELSE 0 END), 0)::text AS prior_expense,
          coalesce(sum(CASE WHEN j.accounting_date >= ${fiscalYearStart} AND j.accounting_date <= ${data.toDate} AND a.kind = 'INCOME' THEN l.credit_cents - l.debit_cents ELSE 0 END), 0)::text AS current_income,
          coalesce(sum(CASE WHEN j.accounting_date >= ${fiscalYearStart} AND j.accounting_date <= ${data.toDate} AND a.kind = 'EXPENSE' THEN l.debit_cents - l.credit_cents ELSE 0 END), 0)::text AS current_expense
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        JOIN accounting_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE j.company_id = ${companyId}
          AND j.status = 'POSTED'
          AND j.accounting_date <= ${data.toDate}
          AND a.kind IN ('INCOME', 'EXPENSE')
          ${branchFilter}
      `);
      const fyRow = fyResult.rows[0];
      const retainedEarningsPriorYearsCents =
        Number(fyRow?.prior_income ?? 0) - Number(fyRow?.prior_expense ?? 0);
      const currentYearNetIncomeCents =
        Number(fyRow?.current_income ?? 0) - Number(fyRow?.current_expense ?? 0);

      const totalAssetsCents = assets.reduce((s, r) => s + r.amountCents, 0);
      const totalLiabilitiesCents = liabilities.reduce((s, r) => s + r.amountCents, 0);
      const recordedEquityCents = equity.reduce((s, r) => s + r.amountCents, 0);
      const totalEquityCents =
        recordedEquityCents + retainedEarningsPriorYearsCents + currentYearNetIncomeCents;
      const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents;
      const differenceCents = totalAssetsCents - totalLiabilitiesAndEquityCents;

      // 4. Corporate / unassigned entries declaration (j.branch_id IS NULL)
      const unassignedSummaryRes = await tx.execute<{
        journal_count: number;
        total_debit: string;
        total_credit: string;
        net_income_impact: string;
      }>(sql`
        SELECT
          count(DISTINCT j.id)::int AS journal_count,
          coalesce(sum(l.debit_cents), 0)::text AS total_debit,
          coalesce(sum(l.credit_cents), 0)::text AS total_credit,
          coalesce(sum(
            CASE
              WHEN a.kind = 'INCOME' THEN l.credit_cents - l.debit_cents
              WHEN a.kind = 'EXPENSE' THEN -(l.debit_cents - l.credit_cents)
              ELSE 0
            END
          ), 0)::text AS net_income_impact
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        JOIN accounting_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE j.company_id = ${companyId}
          AND j.status = 'POSTED'
          AND j.branch_id IS NULL
          AND j.accounting_date <= ${data.toDate}
      `);
      const uRow = unassignedSummaryRes.rows[0];
      const uCount = Number(uRow?.journal_count ?? 0);
      const uDebit = Number(uRow?.total_debit ?? 0);
      const uCredit = Number(uRow?.total_credit ?? 0);
      const uNetIncome = Number(uRow?.net_income_impact ?? 0);

      let unassignedAccounts: CorporateUnassignedRow[] = [];
      if (effectiveBranchId && uCount > 0 && scope.kind === "ALL") {
        const uAccRes = await tx.execute<{
          account_id: string;
          code: string;
          name: string;
          kind: AccountKind;
          debit_cents: string;
          credit_cents: string;
        }>(sql`
          SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.kind,
            coalesce(sum(l.debit_cents), 0)::text AS debit_cents,
            coalesce(sum(l.credit_cents), 0)::text AS credit_cents
          FROM accounting_journals j
          JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
          JOIN accounting_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
          WHERE j.company_id = ${companyId}
            AND j.status = 'POSTED'
            AND j.branch_id IS NULL
            AND j.accounting_date <= ${data.toDate}
          GROUP BY a.id, a.code, a.name, a.kind
          ORDER BY a.code ASC
        `);
        unassignedAccounts = uAccRes.rows.map(r => ({
          accountId: r.account_id,
          code: r.code,
          name: r.name,
          kind: r.kind,
          debitCents: Number(r.debit_cents),
          creditCents: Number(r.credit_cents),
        }));
      }

      const declaration = effectiveBranchId
        ? uCount > 0
          ? `Reporte filtrado por sucursal (${branchName}). Existen ${uCount} póliza(s) corporativas sin sucursal asignada (branch_id IS NULL) que no se prorratean en esta vista.`
          : `Reporte filtrado por sucursal (${branchName}). No hay pólizas corporativas sin sucursal asignada hasta ${data.toDate}.`
        : uCount > 0
          ? `Vista consolidada de empresa: incluye ${uCount} póliza(s) corporativas sin sucursal asignada.`
          : "Vista consolidada de empresa sin partidas corporativas sin asignar.";

      const openingsMeta = await tx
        .select({
          openingDate: accountingOpenings.openingDate,
        })
        .from(accountingOpenings)
        .where(and(eq(accountingOpenings.companyId, companyId), lte(accountingOpenings.openingDate, data.toDate)))
        .orderBy(asc(accountingOpenings.openingDate));

      const companyBranches = await tx
        .select({ id: branches.id, name: branches.name, code: branches.code })
        .from(branches)
        .where(
          scope.kind === "BRANCH"
            ? and(eq(branches.companyId, companyId), eq(branches.id, scope.branchId))
            : eq(branches.companyId, companyId),
        )
        .orderBy(asc(branches.name));

      return {
        period: {
          fromDate: data.fromDate,
          toDate: data.toDate,
          fiscalYearStart,
          branchId: effectiveBranchId,
          branchName,
          openingCount: openingsMeta.length,
          latestOpeningDate: openingsMeta.length > 0 ? openingsMeta[openingsMeta.length - 1].openingDate : null,
        },
        branches: companyBranches,
        trialBalance: {
          rows: trialBalanceRows,
          totals: tbTotals,
        },
        incomeStatement: {
          income: incomeAccounts,
          expenses: expenseAccounts,
          totalIncomeCents,
          totalExpenseCents,
          netIncomeCents,
        },
        balanceSheet: {
          asOfDate: data.toDate,
          assets,
          liabilities,
          equity,
          totalAssetsCents,
          totalLiabilitiesCents,
          recordedEquityCents,
          retainedEarningsPriorYearsCents,
          currentYearNetIncomeCents,
          totalEquityCents,
          totalLiabilitiesAndEquityCents,
          isBalanced: differenceCents === 0,
          differenceCents,
        },
        unassignedCorporate: {
          declared: Boolean(effectiveBranchId && uCount > 0),
          journalCount: uCount,
          totalDebitCents: uDebit,
          totalCreditCents: uCredit,
          netIncomeImpactCents: uNetIncome,
          declaration,
          accounts: unassignedAccounts,
        } satisfies UnassignedCorporateSummary,
      };
    });
  } catch (error) {
    mapReportError(error, "No se pudieron consultar los estados contables.");
  }
}

export async function getAccountLedger(
  ctx: ReportContext,
  input: z.input<typeof ledgerQuerySchema>,
) {
  try {
    const data = ledgerQuerySchema.parse(input);

    return await withCompanyContext({ companyId: ctx.companyId }, async tx => {
      const { companyId, effectiveBranchId } = await authorizeReportActor(
        tx,
        ctx,
        data.branchId ?? null,
      );

      const [account] = await tx
        .select({
          id: accountingAccounts.id,
          code: accountingAccounts.code,
          name: accountingAccounts.name,
          kind: accountingAccounts.kind,
          normalBalance: accountingAccounts.normalBalance,
        })
        .from(accountingAccounts)
        .where(and(eq(accountingAccounts.companyId, companyId), eq(accountingAccounts.id, data.accountId)))
        .limit(1);
      if (!account) throw ApiError.notFound("Cuenta contable no encontrada.");

      const branchFilter = effectiveBranchId
        ? sql`AND j.branch_id = ${effectiveBranchId}`
        : sql``;

      const openingRes = await tx.execute<{ debit: string; credit: string }>(sql`
        SELECT
          coalesce(sum(l.debit_cents), 0)::text AS debit,
          coalesce(sum(l.credit_cents), 0)::text AS credit
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        WHERE j.company_id = ${companyId}
          AND j.status = 'POSTED'
          AND l.account_id = ${account.id}
          AND j.accounting_date < ${data.fromDate}
          ${branchFilter}
      `);
      const openDebit = Number(openingRes.rows[0]?.debit ?? 0);
      const openCredit = Number(openingRes.rows[0]?.credit ?? 0);
      const openingBalanceCents = netByNormalBalance(
        account.normalBalance as NormalBalance,
        openDebit,
        openCredit,
      );

      const entriesRes = await tx.execute<{
        journal_id: string;
        journal_number: number | null;
        accounting_date: string;
        description: string;
        branch_id: string | null;
        branch_name: string | null;
        memo: string | null;
        source_type: string | null;
        source_id: string | null;
        debit_cents: string;
        credit_cents: string;
      }>(sql`
        SELECT
          j.id AS journal_id,
          j.number AS journal_number,
          j.accounting_date::text AS accounting_date,
          j.description,
          j.branch_id,
          b.name AS branch_name,
          l.memo,
          j.source_type,
          j.source_id,
          l.debit_cents::text AS debit_cents,
          l.credit_cents::text AS credit_cents
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        LEFT JOIN branches b ON b.company_id = j.company_id AND b.id = j.branch_id
        WHERE j.company_id = ${companyId}
          AND j.status = 'POSTED'
          AND l.account_id = ${account.id}
          AND j.accounting_date >= ${data.fromDate}
          AND j.accounting_date <= ${data.toDate}
          ${branchFilter}
        ORDER BY j.accounting_date ASC, j.number ASC NULLS LAST, l.line_number ASC
      `);

      let running = openingBalanceCents;
      let totalDebitCents = 0;
      let totalCreditCents = 0;
      const entries: LedgerEntryRow[] = entriesRes.rows.map(r => {
        const debitCents = Number(r.debit_cents);
        const creditCents = Number(r.credit_cents);
        totalDebitCents += debitCents;
        totalCreditCents += creditCents;
        running += netByNormalBalance(account.normalBalance as NormalBalance, debitCents, creditCents);
        return {
          journalId: r.journal_id,
          journalNumber: r.journal_number,
          accountingDate: r.accounting_date,
          description: r.description,
          branchId: r.branch_id,
          branchName: r.branch_name,
          memo: r.memo,
          sourceType: r.source_type,
          sourceId: r.source_id,
          debitCents,
          creditCents,
          runningBalanceCents: running,
        };
      });

      return {
        account,
        period: {
          fromDate: data.fromDate,
          toDate: data.toDate,
          branchId: effectiveBranchId,
        },
        openingBalanceCents,
        entries,
        totalDebitCents,
        totalCreditCents,
        closingBalanceCents: running,
      };
    });
  } catch (error) {
    mapReportError(error, "No se pudo consultar el auxiliar de la cuenta.");
  }
}
