// M16 / T39: Cash Flow Projection Service
// Projects 30-day cash flow by aggregating:
//   - Estimated daily sales inflows
//   - Operating expenses (rent, services, maintenance, etc.)
//   - Purchase orders committed (APPROVED, SENT, PARTIALLY_RECEIVED)
//   - Invoices from procurement (CFDI XML received but not linked to a paid expense)

import { db } from "@/lib/db";
import { dailySalesCuts, operatingExpenses, invoices, purchaseOrders, suppliers, employeeContracts, users, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, or, inArray, asc } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────

export interface CashFlowDay {
  date: string;
  projectedInflowCents: number;
  projectedOutflowCents: number;
  netFlowCents: number;
  cumulativeBalanceCents: number;
  outflowItemsCount: number;
  hasHighConcentration: boolean;
}

export interface OutflowItem {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  status: string;
  isPayroll: boolean;
  /** Fuente del egreso para distinguir origen en el UI */
  source: "OPERATING_EXPENSE" | "PURCHASE_ORDER" | "PROCUREMENT_INVOICE";
  /** Nombre del proveedor (solo para PO y procurement invoices) */
  supplierName?: string;
}

export interface CategorySummary {
  category: string;
  amountCents: number;
  count: number;
  percentage: number;
}

export interface WeeklyAggregation {
  weekLabel: string;
  startDate: string;
  endDate: string;
  totalOutflowCents: number;
  itemCount: number;
  isHeavy: boolean;
}

export interface CashFlowProjection {
  days: CashFlowDay[];
  outflowItems: OutflowItem[];
  categorySummary: CategorySummary[];
  weeklyAggregation: WeeklyAggregation[];
  overdueItems: OutflowItem[];
  upcomingItems: OutflowItem[];
  initialBalanceCents: number;
  /** PO + facturas comprometidas incluidas en la proyección */
  procurementCommitments: {
    purchaseOrdersCount: number;
    purchaseOrdersTotalCents: number;
    invoicesCount: number;
    invoicesTotalCents: number;
  };
  /** Nómina real estimada desde contratos activos */
  payroll: {
    activeEmployees: number;
    monthlyTotalCents: number;
    biweeklyEstimateCents: number;
    /** Sucursales incluidas en el cálculo */
    branchCount: number;
  } | null;
}

// ── Constants ────────────────────────────────────────────────────

const INITIAL_BALANCE = 2000000; // $20,000 MXN baseline
const PO_COMMITTED_STATUSES = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] as const;

// ── Main function ────────────────────────────────────────────────

