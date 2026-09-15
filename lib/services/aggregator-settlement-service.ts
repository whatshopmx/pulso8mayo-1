import { db } from "@/lib/db";
import { aggregatorSettlements, dailySalesCuts } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface CreateAggregatorSettlementInput {
  companyId: string;
  branchId: string;
  channel: string; // 'rappi' | 'ubereats' | 'didi' | 'TPV'
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  grossSalesCents: number;
  commissionCents: number;
  netDepositedCents: number;
  notes?: string;
}

/**
 * Registra y concilia la liquidación periódica (semanal) enviada por un agregador.
 * Calcula la suma de ventas registradas en cortes del POS para ese canal y periodo.
 */
export async function createAndReconcileAggregatorSettlement(
  input: CreateAggregatorSettlementInput
) {
  // 1. Obtener suma de ventas del canal según los cortes del POS en el rango
  const [posSum] = await db
    .select({
      totalPosSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
    })
    .from(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, input.companyId),
        eq(dailySalesCuts.branchId, input.branchId),
        gte(dailySalesCuts.businessDate, input.periodStart),
        lte(dailySalesCuts.businessDate, input.periodEnd)
      )
    );

  const posSalesCents = posSum?.totalPosSales || 0;
  // Varianza = Depósito Neto + Comisión - Venta Bruta Declarada
  const varianceCents = (input.netDepositedCents + input.commissionCents) - input.grossSalesCents;
  const status = Math.abs(varianceCents) <= 100 ? "RECONCILED" : "DISCREPANCY";

  const [settlement] = await db
    .insert(aggregatorSettlements)
    .values({
      companyId: input.companyId,
      branchId: input.branchId,
      channel: input.channel.toLowerCase(),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      grossSalesCents: input.grossSalesCents,
      commissionCents: input.commissionCents,
      netDepositedCents: input.netDepositedCents,
      posSalesCents,
      varianceCents,
      status,
      notes: input.notes || null,
    })
    .returning();

  return settlement;
}

/**
 * Obtiene el historial de liquidaciones de agregadores para una sucursal y periodo.
 */
export async function getAggregatorSettlements(
  companyId: string,
  branchId?: string
) {
  const conditions = [eq(aggregatorSettlements.companyId, companyId)];
  if (branchId) {
    conditions.push(eq(aggregatorSettlements.branchId, branchId));
  }

  return db
    .select()
    .from(aggregatorSettlements)
    .where(and(...conditions))
    .orderBy(aggregatorSettlements.periodStart);
}
