/**
 * EXC-04.presupuesto — Adaptador de excepciones de gasto fuera de presupuesto
 * (`operating_expenses.status = 'PENDING_OVERBUDGET_APPROVAL'` → `exceptions`).
 *
 * - Idempotente por `(companyId, 'budget_overrun', expense.id)`.
 * - Conserva `ruleSnapshot` y `ownerId` originales si ya fueron registrados en
 *   la detección inicial del gasto.
 * - Autorreconcilia gastos ya `APPROVED`/`REJECTED` que sigan con excepción
 *   abierta sin duplicar ni reabrir excepciones terminales.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { operatingExpenses } from "@/lib/db/schema";
import { checkBudgetAvailability } from "../budget-service";
import { allowedEvents, isTerminal } from "../exception-lifecycle";
import { ExceptionService } from "../exception-service";
import {
  BUDGET_OVERRUN_MIN_ROLE,
  BUDGET_OVERRUN_SUBJECT_TYPE,
  evaluateOverbudgetRule,
} from "../budget-exception-rules";
import { raiseBudgetOverrunException } from "../budget-exception-service";
import type { AdapterScope, ExceptionAdapter } from "./types";

function expenseMonth(businessDate: string | null, createdAt: Date | null): string {
  if (businessDate && businessDate.length >= 7) {
    return businessDate.slice(0, 7);
  }
  const date = createdAt instanceof Date ? createdAt : new Date();
  return date.toISOString().slice(0, 7);
}

export const budgetOverrunAdapter: ExceptionAdapter = {
  subjectType: BUDGET_OVERRUN_SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const overbudgetRows = await db
      .select({
        id: operatingExpenses.id,
        branchId: operatingExpenses.branchId,
        costCenterId: operatingExpenses.costCenterId,
        category: operatingExpenses.category,
        amount: operatingExpenses.amount,
        description: operatingExpenses.description,
        status: operatingExpenses.status,
        requestedBy: operatingExpenses.requestedBy,
        businessDate: operatingExpenses.businessDate,
        createdAt: operatingExpenses.createdAt,
      })
      .from(operatingExpenses)
      .where(
        and(
          eq(operatingExpenses.companyId, companyId),
          eq(operatingExpenses.status, "PENDING_OVERBUDGET_APPROVAL"),
          branchId ? eq(operatingExpenses.branchId, branchId) : undefined,
        ),
      );

    let raised = 0;
    for (const r of overbudgetRows) {
      const month = expenseMonth(r.businessDate ?? null, r.createdAt ?? null);
      const existing = await ExceptionService.getBySubject(
        companyId,
        BUDGET_OVERRUN_SUBJECT_TYPE,
        r.id,
      );

      if (existing && isTerminal(existing.status)) {
        continue;
      }

      let budgetedCents: number | null = null;
      let committedBeforeCents = 0;
      if (r.costCenterId) {
        const avail = await checkBudgetAvailability(
          r.branchId,
          r.costCenterId,
          month,
          0,
        );
        budgetedCents = avail.budgeted > 0 ? avail.budgeted : null;
        committedBeforeCents = Math.max(0, avail.committed - r.amount);
      }

      const evaluation = evaluateOverbudgetRule({
        budgetedCents,
        committedBeforeCents,
        expenseAmountCents: r.amount,
        month,
        costCenterId: r.costCenterId,
        amountRuleRole: BUDGET_OVERRUN_MIN_ROLE,
      });

      // Si el gasto está marcado explícitamente PENDING_OVERBUDGET_APPROVAL pero
      // la partida cambió después, se conserva al menos la regla mínima para no
      // perder visibilidad en el tablero de control.
      const effectiveEvaluation = evaluation.isOverbudget
        ? evaluation
        : {
            ...evaluation,
            isOverbudget: true,
            severity: "high" as const,
            requiredApproverRole: BUDGET_OVERRUN_MIN_ROLE,
            ruleSnapshot: r.costCenterId
              ? {
                  ruleCode: "BUDGET_EXCEEDED_100_PCT" as const,
                  thresholdPercent: 100 as const,
                  month,
                  costCenterId: r.costCenterId,
                  costCenterCode: null,
                  costCenterName: null,
                  budgetedCents: evaluation.budgetedCents,
                  committedBeforeCents,
                  expenseAmountCents: r.amount,
                  committedAfterCents: committedBeforeCents + r.amount,
                  overByCents: Math.max(0, committedBeforeCents + r.amount - evaluation.budgetedCents),
                  consumedPercent: evaluation.consumedPercent ?? 100,
                  requiredApproverRole: BUDGET_OVERRUN_MIN_ROLE,
                  baseAmountRuleRole: BUDGET_OVERRUN_MIN_ROLE,
                  baseAmountRuleId: null,
                }
              : null,
          };

      await raiseBudgetOverrunException({
        companyId,
        branchId: r.branchId,
        expenseId: r.id,
        category: r.category,
        description: r.description,
        amountCents: r.amount,
        requestedBy: r.requestedBy,
        sourceStatus: r.status,
        evaluation: effectiveEvaluation,
        costCenterId: r.costCenterId,
      });
      raised++;
    }

    // Autorreconciliación: gastos ya resueltos (APPROVED/REJECTED/PAID) que aún
    // tuvieran una excepción abierta se cancelan sin duplicar.
    const resolvedRows = await db
      .select({
        id: operatingExpenses.id,
        status: operatingExpenses.status,
      })
      .from(operatingExpenses)
      .where(
        and(
          eq(operatingExpenses.companyId, companyId),
          inArray(operatingExpenses.status, ["APPROVED", "REJECTED", "PAID"]),
          branchId ? eq(operatingExpenses.branchId, branchId) : undefined,
        ),
      );

    for (const r of resolvedRows) {
      const existing = await ExceptionService.getBySubject(
        companyId,
        BUDGET_OVERRUN_SUBJECT_TYPE,
        r.id,
      );
      if (!existing || isTerminal(existing.status)) continue;
      if (!allowedEvents(existing.status).includes("CANCEL")) continue;
      await ExceptionService.cancel(
        existing.id,
        companyId,
        null,
        `Gasto fuera de presupuesto ya resuelto en estado ${r.status}.`,
        db,
        { expectedStatus: existing.status },
      ).catch(() => {
        /* ya resuelto/cerrado concurrentemente */
      });
    }

    return raised;
  },
};