export async function getCashFlowProjection(
  companyId: string,
  days = 30
): Promise<CashFlowProjection> {
  const startDate = new Date();
  const startDateStr = startDate.toISOString().slice(0, 10);
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
  const endDateStr = endDate.toISOString().slice(0, 10);

  // ── 1. Estimate average daily inflow from past cuts ─────────────
  const [pastSalesRow] = await db
    .select({
      totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
      daysCount: sql<number>`COUNT(DISTINCT ${dailySalesCuts.businessDate})`,
    })
    .from(dailySalesCuts)
    .where(eq(dailySalesCuts.companyId, companyId));

  const pastTotalSales = Number(pastSalesRow?.totalSales || 0);
  const pastDays = Number(pastSalesRow?.daysCount || 1);
  const avgDailyInflowCents =
    pastDays > 0 ? Math.round(pastTotalSales / pastDays) : 1500000;

  // ── 2. Operating expenses (scheduled) ──────────────────────────
  const opExList = await db
    .select({
      id: operatingExpenses.id,
      dueDate: operatingExpenses.dueDate,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      category: operatingExpenses.category,
      status: operatingExpenses.status,
    })
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        gte(operatingExpenses.dueDate, startDateStr),
        lte(operatingExpenses.dueDate, endDateStr)
      )
    )
    .orderBy(asc(operatingExpenses.dueDate));

  // ── 3. Overdue operating expenses ──────────────────────────────
  const overdueOpEx = await db
    .select({
      id: operatingExpenses.id,
      dueDate: operatingExpenses.dueDate,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      category: operatingExpenses.category,
      status: operatingExpenses.status,
    })
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        sql`${operatingExpenses.dueDate} < ${startDateStr}`,
        sql`${operatingExpenses.status} != 'PAID'`
      )
    )
    .orderBy(asc(operatingExpenses.dueDate));

  // ── 4. Purchase Orders committed (APPROVED, SENT, PARTIALLY_RECEIVED) ──
  const poRows = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
      dateRequired: purchaseOrders.dateRequired,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        inArray(purchaseOrders.status, PO_COMMITTED_STATUSES as any),
        sql`${purchaseOrders.totalAmount} > 0`
      )
    )
    .orderBy(asc(purchaseOrders.expectedDeliveryDate));

  // ── 5. Procurement invoices (CFDI received, not yet linked to a paid expense) ──
  const invRows = await db
    .select({
      id: invoices.id,
      folio: invoices.folio,
      total: invoices.total,
      fecha: invoices.fecha,
      nombreEmisor: invoices.nombreEmisor,
      supplierName: suppliers.name,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(
      and(
        eq(invoices.companyId, companyId)
        // Include all invoices regardless of match status
        // They represent real liabilities once the CFDI is received
      )
    );

  // ── 6. Real payroll from active employee contracts ────────────
  const activeEmployees = await db
    .select({
      userId: employeeContracts.userId,
      monthlySalary: employeeContracts.monthlySalary,
      baseSalary: employeeContracts.baseSalary,
      branchId: users.branchId,
    })
    .from(employeeContracts)
    .innerJoin(users, eq(employeeContracts.userId, users.id))
    .where(
      and(
        eq(users.companyId, companyId),
        eq(employeeContracts.status, "ACTIVE")
      )
    );

  const activeCount = activeEmployees.length;
  const monthlyTotalCents = activeEmployees.reduce(
    (sum, e) => sum + (e.monthlySalary || (e.baseSalary || 0) * 30),
    0
  );
  const biweeklyPayrollCents = Math.round(monthlyTotalCents / 2);
  const payrollBranchSet = new Set(activeEmployees.map((e) => e.branchId).filter(Boolean));

  const payrollData = activeCount > 0 ? {
    activeEmployees: activeCount,
    monthlyTotalCents,
    biweeklyEstimateCents: biweeklyPayrollCents,
    branchCount: payrollBranchSet.size || 1,
  } : null;

  // ── 7. Build outflow items + by-date map ───────────────────────
  const allOutflowItems: OutflowItem[] = [];
  const outflowsByDate: Record<string, { amount: number; count: number; items: OutflowItem[] }> = {};

  const addItem = (item: OutflowItem) => {
    allOutflowItems.push(item);
    if (!outflowsByDate[item.date]) {
      outflowsByDate[item.date] = { amount: 0, count: 0, items: [] };
    }
    outflowsByDate[item.date].amount += item.amountCents;
    outflowsByDate[item.date].count += 1;
    outflowsByDate[item.date].items.push(item);
  };

  // 6a. Operating expenses
  for (const exp of opExList) {
    if (exp.dueDate) {
      addItem({
        id: exp.id,
        date: exp.dueDate,
        description: exp.description,
        amountCents: exp.amountCents,
        category: exp.category,
        status: exp.status,
        isPayroll: false,
        source: "OPERATING_EXPENSE",
      });
    }
  }

  // 6b. Purchase Orders → estimate outflow on expectedDeliveryDate or dateRequired
  for (const po of poRows) {
    // Use expectedDeliveryDate as proxy for payment date (typically 7-30 days after delivery)
    // Fallback to dateRequired, then to today + 14 days
    let poDate = po.expectedDeliveryDate
      ? new Date(po.expectedDeliveryDate).toISOString().slice(0, 10)
      : po.dateRequired
        ? new Date(po.dateRequired).toISOString().slice(0, 10)
        : null;

    // If no date or date is in the past, estimate 14 days from now
    if (!poDate || poDate < startDateStr) {
      const estimated = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
      poDate = estimated.toISOString().slice(0, 10);
    }

    // Only include if within the projection window
    if (poDate >= startDateStr && poDate <= endDateStr) {
      const supplierLabel = po.supplierName || "Proveedor";
      addItem({
        id: po.id,
        date: poDate,
        description: `OC ${po.poNumber} — ${supplierLabel}`,
        amountCents: po.totalAmount || 0,
        category: "COMPRAS",
        status: po.status,
        isPayroll: false,
        source: "PURCHASE_ORDER",
        supplierName: po.supplierName || undefined,
      });
    }
  }

  // 6c. Procurement invoices
  for (const inv of invRows) {
    // The invoice `fecha` field is the CFDI emission date in "YYYY-MM-DD" format
    // Payment is typically due 15-30 days after emission
    const invDate = inv.fecha;
    if (invDate && invDate >= startDateStr && invDate <= endDateStr) {
      const emitterLabel = inv.nombreEmisor || inv.supplierName || "Proveedor";
      addItem({
        id: inv.id,
        date: invDate,
        description: `Factura ${inv.folio || "S/N"} — ${emitterLabel}`,
        amountCents: inv.total,
        category: "COMPRAS",
        status: "RECIBIDA",
        isPayroll: false,
        source: "PROCUREMENT_INVOICE",
        supplierName: inv.nombreEmisor || inv.supplierName || undefined,
      });
    }
  }

  // ── 7. Overdue items (OpEx vencidos) ──────────────────────────
  const overdueItems: OutflowItem[] = overdueOpEx.map((exp) => ({
    id: exp.id,
    date: exp.dueDate || "",
    description: exp.description,
    amountCents: exp.amountCents,
    category: exp.category,
    status: exp.status,
    isPayroll: false,
    source: "OPERATING_EXPENSE" as const,
  }));

  // ── 8. Build daily projection timeline ─────────────────────────
  const projectionDays: CashFlowDay[] = [];
  let runningBalance = INITIAL_BALANCE;

  for (let i = 0; i < days; i++) {
    const current = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = current.toISOString().slice(0, 10);

    const dayOutflows = outflowsByDate[dateStr] || { amount: 0, count: 0, items: [] };

    // Real payroll on 15th and 30th (from employee contracts, not hardcoded)
    const dayOfMonth = current.getDate();
    let payrollExtra = 0;
    const isPayrollDay =
      dayOfMonth === 15 ||
      dayOfMonth === 30 ||
      (dayOfMonth === 28 && current.getMonth() === 1); // Feb
    if (isPayrollDay && biweeklyPayrollCents > 0) {
      payrollExtra = biweeklyPayrollCents;
      dayOutflows.count += 1;
      addItem({
        id: `payroll-${dateStr}`,
        date: dateStr,
        description: `Nómina quincenal (${activeCount} empleados)`,
        amountCents: payrollExtra,
        category: "NOMINA",
        status: "PROGRAMADO",
        isPayroll: true,
        source: "OPERATING_EXPENSE",
      });
    }

    const totalOutflow = dayOutflows.amount + payrollExtra;
    const netFlow = avgDailyInflowCents - totalOutflow;
    runningBalance += netFlow;

    const hasHighConcentration =
      dayOutflows.count >= 3 || totalOutflow > avgDailyInflowCents * 2.5;

    projectionDays.push({
      date: dateStr,
      projectedInflowCents: avgDailyInflowCents,
      projectedOutflowCents: totalOutflow,
      netFlowCents: netFlow,
      cumulativeBalanceCents: runningBalance,
      outflowItemsCount: dayOutflows.count,
      hasHighConcentration,
    });
  }

  // ── 9. Category summary ────────────────────────────────────────
  const categoryMap: Record<string, { amountCents: number; count: number }> = {};
  for (const item of allOutflowItems) {
    if (!categoryMap[item.category]) {
      categoryMap[item.category] = { amountCents: 0, count: 0 };
    }
    categoryMap[item.category].amountCents += item.amountCents;
    categoryMap[item.category].count += 1;
  }

  const totalCents = Object.values(categoryMap).reduce((s, c) => s + c.amountCents, 0);
  const categorySummary: CategorySummary[] = Object.entries(categoryMap)
    .map(([category, data]) => ({
      category,
      amountCents: data.amountCents,
      count: data.count,
      percentage: totalCents > 0 ? Math.round((data.amountCents / totalCents) * 100) : 0,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);

  // ── 10. Weekly aggregation ─────────────────────────────────────
  const weeklyMap: Record<string, WeeklyAggregation> = {};
  for (let i = 0; i < days; i++) {
    const current = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = current.toISOString().slice(0, 10);
    const weekNum = Math.floor(i / 7) + 1;
    const weekKey = `week-${weekNum}`;

    if (!weeklyMap[weekKey]) {
      const weekStart = new Date(current);
      const weekEnd = new Date(current.getTime() + 6 * 24 * 60 * 60 * 1000);
      weeklyMap[weekKey] = {
        weekLabel: `Semana ${weekNum} (${weekStart.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}-${weekEnd.toLocaleDateString("es-MX", { day: "numeric", month: "short" })})`,
        startDate: weekStart.toISOString().slice(0, 10),
        endDate: weekEnd.toISOString().slice(0, 10),
        totalOutflowCents: 0,
        itemCount: 0,
        isHeavy: false,
      };
    }

    const dayData = outflowsByDate[dateStr];
    if (dayData) {
      weeklyMap[weekKey].totalOutflowCents += dayData.amount;
      weeklyMap[weekKey].itemCount += dayData.count;
    }
  }

  const weeklyList = Object.values(weeklyMap);
  const amounts = weeklyList.map((w) => w.totalOutflowCents).sort((a, b) => a - b);
  const median = amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)] : 0;
  for (const week of weeklyList) {
    week.isHeavy = week.totalOutflowCents > median * 1.5 && week.totalOutflowCents > 0;
  }

  // ── 11. Upcoming items (next 7 days) ───────────────────────────
  const sevenDaysFromNow = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const upcomingItems = allOutflowItems.filter(
    (item) => item.date >= startDateStr && item.date <= sevenDaysFromNow
  );

  return {
    days: projectionDays,
    outflowItems: allOutflowItems,
    categorySummary,
    weeklyAggregation: weeklyList,
    overdueItems,
    upcomingItems,
    initialBalanceCents: INITIAL_BALANCE,
    procurementCommitments: {
      purchaseOrdersCount: poRows.length,
      purchaseOrdersTotalCents: poRows.reduce((s, po) => s + (po.totalAmount || 0), 0),
      invoicesCount: invRows.length,
      invoicesTotalCents: invRows.reduce((s, inv) => s + inv.total, 0),
    },
    payroll: payrollData,
  };
}
