/**
 * NOM-02.d3 — Préstamos y descuentos autorizados en nómina (LFT Art. 110).
 *
 * Garantías:
 * - Solo préstamos/descuentos con `status === "ACTIVE"` y `remainingBalanceCents > 0`
 *   generan cuota; pausados, liquidados o cancelados nunca cobran.
 * - Límite legal (LFT Art. 110 fr. I): para préstamos/anticipos de empresa, el descuento
 *   no puede exceder `maxDeductionPct` (default 30%) del excedente del salario mínimo
 *   del período, ni superar el `remainingBalanceCents`.
 * - Idempotencia por período: si ya existe una cuota `APPLIED` para el mismo
 *   `(loanId, periodStart, periodEnd)`, repetir el período NO cobra dos veces
 *   (ni descuenta el saldo de nuevo).
 * - Trazabilidad: cada aplicación registra `balanceBeforeCents`, `balanceAfterCents`,
 *   `scheduledCents`, `appliedCents` y si fue recortada por tope legal o saldo restante.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollLoanInstallments, payrollLoans } from "@/lib/db/schema";

export type PayrollLoanType =
  | "COMPANY_LOAN"
  | "SALARY_ADVANCE"
  | "INFONAVIT"
  | "FONACOT"
  | "ALIMONY"
  | "OTHER_AUTHORIZED";

export type PayrollLoanStatus = "ACTIVE" | "PAUSED" | "PAID_OFF" | "CANCELLED";

export interface PayrollLoanRecord {
  id: string;
  companyId: string;
  userId: string;
  loanType: PayrollLoanType;
  satDeductionCode: string;
  conceptName: string;
  principalCents: number;
  remainingBalanceCents: number;
  installmentCents: number;
  /** Porcentaje máximo legal sobre el excedente del salario mínimo (LFT Art. 110 fr. I: 30%). */
  maxDeductionPct: number;
  status: PayrollLoanStatus;
  authorizedBy: string;
  authorizedAt: Date | string;
  reason: string;
  cancelledBy?: string | null;
  cancelledAt?: Date | string | null;
  cancelReason?: string | null;
}

export interface PayrollLoanInstallmentRecord {
  id?: string;
  companyId: string;
  loanId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  runId?: string | null;
  scheduledCents: number;
  appliedCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  status: "APPLIED" | "ADJUSTED" | "REVERSED";
}

export interface PlannedLoanDeduction {
  loanId: string;
  loanType: PayrollLoanType;
  satDeductionCode: string;
  conceptName: string;
  scheduledCents: number;
  appliedCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  cappedByLegalLimit: boolean;
  cappedByBalance: boolean;
  alreadyAppliedInPeriod: boolean;
}

export interface PayrollLoansBreakdown {
  status: "AVAILABLE" | "QUERY_ERROR";
  totalLoanDeductionsCents: number;
  legalExcessCapCents: number;
  activeLoansCount: number;
  skippedAlreadyChargedCount: number;
  deductions: PlannedLoanDeduction[];
}

