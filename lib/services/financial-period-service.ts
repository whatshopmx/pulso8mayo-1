import { db } from "@/lib/db";
import { financialPeriods, pnlSnapshots } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { freezePnLPeriod } from "./pnl-snapshot-service";

export interface FinancialPeriod {
  id: string;
  companyId: string;
  year: number;
  month: number;
  status: "OPEN" | "CLOSED";
  closedAt: Date | null;
  closedBy: string | null;
}

/**
 * Verifica si una fecha de operación dada (YYYY-MM-DD o objeto Date) pertenece
 * a un periodo financiero CERRADO para una compañía determinada.
 */
export async function isPeriodClosed(
  companyId: string,
  targetDate: string | Date
): Promise<boolean> {
  const dateObj = typeof targetDate === "string" ? new Date(targetDate) : targetDate;
  if (isNaN(dateObj.getTime())) return false;

  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth() + 1;

  const [period] = await db
    .select({ status: financialPeriods.status })
    .from(financialPeriods)
    .where(
      and(
        eq(financialPeriods.companyId, companyId),
        eq(financialPeriods.year, year),
        eq(financialPeriods.month, month)
      )
    )
    .limit(1);

  return period?.status === "CLOSED";
}

/**
 * Cierra el periodo financiero mensual para una compañía.
 * Congela automáticamente los snapshots de P&L de todas las sucursales.
 */
export async function closeFinancialPeriod(params: {
  companyId: string;
  year: number;
  month: number;
  closedBy: string;
}): Promise<FinancialPeriod> {
  const { companyId, year, month, closedBy } = params;

  // 1. Congelar los P&L del mes para todas las sucursales (idempotente)
  const monthStr = String(month).padStart(2, "0");
  const periodStart = `${year}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;

  try {
    await freezePnLPeriod(companyId, periodStart, periodEnd, closedBy);
  } catch (error) {
    console.warn(`[closeFinancialPeriod] Warning freezing PnL for ${periodStart} to ${periodEnd}:`, error);
  }

  // 2. Marcar el periodo como CLOSED en la base de datos
  const [existing] = await db
    .select()
    .from(financialPeriods)
    .where(
      and(
        eq(financialPeriods.companyId, companyId),
        eq(financialPeriods.year, year),
        eq(financialPeriods.month, month)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(financialPeriods)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        closedBy,
        updatedAt: new Date(),
      })
      .where(eq(financialPeriods.id, existing.id))
      .returning();

    return updated as FinancialPeriod;
  }

  const [created] = await db
    .insert(financialPeriods)
    .values({
      companyId,
      year,
      month,
      status: "CLOSED",
      closedAt: new Date(),
      closedBy,
    })
    .returning();

  return created as FinancialPeriod;
}

/**
 * Reabre un periodo financiero previamente cerrado (exclusivo para Admins).
 */
export async function reopenFinancialPeriod(params: {
  companyId: string;
  year: number;
  month: number;
}): Promise<void> {
  const { companyId, year, month } = params;

  await db
    .update(financialPeriods)
    .set({
      status: "OPEN",
      closedAt: null,
      closedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(financialPeriods.companyId, companyId),
        eq(financialPeriods.year, year),
        eq(financialPeriods.month, month)
      )
    );
}

/**
 * Lista el estado de los periodos financieros del año actual para una compañía.
 */
export async function listFinancialPeriods(
  companyId: string,
  year: number
): Promise<FinancialPeriod[]> {
  const periods = await db
    .select()
    .from(financialPeriods)
    .where(
      and(
        eq(financialPeriods.companyId, companyId),
        eq(financialPeriods.year, year)
      )
    );

  return periods as FinancialPeriod[];
}
