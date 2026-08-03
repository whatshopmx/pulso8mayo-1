// M13 / T31: Financial KPI Service
// Computes Food Cost % and Labor Cost % dynamically against daily sales cuts,
// returning status semaphores (🟢/🟡/🔴) and dispatching deviation alerts.

import { db } from "@/lib/db";
import { dailySalesCuts, shiftSessions, inventoryBatches } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

export interface FinancialKPIFilter {
  companyId: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

export interface FinancialKPIsResult {
  totalSalesCents: number;
  foodCostCents: number;
  foodCostPercent: number;
  foodCostStatus: "OK" | "WARNING" | "CRITICAL";
  laborCostCents: number;
  laborCostPercent: number;
  laborCostStatus: "OK" | "WARNING" | "CRITICAL";
  combinedCostPercent: number;
  healthyMarginPercent: number;
}

/** Default target thresholds for HORECA operations */
const FOOD_COST_TARGET = 30.0; // 30% or less is OK
const FOOD_COST_WARN = 35.0;   // 30-35% is warning, >35% is critical

const LABOR_COST_TARGET = 28.0; // 28% or less is OK
const LABOR_COST_WARN = 32.0;   // 28-32% is warning, >32% is critical

export async function calculateFinancialKPIs(filter: FinancialKPIFilter): Promise<FinancialKPIsResult> {
  const salesConditions = [eq(dailySalesCuts.companyId, filter.companyId)];

  if (filter.branchId) {
    salesConditions.push(eq(dailySalesCuts.branchId, filter.branchId));
  }
  if (filter.startDate) {
    salesConditions.push(gte(dailySalesCuts.businessDate, filter.startDate));
  }
  if (filter.endDate) {
    salesConditions.push(lte(dailySalesCuts.businessDate, filter.endDate));
  }

  // 1. Fetch total sales from cuts
  const [salesRow] = await db
    .select({
      totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
    })
    .from(dailySalesCuts)
    .where(and(...salesConditions));

  const totalSalesCents = Number(salesRow?.totalSales || 0);

  // 2. Fetch inventory consumption (Food Cost)
  let foodCostCents = 0;
  if (filter.branchId) {
    const [inventoryRow] = await db
      .select({
        totalCost: sql<number>`COALESCE(SUM(${inventoryBatches.initialQuantity} * ${inventoryBatches.unitCost}), 0)`,
      })
      .from(inventoryBatches)
      .where(eq(inventoryBatches.branchId, filter.branchId));

    foodCostCents = Number(inventoryRow?.totalCost || 0);
  }

  // Fallback: 28% baseline if inventory records not yet populated
  if (foodCostCents === 0 && totalSalesCents > 0) {
    foodCostCents = Math.round(totalSalesCents * 0.28);
  }

  // 3. Fetch Labor Cost (from shiftSessions)
  let laborCostCents = 0;
  if (filter.branchId) {
    const [shiftRow] = await db
      .select({
        totalMinutes: sql<number>`COALESCE(SUM(${shiftSessions.totalWorkMinutes}), 0)`,
      })
      .from(shiftSessions)
      .where(eq(shiftSessions.branchId, filter.branchId));

    const totalHours = Number(shiftRow?.totalMinutes || 0) / 60;
    laborCostCents = Math.round(totalHours * 6000); // ~$60 MXN/hr in centavos
  }

  // Fallback: 25% baseline if shifts not yet recorded
  if (laborCostCents === 0 && totalSalesCents > 0) {
    laborCostCents = Math.round(totalSalesCents * 0.25);
  }

  // 4. Percentages
  const foodCostPercent =
    totalSalesCents > 0 ? Number(((foodCostCents / totalSalesCents) * 100).toFixed(1)) : 0;

  const laborCostPercent =
    totalSalesCents > 0 ? Number(((laborCostCents / totalSalesCents) * 100).toFixed(1)) : 0;

  const combinedCostPercent = Number((foodCostPercent + laborCostPercent).toFixed(1));
  const healthyMarginPercent = Number((100 - combinedCostPercent).toFixed(1));

  // Status semaphores
  const foodCostStatus =
    foodCostPercent <= FOOD_COST_TARGET
      ? "OK"
      : foodCostPercent <= FOOD_COST_WARN
      ? "WARNING"
      : "CRITICAL";

  const laborCostStatus =
    laborCostPercent <= LABOR_COST_TARGET
      ? "OK"
      : laborCostPercent <= LABOR_COST_WARN
      ? "WARNING"
      : "CRITICAL";

  // Dispatch alert if critical
  if (foodCostStatus === "CRITICAL" || laborCostStatus === "CRITICAL") {
    try {
      await NotificationDispatcher.sendNotification({
        userId: filter.companyId,
        title: "⚠️ Alerta de Desviación Financiera",
        message: `Food Cost (${foodCostPercent}%) o Costo Laboral (${laborCostPercent}%) superaron el límite objetivo en tu sucursal.`,
        type: "warning",
        eventType: "financial_kpi_deviation",
        metadata: {
          foodCostPercent,
          laborCostPercent,
          totalSales: (totalSalesCents / 100).toFixed(2),
        },
      });
    } catch (err) {
      console.warn("[Financial KPI Service] Notification dispatch warning:", err);
    }
  }

  return {
    totalSalesCents,
    foodCostCents,
    foodCostPercent,
    foodCostStatus,
    laborCostCents,
    laborCostPercent,
    laborCostStatus,
    combinedCostPercent,
    healthyMarginPercent,
  };
}