export function planPayrollLoanDeductions(options: {
  loans: readonly PayrollLoanRecord[];
  existingInstallments: readonly PayrollLoanInstallmentRecord[];
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  /** Percepciones base del período en centavos (para tope LFT Art. 110 fr. I). */
  periodGrossPayCents: number;
  /** Salario mínimo diario vigente de la zona × días pagaderos del período. */
  periodMinimumWageCents: number;
}): PayrollLoansBreakdown {
  const {
    loans,
    existingInstallments,
    companyId,
    userId,
    periodStart,
    periodEnd,
    periodGrossPayCents,
    periodMinimumWageCents,
  } = options;

  const scopedLoans = loans
    .filter((l) => l.companyId === companyId && l.userId === userId)
    .sort((a, b) => a.id.localeCompare(b.id));

  const appliedLoanIdsInPeriod = new Set<string>();
  for (const inst of existingInstallments) {
    if (
      inst.companyId === companyId &&
      inst.userId === userId &&
      inst.periodStart.slice(0, 10) === periodStart &&
      inst.periodEnd.slice(0, 10) === periodEnd &&
      inst.status === "APPLIED"
    ) {
      appliedLoanIdsInPeriod.add(inst.loanId);
    }
  }

  const excessOverMinWageCents = Math.max(0, periodGrossPayCents - periodMinimumWageCents);
  // Tope base del 30% sobre excedente del salario mínimo (LFT Art. 110 fr. I)
  const legalExcessCapCents = Math.round((excessOverMinWageCents * 30) / 100);
  let remainingLegalCapCents = legalExcessCapCents;

  let totalLoanDeductionsCents = 0;
  let activeLoansCount = 0;
  let skippedAlreadyChargedCount = 0;
  const deductions: PlannedLoanDeduction[] = [];

  for (const loan of scopedLoans) {
    if (loan.status !== "ACTIVE" || loan.remainingBalanceCents <= 0) {
      continue;
    }
    activeLoansCount++;

    if (appliedLoanIdsInPeriod.has(loan.id)) {
      skippedAlreadyChargedCount++;
      deductions.push({
        loanId: loan.id,
        loanType: loan.loanType,
        satDeductionCode: loan.satDeductionCode,
        conceptName: loan.conceptName,
        scheduledCents: loan.installmentCents,
        appliedCents: 0,
        balanceBeforeCents: loan.remainingBalanceCents,
        balanceAfterCents: loan.remainingBalanceCents,
        cappedByLegalLimit: false,
        cappedByBalance: false,
        alreadyAppliedInPeriod: true,
      });
      continue;
    }

    const scheduledCents = Math.max(0, loan.installmentCents);
    let appliedCents = Math.min(scheduledCents, loan.remainingBalanceCents);
    const cappedByBalance = appliedCents < scheduledCents;
    let cappedByLegalLimit = false;

    // LFT Art. 110 fr. I aplica tope del 30% del excedente del salario mínimo a préstamos/anticipos de empresa
    const subjectToArt110Cap =
      loan.loanType === "COMPANY_LOAN" ||
      loan.loanType === "SALARY_ADVANCE" ||
      loan.loanType === "OTHER_AUTHORIZED";

    if (subjectToArt110Cap) {
      const pct = Math.min(100, Math.max(0, loan.maxDeductionPct ?? 30));
      const loanMaxCents = Math.min(
        remainingLegalCapCents,
        Math.round((excessOverMinWageCents * pct) / 100)
      );
      if (appliedCents > loanMaxCents) {
        appliedCents = Math.max(0, loanMaxCents);
        cappedByLegalLimit = true;
      }
      remainingLegalCapCents = Math.max(0, remainingLegalCapCents - appliedCents);
    }

    const balanceBeforeCents = loan.remainingBalanceCents;
    const balanceAfterCents = Math.max(0, balanceBeforeCents - appliedCents);
    totalLoanDeductionsCents += appliedCents;

    deductions.push({
      loanId: loan.id,
      loanType: loan.loanType,
      satDeductionCode: loan.satDeductionCode,
      conceptName: loan.conceptName,
      scheduledCents,
      appliedCents,
      balanceBeforeCents,
      balanceAfterCents,
      cappedByLegalLimit,
      cappedByBalance,
      alreadyAppliedInPeriod: false,
    });
  }

  return {
    status: "AVAILABLE",
    totalLoanDeductionsCents,
    legalExcessCapCents,
    activeLoansCount,
    skippedAlreadyChargedCount,
    deductions,
  };
}

export async function resolvePayrollLoansForPeriod(input: {
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  periodGrossPayCents: number;
  periodMinimumWageCents: number;
  preloadedLoans?: readonly PayrollLoanRecord[];
  preloadedInstallments?: readonly PayrollLoanInstallmentRecord[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance?: any;
}): Promise<PayrollLoansBreakdown> {
  if (input.preloadedLoans !== undefined) {
    return planPayrollLoanDeductions({
      loans: input.preloadedLoans,
      existingInstallments: input.preloadedInstallments ?? [],
      companyId: input.companyId,
      userId: input.userId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      periodGrossPayCents: input.periodGrossPayCents,
      periodMinimumWageCents: input.periodMinimumWageCents,
    });
  }

  const dbInstance = input.dbInstance ?? db;
  try {
    const [loanRows, instRows] = await Promise.all([
      dbInstance
        .select()
        .from(payrollLoans)
        .where(
          and(
            eq(payrollLoans.companyId, input.companyId),
            eq(payrollLoans.userId, input.userId)
          )
        ),
      dbInstance
        .select()
        .from(payrollLoanInstallments)
        .where(
          and(
            eq(payrollLoanInstallments.companyId, input.companyId),
            eq(payrollLoanInstallments.userId, input.userId),
            eq(payrollLoanInstallments.periodStart, input.periodStart),
            eq(payrollLoanInstallments.periodEnd, input.periodEnd)
          )
        ),
    ]);

    return planPayrollLoanDeductions({
      loans: loanRows as PayrollLoanRecord[],
      existingInstallments: instRows as PayrollLoanInstallmentRecord[],
      companyId: input.companyId,
      userId: input.userId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      periodGrossPayCents: input.periodGrossPayCents,
      periodMinimumWageCents: input.periodMinimumWageCents,
    });
  } catch {
    return {
      status: "QUERY_ERROR",
      totalLoanDeductionsCents: 0,
      legalExcessCapCents: 0,
      activeLoansCount: 0,
      skippedAlreadyChargedCount: 0,
      deductions: [],
    };
  }
}
