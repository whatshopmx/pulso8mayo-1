import { db } from "@/lib/db";
import { financialPeriods } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { eq, and, sql } from "drizzle-orm";
import { freezePnLPeriod, freezePnLPeriodIn } from "./pnl-snapshot-service";
import { logDataAccess } from "@/lib/security/audit";
import { isAccountingPostingEnabled } from "./accounting/expense-adapter";
import { closeAccountingPeriodIn, reopenAccountingPeriodIn } from "./accounting/close-service";

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
  targetDate: string | Date,
  q: Pick<typeof db, "select"> = db,
): Promise<boolean> {
  const dateObj = typeof targetDate === "string" ? new Date(targetDate) : targetDate;
  if (isNaN(dateObj.getTime())) return false;

  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth() + 1;

  const [period] = await q
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
  const monthStr = String(month).padStart(2, "0");
  const periodStart = `${year}-${monthStr}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;

  if (typeof (db as { transaction?: unknown }).transaction === "function") {
    return withCompanyContext({ companyId, actorId: closedBy }, async (tx) => {
      if (isAccountingPostingEnabled()) {
        const result = await closeAccountingPeriodIn(tx, { companyId, year, month, closedBy });
        return result.period as FinancialPeriod;
      }

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 505))`);
      try {
        await freezePnLPeriodIn(tx, companyId, periodStart, periodEnd, closedBy);
      } catch (error) {
        console.error(`[closeFinancialPeriod] Error al congelar P&L para ${periodStart} a ${periodEnd}:`, error);
        throw new Error(
          `No se pudo cerrar el período financiero ${year}-${monthStr}: falló la congelación y preservación del snapshot de P&L (${error instanceof Error ? error.message : String(error)}). El período permanece abierto para proteger la consistencia histórica.`
        );
      }

      const [existing] = await tx
        .select()
        .from(financialPeriods)
        .where(
          and(
            eq(financialPeriods.companyId, companyId),
            eq(financialPeriods.year, year),
            eq(financialPeriods.month, month)
          )
        )
        .limit(1)
        .for("update");

      if (existing) {
        const [updated] = await tx
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

      const [created] = await tx
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
    });
  }

  // Fallback for mocked unit tests without db.transaction
  try {
    await freezePnLPeriod(companyId, periodStart, periodEnd, closedBy);
  } catch (error) {
    console.error(`[closeFinancialPeriod] Error al congelar P&L para ${periodStart} a ${periodEnd}:`, error);
    throw new Error(
      `No se pudo cerrar el período financiero ${year}-${monthStr}: falló la congelación y preservación del snapshot de P&L (${error instanceof Error ? error.message : String(error)}). El período permanece abierto para proteger la consistencia histórica.`
    );
  }

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
 * Registra en bitácora el usuario autor y motivo de reapertura.
 */
export async function reopenFinancialPeriod(params: {
  companyId: string;
  year: number;
  month: number;
  reopenedBy?: string;
  reason?: string;
}): Promise<void> {
  const { companyId, year, month, reopenedBy, reason } = params;

  if (typeof (db as { transaction?: unknown }).transaction === "function") {
    await withCompanyContext({ companyId, actorId: reopenedBy }, async (tx) => {
      if (isAccountingPostingEnabled() && reopenedBy && reason && reason.trim().length >= 5) {
        await reopenAccountingPeriodIn(tx, { companyId, year, month, reopenedBy, reason: reason.trim() });
        return;
      }

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 505))`);
      await tx
        .update(financialPeriods)
        .set({
          status: "OPEN",
          closedAt: null,
          closedBy: null,
          reopenedAt: reopenedBy ? new Date() : null,
          reopenedBy: reopenedBy ?? null,
          reopenReason: reason ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(financialPeriods.companyId, companyId),
            eq(financialPeriods.year, year),
            eq(financialPeriods.month, month)
          )
        );
    });
  } else {
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

  if (reopenedBy) {
    await logDataAccess({
      userId: reopenedBy,
      companyId,
      action: "UPDATE",
      resource: "financial_periods",
      resourceId: `${year}-${String(month).padStart(2, "0")}`,
      decision: {
        allowed: true,
        reason: reason || "Reapertura de período financiero",
      },
    });
  }
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
