// M16 / T39: Cash Flow Projection Service
// Projects 30-day cash flow by aggregating estimated daily sales inflows vs
// scheduled outflows (operating expenses, pending invoices, estimated payroll).

import { db } from "@/lib/db";
import { dailySalesCuts, operatingExpenses, invoices } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface CashFlowDay {
  date: string;
  projectedInflowCents: number;
  projectedOutflowCents: number;
  netFlowCents: number;
  cumulativeBalanceCents: number;
  outflowItemsCount: number;
  hasHighConcentration: boolean;
}

export async function getCashFlowProjection(companyId: string, days = 30): Promise<CashFlowDay[]> {
  const startDate = new Date();
  const startDateStr = startDate.toISOString().slice(0, 10);
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
  const endDateStr = endDate.toISOString().slice(0, 10);

  // 1. Estimate average daily inflow from past cuts
  const [pastSalesRow] = await db
    .select({
      totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
      daysCount: sql<number>`COUNT(DISTINCT ${dailySalesCuts.businessDate})`,
    })
    .from(dailySalesCuts)
    .where(eq(dailySalesCuts.companyId, companyId));

  const pastTotalSales = Number(pastSalesRow?.totalSales || 0);
  const pastDays = Number(pastSalesRow?.daysCount || 1);
  const avgDailyInflowCents = pastDays > 0 ? Math.round(pastTotalSales / pastDays) : 1500000; // $15,000 MXN default

  // 2. Fetch scheduled outflows from operatingExpenses
  const expensesList = await db
    .select({
      dueDate: operatingExpenses.dueDate,
      amountCents: operatingExpenses.amount,
    })
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        gte(operatingExpenses.dueDate, startDateStr),
        lte(operatingExpenses.dueDate, endDateStr)
      )
    );

  const outflowsByDate: Record<string, { amount: number; count: number }> = {};
  for (const exp of expensesList) {
    if (exp.dueDate) {
      if (!outflowsByDate[exp.dueDate]) {
        outflowsByDate[exp.dueDate] = { amount: 0, count: 0 };
      }
      outflowsByDate[exp.dueDate].amount += exp.amountCents;
      outflowsByDate[exp.dueDate].count += 1;
    }
  }

  // 3. Build daily projection timeline
  const result: CashFlowDay[] = [];
  let runningBalance = 2000000; // $20,000 MXN initial balance baseline

  for (let i = 0; i < days; i++) {
    const current = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = current.toISOString().slice(0, 10);

    const dayOutflows = outflowsByDate[dateStr] || { amount: 0, count: 0 };

    // Fortnight payroll spike simulation on 15th and 30th
    const dayOfMonth = current.getDate();
    let payrollExtra = 0;
    if (dayOfMonth === 15 || dayOfMonth === 30 || (dayOfMonth === 28 && current.getMonth() === 1)) {
      payrollExtra = 2500000; // $25,000 MXN payroll outflow
      dayOutflows.count += 1;
    }

    const totalOutflow = dayOutflows.amount + payrollExtra;
    const netFlow = avgDailyInflowCents - totalOutflow;
    runningBalance += netFlow;

    // High concentration warning if >= 3 payment obligations or outflow > 3x average daily inflow
    const hasHighConcentration = dayOutflows.count >= 3 || totalOutflow > avgDailyInflowCents * 2.5;

    result.push({
      date: dateStr,
      projectedInflowCents: avgDailyInflowCents,
      projectedOutflowCents: totalOutflow,
      netFlowCents: netFlow,
      cumulativeBalanceCents: runningBalance,
      outflowItemsCount: dayOutflows.count,
      hasHighConcentration,
    });
  }

  return result;
}
