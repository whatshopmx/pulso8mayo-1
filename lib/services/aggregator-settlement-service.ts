import { db } from "@/lib/db";
import { aggregatorSettlements, dailySalesCuts } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  computeSettlementVarianceCents,
  normalizeSettlementChannel,
  settlementStatusForVariance,
} from "./aggregator-settlement-rules";

// Re-export de las reglas puras: los consumidores las importan desde aquí sin
// tener que saber que viven en un módulo aparte.
export {
  computeSettlementVarianceCents,
  normalizeSettlementChannel,
  SETTLEMENT_VARIANCE_TOLERANCE_CENTS,
  settlementStatusForVariance,
} from "./aggregator-settlement-rules";

export interface CreateAggregatorSettlementInput {
  companyId: string;
  branchId: string;
  /**
   * Canal de la liquidación. Se normaliza a la clave canónica de
   * `aggregatorSales` (ver `normalizeSettlementChannel`), así que se aceptan
   * alias como `ubereats`, `didi food` o `terminal`.
   */
  channel: string; // 'rappi' | 'uber' | 'didi' | 'tpv' | 'mostrador' | …
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  grossSalesCents: number;
  commissionCents: number;
  netDepositedCents: number;
  notes?: string;
}

const CARD_CHANNELS = new Set(["tpv"]);
const CASH_CHANNELS = new Set(["mostrador"]);
const TOTAL_CHANNELS = new Set(["total", "todas", "todos"]);

/**
 * Expresión de la venta **de ese canal** registrada en los cortes de Pulso.
 *
 * - `tpv` → suma de `card_sales` (la terminal es tarjeta).
 * - `mostrador` → suma de `cash_sales`.
 * - `total` → suma de `total_sales`.
 * - agregador → suma de la llave del canal dentro de `aggregator_sales`.
 *
 * Antes esta consulta sumaba `SUM(total_sales)` de TODO el periodo sin mirar el
 * canal: la liquidación de Rappi se comparaba contra la venta completa del
 * restaurante, así que la varianza no medía nada. El `SUM` entre canales no
 * duplica porque el ingest escribe SALON + DELIVERY como filas excluyentes
 * (`aggregator_sales` vive sólo en DELIVERY; `card_sales`/`cash_sales` sólo en
 * SALON) y una fila TOTAL nunca coexiste con la partición.
 *
 * Un canal desconocido cae al agregador: si el corte ya trae la llave en el
 * JSONB, funciona sin migración; si no, devuelve 0 en vez de inventar venta.
 */
export function posSalesSumExprForChannel(channel: string): SQL<number> {
  const key = normalizeSettlementChannel(channel);

  if (CARD_CHANNELS.has(key)) {
    return sql<number>`COALESCE(SUM(COALESCE(${dailySalesCuts.cardSales}, 0)), 0)`;
  }
  if (CASH_CHANNELS.has(key)) {
    return sql<number>`COALESCE(SUM(COALESCE(${dailySalesCuts.cashSales}, 0)), 0)`;
  }
  if (TOTAL_CHANNELS.has(key)) {
    return sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`;
  }

  return sql<number>`COALESCE(SUM(
    CASE
      WHEN jsonb_typeof(${dailySalesCuts.aggregatorSales} -> ${key}) = 'number'
      THEN (${dailySalesCuts.aggregatorSales} ->> ${key})::numeric
      ELSE 0
    END
  ), 0)`;
}

/**
 * Registra y concilia la liquidación periódica (semanal) enviada por un agregador.
 * Calcula la suma de ventas registradas en cortes del POS para ESE canal y periodo.
 */
export async function createAndReconcileAggregatorSettlement(
  input: CreateAggregatorSettlementInput
) {
  const channel = normalizeSettlementChannel(input.channel);

  // 1. Venta del canal según los cortes de Pulso en el rango. Se acota siempre
  //    por (company, branch, fecha) y por el canal de la liquidación.
  const [posSum] = await db
    .select({ totalPosSales: posSalesSumExprForChannel(channel) })
    .from(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, input.companyId),
        eq(dailySalesCuts.branchId, input.branchId),
        gte(dailySalesCuts.businessDate, input.periodStart),
        lte(dailySalesCuts.businessDate, input.periodEnd)
      )
    );

  // `numeric`/`bigint` llegan como string desde el driver de Postgres.
  const posSalesCents = Math.round(Number(posSum?.totalPosSales ?? 0));

  const varianceCents = computeSettlementVarianceCents({
    posSalesCents,
    commissionCents: input.commissionCents,
    netDepositedCents: input.netDepositedCents,
  });
  const status = settlementStatusForVariance(varianceCents);

  const [settlement] = await db
    .insert(aggregatorSettlements)
    .values({
      companyId: input.companyId,
      branchId: input.branchId,
      channel,
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
