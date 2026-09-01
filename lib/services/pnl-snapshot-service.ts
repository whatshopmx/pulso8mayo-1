// P&L Fase 3.3 — Congelar el P&L de un período cerrado.
//
// Por qué existe: `food-cost-service` valoriza el consumo AL MOMENTO DEL
// CÁLCULO contra `inventory_items`, porque `inventory_movements` no guarda el
// costo del momento. Recalcular una semana pasada después de que subió el precio
// del aceite devuelve un food cost distinto para los mismos movimientos. Sin
// congelar, la tendencia semana-a-semana se mueve sola y el dueño ve variaciones
// que nunca ocurrieron en su operación.
//
// Decisión P3 del plan: tabla propia `pnl_snapshots`, no `executiveState`.

import { db } from "@/lib/db";
import { pnlSnapshots } from "@/lib/db/schema";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getPnLByBranch } from "@/lib/services/pnl-service";
import type { BranchPnL } from "@/lib/services/pnl-types";

export interface FreezeResult {
  periodStart: string;
  periodEnd: string;
  branchCount: number;
  /** Sucursales congeladas con al menos un renglón que no se midió. */
  estimatedBranchCount: number;
}

/**
 * Calcula y congela el P&L de todas las sucursales de la company para el
 * período dado. Re-congelar el mismo período ACTUALIZA la fila (no duplica),
 * lo que hace la operación segura de reintentar desde un cron.
 *
 * El snapshot guarda la procedencia junto con los importes: un histórico que
 * conserva los números pero pierde el `source` vuelve a ser un P&L que no se
 * puede auditar.
 */
export async function freezePnLPeriod(
  companyId: string,
  periodStart: string,
  periodEnd: string,
  frozenBy?: string,
): Promise<FreezeResult> {
  const startDay = periodStart.slice(0, 10);
  const endDay = periodEnd.slice(0, 10);

  const pnl = await getPnLByBranch(companyId, startDay, endDay);
  if (pnl.length === 0) {
    return { periodStart: startDay, periodEnd: endDay, branchCount: 0, estimatedBranchCount: 0 };
  }

  const rows = pnl.map((b) => ({
    companyId,
    branchId: b.branchId,
    periodStart: startDay,
    periodEnd: endDay,
    salesCents: b.sales.cents,
    foodCostCents: b.foodCost.cents,
    wasteCents: b.waste.cents,
    laborCostCents: b.labor.cents,
    operatingExpensesCents: b.operatingExpenses.cents,
    // `null` y no `0` cuando el renglón no se pudo calcular: un cero afirmaría
    // que ese período no pagó comisiones, y lo que pasó fue que no había
    // tarifas configuradas. Es la misma regla de `NO_DATA` en la UI, llevada a
    // la columna.
    commissionCents:
      b.commissions && b.commissions.source !== "NO_DATA" ? b.commissions.cents : null,
    operatingProfitCents: b.operatingProfit.cents,
    weakestLine: b.weakestLine,
    lines: b as unknown as Record<string, unknown>,
    frozenBy: frozenBy ?? null,
  }));

  await db
    .insert(pnlSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      target: [pnlSnapshots.branchId, pnlSnapshots.periodStart, pnlSnapshots.periodEnd],
      set: {
        salesCents: sqlExcluded("sales_cents"),
        foodCostCents: sqlExcluded("food_cost_cents"),
        wasteCents: sqlExcluded("waste_cents"),
        laborCostCents: sqlExcluded("labor_cost_cents"),
        operatingExpensesCents: sqlExcluded("operating_expenses_cents"),
        commissionCents: sqlExcluded("commission_cents"),
        operatingProfitCents: sqlExcluded("operating_profit_cents"),
        weakestLine: sqlExcluded("weakest_line"),
        lines: sqlExcluded("lines"),
        frozenAt: new Date(),
      },
    });

  return {
    periodStart: startDay,
    periodEnd: endDay,
    branchCount: pnl.length,
    estimatedBranchCount: pnl.filter((b) => b.weakestLine !== "MEASURED").length,
  };
}

/** Helper tipado para referenciar `excluded.<col>` en el upsert. */
function sqlExcluded(column: string) {
  // `excluded` es la fila propuesta por el INSERT en un ON CONFLICT de Postgres.
  return sql.raw(`excluded.${column}`);
}

export interface PnLSnapshotRow {
  branchId: string;
  periodStart: string;
  periodEnd: string;
  salesCents: number;
  foodCostCents: number;
  wasteCents: number;
  laborCostCents: number;
  operatingExpensesCents: number;
  /**
   * `null` en dos casos distintos que la UI debe leer igual (guion, no cero):
   * un snapshot congelado antes de que existiera el renglón, y uno cuyo período
   * no tenía tarifas configuradas.
   */
  commissionCents: number | null;
  operatingProfitCents: number;
  weakestLine: string;
  frozenAt: Date;
  /** `BranchPnL` completo tal como se congeló. */
  lines: BranchPnL;
}

/**
 * Histórico congelado de una company, del más reciente al más antiguo.
 * Esta es la fuente para la tendencia semana-a-semana — NO recalcular
 * `getPnLByBranch` sobre períodos pasados para graficar.
 */
export async function getPnLSnapshots(
  companyId: string,
  options: { branchId?: string; from?: string; to?: string; limit?: number } = {},
): Promise<PnLSnapshotRow[]> {
  const filters = [eq(pnlSnapshots.companyId, companyId)];
  if (options.branchId) filters.push(eq(pnlSnapshots.branchId, options.branchId));
  if (options.from) filters.push(gte(pnlSnapshots.periodEnd, options.from.slice(0, 10)));
  if (options.to) filters.push(lte(pnlSnapshots.periodEnd, options.to.slice(0, 10)));

  const rows = await db
    .select()
    .from(pnlSnapshots)
    .where(and(...filters))
    .orderBy(desc(pnlSnapshots.periodEnd), asc(pnlSnapshots.branchId))
    .limit(options.limit ?? 200);

  return rows.map((r) => ({
    branchId: r.branchId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    salesCents: r.salesCents,
    foodCostCents: r.foodCostCents,
    wasteCents: r.wasteCents,
    laborCostCents: r.laborCostCents,
    operatingExpensesCents: r.operatingExpensesCents,
    commissionCents: r.commissionCents,
    operatingProfitCents: r.operatingProfitCents,
    weakestLine: r.weakestLine,
    frozenAt: r.frozenAt,
    lines: r.lines as BranchPnL,
  }));
}
