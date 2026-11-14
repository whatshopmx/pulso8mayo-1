import { and, eq, isNull, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import {
  accountingAccounts,
  branches,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";

export interface CashFlowContext {
  companyId: string;
  actorId: string;
  role: Role;
}

export type CashFlowActivity = "OPERATING" | "INVESTING" | "FINANCING";

export interface CashFlowItem {
  journalId: string;
  journalNumber: number | null;
  accountingDate: string;
  description: string;
  sourceType: string | null;
  branchId: string | null;
  activity: CashFlowActivity;
  direction: "INFLOW" | "OUTFLOW";
  amountCents: number;
  signedCashCents: number;
  counterpartSummary: string;
}

export interface ExcludedTransferItem {
  journalId: string;
  journalNumber: number | null;
  accountingDate: string;
  description: string;
  amountCents: number;
}

export interface ActivityBucket {
  inflowsCents: number;
  outflowsCents: number;
  netCents: number;
  items: CashFlowItem[];
}

export interface RealizedCashFlowReport {
  period: {
    fromDate: string;
    toDate: string;
    branchId: string | null;
    branchName: string | null;
  };
  cashAccountIds: string[];
  openingCashCents: number;
  closingCashCents: number;
  cashChangeCents: number;
  netCashFlowCents: number;
  reconcilesWithCashBalances: boolean;
  operating: ActivityBucket;
  investing: ActivityBucket;
  financing: ActivityBucket;
  excludedTransfers: {
    count: number;
    totalAmountCents: number;
    items: ExcludedTransferItem[];
  };
}

const daySchema = z.iso.date().refine(v => v >= "0001-01-01", "Fecha inválida.");

export const cashFlowQuerySchema = z
  .object({
    fromDate: daySchema,
    toDate: daySchema,
    branchId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine(d => d.fromDate <= d.toDate, {
    message: "La fecha inicial no puede ser posterior a la fecha final.",
  });

const CASH_RULE_ROLES = new Set(["PAYMENT_SOURCE", "PETTY_CASH", "CASH", "BANK"]);

function isCashAccountCandidate(code: string, name: string, kind: string, ruleRoles: Set<string>): boolean {
  if (kind !== "ASSET") return false;
  if (ruleRoles.size > 0) {
    for (const r of ruleRoles) {
      if (CASH_RULE_ROLES.has(r)) return true;
    }
  }
  const normalizedCode = code.trim();
  const normalizedName = name.toLowerCase();
  if (/^(10|110)/.test(normalizedCode)) return true;
  return (
    normalizedName.includes("caja") ||
    normalizedName.includes("banco") ||
    normalizedName.includes("efectivo") ||
    normalizedName.includes("tesorer")
  );
}

function classifyJournalActivity(
  sourceType: string | null,
  counterpartLines: { kind: string; code: string; name: string; absCents: number }[],
): CashFlowActivity {
  if (sourceType && ["ASSET_PURCHASE", "ASSET_SALE", "CAPEX", "FIXED_ASSET"].includes(sourceType)) {
    return "INVESTING";
  }
  if (sourceType && ["LOAN_DISBURSEMENT", "LOAN_REPAYMENT", "EQUITY_CONTRIBUTION", "DIVIDEND"].includes(sourceType)) {
    return "FINANCING";
  }

  let investingWeight = 0;
  let financingWeight = 0;
  let operatingWeight = 0;

  for (const line of counterpartLines) {
    const lowerName = line.name.toLowerCase();
    if (line.kind === "EQUITY") {
      financingWeight += line.absCents;
    } else if (
      line.kind === "LIABILITY" &&
      (/^(23|24|25)/.test(line.code.trim()) ||
        lowerName.includes("préstamo") ||
        lowerName.includes("prestamo") ||
        lowerName.includes("crédito") ||
        lowerName.includes("credito") ||
        lowerName.includes("deuda") ||
        lowerName.includes("financ"))
    ) {
      financingWeight += line.absCents;
    } else if (
      line.kind === "ASSET" &&
      (/^(15|16|17|18)/.test(line.code.trim()) ||
        lowerName.includes("equipo") ||
        lowerName.includes("mobiliario") ||
        lowerName.includes("inmueble") ||
        lowerName.includes("activo fijo") ||
        lowerName.includes("maquinaria"))
    ) {
      investingWeight += line.absCents;
    } else {
      operatingWeight += line.absCents;
    }
  }

  if (financingWeight > operatingWeight && financingWeight >= investingWeight) return "FINANCING";
  if (investingWeight > operatingWeight && investingWeight > financingWeight) return "INVESTING";
  return "OPERATING";
}

function emptyBucket(): ActivityBucket {
  return { inflowsCents: 0, outflowsCents: 0, netCents: 0, items: [] };
}

export async function getRealizedCashFlow(
  ctx: CashFlowContext,
  input: z.input<typeof cashFlowQuerySchema>,
): Promise<RealizedCashFlowReport> {
  try {
    const data = cashFlowQuerySchema.parse(input);
    if (!hasPermission(ctx.role, "accounting", "read")) {
      throw ApiError.forbidden("No tienes permiso para consultar el flujo de efectivo contable.");
    }

    const principal = z
      .object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) })
      .parse({ companyId: ctx.companyId, actorId: ctx.actorId });

    return await withCompanyContext({ companyId: principal.companyId }, async tx => {
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
        throw ApiError.forbidden("No tienes una sucursal asignada para consultar flujo contable.");
      }

      let effectiveBranchId: string | null = data.branchId ?? null;
      if (scope.kind === "BRANCH") {
        if (data.branchId && data.branchId !== scope.branchId) {
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

      // Resolve cash accounts from rule entries + bank links + standard cash/bank codes
      const accounts = await tx
        .select({
          id: accountingAccounts.id,
          code: accountingAccounts.code,
          name: accountingAccounts.name,
          kind: accountingAccounts.kind,
        })
        .from(accountingAccounts)
        .where(eq(accountingAccounts.companyId, principal.companyId));

      const ruleRoleRes = await tx.execute<{ account_id: string; role: string }>(sql`
        SELECT DISTINCT account_id, role
        FROM accounting_rule_entries
        WHERE company_id = ${principal.companyId}
      `);
      const rolesByAccount = new Map<string, Set<string>>();
      for (const r of ruleRoleRes.rows) {
        const set = rolesByAccount.get(r.account_id) ?? new Set<string>();
        set.add(r.role);
        rolesByAccount.set(r.account_id, set);
      }

      const bankLinkRes = await tx.execute<{ account_id: string }>(sql`
        SELECT DISTINCT account_id
        FROM accounting_source_links
        WHERE company_id = ${principal.companyId}
          AND bank_account_id IS NOT NULL
      `);
      const bankLinkedIds = new Set(bankLinkRes.rows.map(r => r.account_id));

      const cashAccountIds = accounts
        .filter(
          a =>
            bankLinkedIds.has(a.id) ||
            isCashAccountCandidate(a.code, a.name, a.kind, rolesByAccount.get(a.id) ?? new Set()),
        )
        .map(a => a.id);
      const cashAccountSet = new Set(cashAccountIds);

      if (cashAccountIds.length === 0) {
        return {
          period: { fromDate: data.fromDate, toDate: data.toDate, branchId: effectiveBranchId, branchName },
          cashAccountIds: [],
          openingCashCents: 0,
          closingCashCents: 0,
          cashChangeCents: 0,
          netCashFlowCents: 0,
          reconcilesWithCashBalances: true,
          operating: emptyBucket(),
          investing: emptyBucket(),
          financing: emptyBucket(),
          excludedTransfers: { count: 0, totalAmountCents: 0, items: [] },
        };
      }

      const branchFilter = effectiveBranchId ? sql`AND j.branch_id = ${effectiveBranchId}` : sql``;

      // Opening cash balance (< fromDate)
      const cashIdList = sql.join(cashAccountIds.map(id => sql`${id}`), sql`, `);
      const openingRes = await tx.execute<{ net_cents: string }>(sql`
        SELECT coalesce(sum(l.debit_cents - l.credit_cents), 0)::text AS net_cents
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        WHERE j.company_id = ${principal.companyId}
          AND j.status = 'POSTED'
          AND j.accounting_date < ${data.fromDate}
          AND l.account_id IN (${cashIdList})
          ${branchFilter}
      `);
      const openingCashCents = Number(openingRes.rows[0]?.net_cents ?? 0);

      // All POSTED journal lines inside [fromDate, toDate] that belong to journals touching at least one cash account
      const linesRes = await tx.execute<{
        journal_id: string;
        journal_number: number | null;
        accounting_date: string;
        description: string;
        source_type: string | null;
        branch_id: string | null;
        account_id: string;
        account_code: string;
        account_name: string;
        account_kind: string;
        debit_cents: string;
        credit_cents: string;
      }>(sql`
        SELECT
          j.id AS journal_id,
          j.number AS journal_number,
          j.accounting_date::text AS accounting_date,
          j.description,
          j.source_type,
          j.branch_id,
          l.account_id,
          a.code AS account_code,
          a.name AS account_name,
          a.kind AS account_kind,
          l.debit_cents::text AS debit_cents,
          l.credit_cents::text AS credit_cents
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        JOIN accounting_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE j.company_id = ${principal.companyId}
          AND j.status = 'POSTED'
          AND j.accounting_date >= ${data.fromDate}
          AND j.accounting_date <= ${data.toDate}
          ${branchFilter}
          AND EXISTS (
            SELECT 1 FROM accounting_journal_lines cl
            WHERE cl.company_id = j.company_id
              AND cl.journal_id = j.id
              AND cl.account_id IN (${cashIdList})
          )
        ORDER BY j.accounting_date ASC, j.number ASC NULLS LAST, l.line_number ASC
      `);

      const byJournal = new Map<
        string,
        {
          journalId: string;
          journalNumber: number | null;
          accountingDate: string;
          description: string;
          sourceType: string | null;
          branchId: string | null;
          cashDeltaCents: number;
          cashGrossDebitCents: number;
          cashLineCount: number;
          totalLineCount: number;
          counterparts: { kind: string; code: string; name: string; absCents: number }[];
        }
      >();

      for (const r of linesRes.rows) {
        const debit = Number(r.debit_cents);
        const credit = Number(r.credit_cents);
        const entry = byJournal.get(r.journal_id) ?? {
          journalId: r.journal_id,
          journalNumber: r.journal_number,
          accountingDate: r.accounting_date,
          description: r.description,
          sourceType: r.source_type,
          branchId: r.branch_id,
          cashDeltaCents: 0,
          cashGrossDebitCents: 0,
          cashLineCount: 0,
          totalLineCount: 0,
          counterparts: [],
        };
        entry.totalLineCount += 1;
        if (cashAccountSet.has(r.account_id)) {
          entry.cashLineCount += 1;
          entry.cashDeltaCents += debit - credit;
          entry.cashGrossDebitCents += debit;
        } else {
          entry.counterparts.push({
            kind: r.account_kind,
            code: r.account_code,
            name: r.account_name,
            absCents: Math.abs(debit - credit),
          });
        }
        byJournal.set(r.journal_id, entry);
      }

      const operating = emptyBucket();
      const investing = emptyBucket();
      const financing = emptyBucket();
      const excludedItems: ExcludedTransferItem[] = [];
      let excludedTotalAmountCents = 0;

      for (const j of byJournal.values()) {
        // Internal transfer between own cash/bank/petty-cash accounts nets to 0 across cash accounts
        if (j.cashDeltaCents === 0) {
          excludedTotalAmountCents += j.cashGrossDebitCents;
          excludedItems.push({
            journalId: j.journalId,
            journalNumber: j.journalNumber,
            accountingDate: j.accountingDate,
            description: j.description,
            amountCents: j.cashGrossDebitCents,
          });
          continue;
        }

        const activity = classifyJournalActivity(j.sourceType, j.counterparts);
        const direction = j.cashDeltaCents > 0 ? "INFLOW" : "OUTFLOW";
        const amountCents = Math.abs(j.cashDeltaCents);
        const counterpartSummary =
          j.counterparts.map(c => `${c.code} ${c.name}`).slice(0, 3).join(", ") || "Contrapartida contable";

        const item: CashFlowItem = {
          journalId: j.journalId,
          journalNumber: j.journalNumber,
          accountingDate: j.accountingDate,
          description: j.description,
          sourceType: j.sourceType,
          branchId: j.branchId,
          activity,
          direction,
          amountCents,
          signedCashCents: j.cashDeltaCents,
          counterpartSummary,
        };

        const bucket = activity === "OPERATING" ? operating : activity === "INVESTING" ? investing : financing;
        if (direction === "INFLOW") bucket.inflowsCents += amountCents;
        else bucket.outflowsCents += amountCents;
        bucket.netCents += j.cashDeltaCents;
        bucket.items.push(item);
      }

      const netCashFlowCents = operating.netCents + investing.netCents + financing.netCents;

      // Cross-verify closing cash directly against SQL sum <= toDate
      const closingRes = await tx.execute<{ net_cents: string }>(sql`
        SELECT coalesce(sum(l.debit_cents - l.credit_cents), 0)::text AS net_cents
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        WHERE j.company_id = ${principal.companyId}
          AND j.status = 'POSTED'
          AND j.accounting_date <= ${data.toDate}
          AND l.account_id IN (${cashIdList})
          ${branchFilter}
      `);
      const sqlClosingCashCents = Number(closingRes.rows[0]?.net_cents ?? 0);

      return {
        period: { fromDate: data.fromDate, toDate: data.toDate, branchId: effectiveBranchId, branchName },
        cashAccountIds,
        openingCashCents,
        closingCashCents: sqlClosingCashCents,
        cashChangeCents: sqlClosingCashCents - openingCashCents,
        netCashFlowCents,
        reconcilesWithCashBalances: sqlClosingCashCents - openingCashCents === netCashFlowCents,
        operating,
        investing,
        financing,
        excludedTransfers: {
          count: excludedItems.length,
          totalAmountCents: excludedTotalAmountCents,
          items: excludedItems,
        },
      };
    });
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof ZodError) {
      throw ApiError.badRequest(error.issues[0]?.message ?? "Revisa los parámetros del flujo de efectivo.");
    }
    throw ApiError.internal("No se pudo calcular el flujo de efectivo realizado.");
  }
}
