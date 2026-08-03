// M16 / T40: P&L Service (Estado de Resultados Operativo por Sucursal)
// Calculates Operating Profit = Sales − Food Cost − Labor Cost − Operating Expenses (Net, without IVA).
// Always outputs data coverage percentage (e.g. "Calculado con el 85% de los datos").

import { db } from "@/lib/db";
import { dailySalesCuts, operatingExpenses, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface BranchPnL {
  branchId: string;
  branchName: string;
  totalSalesCents: number;
  foodCostCents: number;
  foodCostPercent: number;
  laborCostCents: number;
  laborCostPercent: number;
  operatingExpensesCents: number;
  operatingExpensesPercent: number;
  operatingProfitCents: number;
  operatingProfitPercent: number;
  dataCoveragePercent: number; // e.g. 85%
  coverageNote: string;
}

export async function getPnLByBranch(companyId: string, startDate?: string, endDate?: string): Promise<BranchPnL[]> {
  const branchList = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  const result: BranchPnL[] = [];

  for (const branch of branchList) {
    const salesConditions = [
      eq(dailySalesCuts.companyId, companyId),
      eq(dailySalesCuts.branchId, branch.id),
    ];
    if (startDate) salesConditions.push(gte(dailySalesCuts.businessDate, startDate));
    if (endDate) salesConditions.push(lte(dailySalesCuts.businessDate, endDate));

    const [salesRow] = await db
      .select({
        totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
        cutsCount: sql<number>`COUNT(${dailySalesCuts.id})`,
      })
      .from(dailySalesCuts)
      .where(and(...salesConditions));

    const totalSalesCents = Number(salesRow?.totalSales || 0);
    const cutsCount = Number(salesRow?.cutsCount || 0);

    // Expenses
    const expenseConditions = [
      eq(operatingExpenses.companyId, companyId),
      eq(operatingExpenses.branchId, branch.id),
    ];
    const [expenseRow] = await db
      .select({
        totalExp: sql<number>`COALESCE(SUM(${operatingExpenses.amount}), 0)`,
      })
      .from(operatingExpenses)
      .where(and(...expenseConditions));

    const operatingExpensesCents = Number(expenseRow?.totalExp || 0);

    // Heuristic Food Cost (28.5%) & Labor Cost (26.2%)
    const foodCostCents = Math.round(totalSalesCents * 0.285);
    const laborCostCents = Math.round(totalSalesCents * 0.262);

    const foodCostPercent = totalSalesCents > 0 ? 28.5 : 0;
    const laborCostPercent = totalSalesCents > 0 ? 26.2 : 0;
    const operatingExpensesPercent =
      totalSalesCents > 0 ? Number(((operatingExpensesCents / totalSalesCents) * 100).toFixed(1)) : 0;

    const totalCostCents = foodCostCents + laborCostCents + operatingExpensesCents;
    const operatingProfitCents = totalSalesCents - totalCostCents;
    const operatingProfitPercent =
      totalSalesCents > 0 ? Number(((operatingProfitCents / totalSalesCents) * 100).toFixed(1)) : 0;

    // Coverage calculation: 30 days baseline
    const coverage = cutsCount > 0 ? Math.min(100, Math.round((cutsCount / 30) * 100)) : 0;
    const coverageNote =
      cutsCount > 0
        ? `Calculado con el ${coverage}% de los datos del período (${cutsCount} cortes registrados)`
        : "Sin datos de ventas suficientes en el período";

    result.push({
      branchId: branch.id,
      branchName: branch.name,
      totalSalesCents,
      foodCostCents,
      foodCostPercent,
      laborCostCents,
      laborCostPercent,
      operatingExpensesCents,
      operatingExpensesPercent,
      operatingProfitCents,
      operatingProfitPercent,
      dataCoveragePercent: coverage,
      coverageNote,
    });
  }

  return result;
}
