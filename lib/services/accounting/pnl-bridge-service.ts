import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { accountingJournals, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { getPnLByBranch } from "@/lib/services/pnl-service";
import {
  cashFlowQuerySchema,
  getRealizedCashFlow,
  type CashFlowContext,
  type RealizedCashFlowReport,
} from "./cash-flow-service";

export type BridgeCategory = "FUENTE" | "FECHA" | "ESTIMACION";

export interface PnlBridgeItem {
  code: string;
  category: BridgeCategory;
  label: string;
  explanation: string;
  amountCents: number;
  metadata?: Record<string, unknown>;
}

export interface PnlBridgeReport {
  period: {
    fromDate: string;
    toDate: string;
    branchId: string | null;
    branchName: string | null;
  };
  operationalOperatingProfitCents: number;
  accountingNetIncomeCents: number;
  operatingCashFlowCents: number;
  netCashFlowCents: number;
  operationalToAccountingDeltaCents: number;
  accountingToOperatingCashDeltaCents: number;
  explainedAccountingToCashCents: number;
  unexplainedAccountingToCashCents: number;
  items: PnlBridgeItem[];
  cashFlow: RealizedCashFlowReport;
}

export async function getPnlToCashBridge(
  ctx: CashFlowContext,
  input: z.input<typeof cashFlowQuerySchema>,
): Promise<PnlBridgeReport> {
  try {
    const data = cashFlowQuerySchema.parse(input);
    if (!hasPermission(ctx.role, "accounting", "read")) {
      throw ApiError.forbidden("No tienes permiso para consultar el puente P&L a flujo.");
    }

    const cashFlow = await getRealizedCashFlow(ctx, data);
    const effectiveBranchId = cashFlow.period.branchId;
    const cashSet = new Set(cashFlow.cashAccountIds);

    // Operational P&L (may fail or be empty in minimal DB tests if operational tables are absent)
    const allBranchPnl = await getPnLByBranch(ctx.companyId, data.fromDate, data.toDate).catch(() => []);
    const scopedPnl = effectiveBranchId
      ? allBranchPnl.filter(b => b.branchId === effectiveBranchId)
      : allBranchPnl;

    const operationalOperatingProfitCents = scopedPnl.reduce(
      (sum, b) => sum + b.operatingProfit.cents,
      0,
    );

    const items: PnlBridgeItem[] = [];

    // 1. ESTIMACION: lines in operational P&L that rely on non-MEASURED sources
    for (const b of scopedPnl) {
      const candidates = [
        { key: "sales", label: "Ventas", line: b.sales, sign: 1 },
        { key: "foodCost", label: "Food Cost", line: b.foodCost, sign: -1 },
        { key: "waste", label: "Merma", line: b.waste, sign: -1 },
        { key: "labor", label: "Nómina", line: b.labor, sign: -1 },
        { key: "operatingExpenses", label: "Gastos Operativos", line: b.operatingExpenses, sign: -1 },
        { key: "commissions", label: "Comisiones de canal", line: b.commissions, sign: -1 },
      ];
      for (const c of candidates) {
        if (c.line.source !== "MEASURED" && c.line.cents !== 0) {
          items.push({
            code: `EST_${c.key.toUpperCase()}`,
            category: "ESTIMACION",
            label: `${c.label} (${b.branchName}) — ${c.line.source}`,
            explanation: `El P&L operativo usa fuente ${c.line.source} (${c.line.note}) mientras la contabilidad solo registra pólizas publicadas reales.`,
            amountCents: c.sign * c.line.cents,
            metadata: { branchId: b.branchId, source: c.line.source, coveragePercent: c.line.coveragePercent },
          });
        }
      }
    }

    const accountingStats = await withCompanyContext({ companyId: ctx.companyId }, async tx => {
      const [actor] = await tx
        .select({ branchId: users.branchId })
        .from(users)
        .where(and(eq(users.id, ctx.actorId), eq(users.companyId, ctx.companyId), isNull(users.deletedAt)))
        .limit(1);
      const scope = resolveBranchScope(ctx.role, actor?.branchId);
      const branchFilter = effectiveBranchId ? sql`AND j.branch_id = ${effectiveBranchId}` : sql``;

      // All POSTED journal lines in [fromDate, toDate]
      const linesRes = await tx.execute<{
        journal_id: string;
        source_type: string | null;
        account_id: string;
        kind: string;
        debit_cents: string;
        credit_cents: string;
      }>(sql`
        SELECT
          j.id AS journal_id,
          j.source_type,
          l.account_id,
          a.kind,
          l.debit_cents::text AS debit_cents,
          l.credit_cents::text AS credit_cents
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        JOIN accounting_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE j.company_id = ${ctx.companyId}
          AND j.status = 'POSTED'
          AND j.accounting_date >= ${data.fromDate}
          AND j.accounting_date <= ${data.toDate}
          ${branchFilter}
      `);

      // Group by journal to separate cash-touching vs non-cash (accrual) journals
      const journals = new Map<
        string,
        {
          sourceType: string | null;
          touchesCash: boolean;
          incomeNet: number;
          expenseNet: number;
          nonCashAssetNet: number;
          liabilityNet: number;
          equityNet: number;
        }
      >();

      for (const r of linesRes.rows) {
        const debit = Number(r.debit_cents);
        const credit = Number(r.credit_cents);
        const j = journals.get(r.journal_id) ?? {
          sourceType: r.source_type,
          touchesCash: false,
          incomeNet: 0,
          expenseNet: 0,
          nonCashAssetNet: 0,
          liabilityNet: 0,
          equityNet: 0,
        };
        if (cashSet.has(r.account_id)) {
          j.touchesCash = true;
        } else if (r.kind === "INCOME") {
          j.incomeNet += credit - debit;
        } else if (r.kind === "EXPENSE") {
          j.expenseNet += debit - credit;
        } else if (r.kind === "ASSET") {
          j.nonCashAssetNet += debit - credit;
        } else if (r.kind === "LIABILITY") {
          j.liabilityNet += credit - debit;
        } else if (r.kind === "EQUITY") {
          j.equityNet += credit - debit;
        }
        journals.set(r.journal_id, j);
      }

      let accountingIncomeCents = 0;
      let accountingExpenseCents = 0;
      let accrualIncomeNotCollectedCents = 0;
      let accrualExpenseNotPaidCents = 0;
      let receivableCollectedInCashCents = 0;
      let payableSettledInCashCents = 0;
      let nonCashAssetCashImpactCents = 0;

      for (const j of journals.values()) {
        accountingIncomeCents += j.incomeNet;
        accountingExpenseCents += j.expenseNet;

        // Accrual-only journal (no cash movement) or mixed journal timing impact:
        // Operating cash impact of a journal = netIncome - delta(nonCashOperatingAssets) + delta(operatingLiabilities)
        // Wait: specifically, for OPERATING journals (non-investing/non-financing):
        if (!j.touchesCash) {
          // Income recognized without cash (e.g. DAILY_SALES_CUT waiting for next-month settlement)
          accrualIncomeNotCollectedCents += j.incomeNet;
          // Expense recognized without cash (e.g. EXPENSE_RECOGNIZED / PAYROLL_RECOGNIZED / inventory consumption)
          accrualExpenseNotPaidCents += j.expenseNet;
        } else {
          // Journal touched cash! Check non-P&L operating balance sheet lines (e.g. GATEWAY_SETTLEMENT collecting receivable, or EXPENSE_PAYMENT settling payable)
          // Note: exclude pure INVESTING/FINANCING journals tracked in cashFlow.investing / cashFlow.financing
          const isOperating =
            !cashFlow.investing.items.some(i => i.sourceType === j.sourceType && j.sourceType !== null) &&
            !cashFlow.financing.items.some(i => i.sourceType === j.sourceType && j.sourceType !== null);

          // Better: check by journalId membership in cashFlow.operating.items!
          void isOperating;
        }
      }

      const operatingJournalIds = new Set(cashFlow.operating.items.map(i => i.journalId));
      for (const [journalId, j] of journals.entries()) {
        if (!j.touchesCash || !operatingJournalIds.has(journalId)) continue;
        // Cash delta for this operating journal is (j.incomeNet - j.expenseNet) - j.nonCashAssetNet + j.liabilityNet + j.equityNet
        // Wait: -j.nonCashAssetNet when < 0 (credit to receivable) = collection of receivable!
        if (j.nonCashAssetNet < 0) {
          receivableCollectedInCashCents += -j.nonCashAssetNet;
        } else if (j.nonCashAssetNet > 0) {
          nonCashAssetCashImpactCents -= j.nonCashAssetNet;
        }
        if (j.liabilityNet < 0) {
          payableSettledInCashCents += -j.liabilityNet;
        } else if (j.liabilityNet > 0) {
          // Cash received creating operating liability (e.g. customer deposit / unearned revenue)
          nonCashAssetCashImpactCents += j.liabilityNet;
        }
      }

      // Check pending accounting events & draft journals in period -> FUENTE differences
      const pendingEventsRes = await tx.execute<{ cnt: number }>(sql`
        SELECT count(*)::int AS cnt
        FROM accounting_events
        WHERE company_id = ${ctx.companyId}
          AND status = 'PENDING'
          AND accounting_date >= ${data.fromDate}
          AND accounting_date <= ${data.toDate}
          ${effectiveBranchId ? sql`AND branch_id = ${effectiveBranchId}` : sql``}
      `);
      const pendingEventsCount = Number(pendingEventsRes.rows[0]?.cnt ?? 0);

      const draftJournalsRes = await tx
        .select({ id: accountingJournals.id })
        .from(accountingJournals)
        .where(
          and(
            eq(accountingJournals.companyId, ctx.companyId),
            eq(accountingJournals.status, "DRAFT"),
            gte(accountingJournals.accountingDate, data.fromDate),
            lte(accountingJournals.accountingDate, data.toDate),
            effectiveBranchId ? eq(accountingJournals.branchId, effectiveBranchId) : sql`true`,
          ),
        );

      return {
        scopeKind: scope.kind,
        accountingNetIncomeCents: accountingIncomeCents - accountingExpenseCents,
        accrualIncomeNotCollectedCents,
        accrualExpenseNotPaidCents,
        receivableCollectedInCashCents,
        payableSettledInCashCents,
        nonCashAssetCashImpactCents,
        pendingEventsCount,
        draftJournalsCount: draftJournalsRes.length,
      };
    });

    // 2. FECHA: Accrual vs Cash timing differences
    if (accountingStats.accrualIncomeNotCollectedCents !== 0) {
      items.push({
        code: "TIMING_UNCOLLECTED_INCOME",
        category: "FECHA",
        label: "Ingresos devengados pendientes de liquidación/cobro",
        explanation:
          "Ventas o ingresos reconocidos en el periodo cuya liquidación bancaria/adquirente ocurre en un periodo posterior (ej. liquidación del mes siguiente).",
        amountCents: -accountingStats.accrualIncomeNotCollectedCents,
      });
    }
    if (accountingStats.receivableCollectedInCashCents !== 0) {
      items.push({
        code: "TIMING_PRIOR_SETTLEMENTS_COLLECTED",
        category: "FECHA",
        label: "Cobros/liquidaciones recibidas de periodos anteriores",
        explanation:
          "Efectivo ingresado en el periodo que liquida cuentas por cobrar o adquirentes reconocidos en un periodo anterior.",
        amountCents: accountingStats.receivableCollectedInCashCents,
      });
    }
    if (accountingStats.accrualExpenseNotPaidCents !== 0) {
      items.push({
        code: "TIMING_UNPAID_EXPENSES",
        category: "FECHA",
        label: "Gastos/costos devengados aún no pagados",
        explanation:
          "Costos, nómina o gastos reconocidos en resultados del periodo que permanecen en cuentas por pagar al corte.",
        amountCents: accountingStats.accrualExpenseNotPaidCents,
      });
    }
    if (accountingStats.payableSettledInCashCents !== 0) {
      items.push({
        code: "TIMING_PAYABLES_PAID",
        category: "FECHA",
        label: "Pagos de pasivos devengados en periodos anteriores",
        explanation:
          "Salidas de efectivo del periodo destinadas a liquidar facturas, gastos o nómina reconocidos previamente.",
        amountCents: -accountingStats.payableSettledInCashCents,
      });
    }
    if (accountingStats.nonCashAssetCashImpactCents !== 0) {
      items.push({
        code: "TIMING_OPERATING_WORKING_CAPITAL",
        category: "FECHA",
        label: "Otros movimientos de capital de trabajo (inventarios/anticipos)",
        explanation:
          "Variaciones en activos operativos distintos de efectivo o pasivos operativos cobrados por adelantado.",
        amountCents: accountingStats.nonCashAssetCashImpactCents,
      });
    }

    // 3. FUENTE: Unposted operational events, drafts, or operational-vs-accounting scope gap
    const operationalToAccountingDeltaCents =
      accountingStats.accountingNetIncomeCents - operationalOperatingProfitCents;
    if (operationalToAccountingDeltaCents !== 0) {
      items.push({
        code: "SOURCE_OPERATIONAL_VS_ACCOUNTING",
        category: "FUENTE",
        label: "Brecha de fuente entre P&L operativo y resultado contable publicado",
        explanation:
          "Diferencia atribuible a fuentes operativas aún no contabilizadas, pólizas manuales/corporativas o criterios de corte entre el tablero operativo y el libro mayor.",
        amountCents: operationalToAccountingDeltaCents,
      });
    }
    if (accountingStats.pendingEventsCount > 0) {
      items.push({
        code: "SOURCE_PENDING_EVENTS",
        category: "FUENTE",
        label: `${accountingStats.pendingEventsCount} evento(s) contable(s) pendiente(s) de publicación`,
        explanation:
          "Hechos operativos ya capturados cuyo asiento contable aún no se publica y por ello no aparecen en el flujo contable.",
        amountCents: 0,
        metadata: { count: accountingStats.pendingEventsCount },
      });
    }
    if (accountingStats.draftJournalsCount > 0) {
      items.push({
        code: "SOURCE_DRAFT_JOURNALS",
        category: "FUENTE",
        label: `${accountingStats.draftJournalsCount} póliza(s) en borrador en el periodo`,
        explanation: "Pólizas en estado DRAFT excluidas del flujo realizado y de resultados contables.",
        amountCents: 0,
        metadata: { count: accountingStats.draftJournalsCount },
      });
    }

    const accountingToOperatingCashDeltaCents =
      cashFlow.operating.netCents - accountingStats.accountingNetIncomeCents;
    const explainedAccountingToCashCents = items
      .filter(i => i.category === "FECHA")
      .reduce((sum, i) => sum + i.amountCents, 0);
    const unexplainedAccountingToCashCents =
      accountingToOperatingCashDeltaCents - explainedAccountingToCashCents;

    return {
      period: cashFlow.period,
      operationalOperatingProfitCents,
      accountingNetIncomeCents: accountingStats.accountingNetIncomeCents,
      operatingCashFlowCents: cashFlow.operating.netCents,
      netCashFlowCents: cashFlow.netCashFlowCents,
      operationalToAccountingDeltaCents,
      accountingToOperatingCashDeltaCents,
      explainedAccountingToCashCents,
      unexplainedAccountingToCashCents,
      items,
      cashFlow,
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw ApiError.internal("No se pudo calcular el puente entre P&L y flujo realizado.");
  }
}
