// lib/services/aggregator-settlement-rules.ts
//
// Reglas puras de la conciliación de liquidaciones de plataformas.
//
// Sin dependencias de runtime (ni `db`, ni Drizzle) por la misma razón que
// `commission-types.ts` y `payment-run-settlement.ts`: se pueden probar en
// milisegundos y el servicio las importa como única fuente de verdad. Si la
// normalización o la varianza vivieran sólo dentro del servicio, el test
// tendría que montar Postgres para comprobar una suma de tres números.

/**
 * Alias → clave canónica.
 *
 * Las claves canónicas son exactamente las que produce `matchAggregatorLabel`
 * (`lib/services/pos-column-aliases.ts`) y las que declara `COMMISSION_CHANNELS`
 * (`lib/services/commission-types.ts`). Sin esta normalización, el panel de
 * conciliación enviaba `ubereats` mientras `aggregator_sales` guarda `uber`:
 * la liquidación de Uber Eats se conciliaba contra cero y salía como falsa
 * discrepancia. La misma deriva de llaves rompía la tarifa de comisión, que
 * también se configura como `uber`.
 */
const CANONICAL_CHANNEL_ALIASES: Record<string, string> = {
  ubereats: "uber",
  "uber eats": "uber",
  uber_eats: "uber",
  didifood: "didi",
  "didi food": "didi",
  "pedidos ya": "pedidosya",
  pedidos_ya: "pedidosya",
  "sin delantal": "sindelantal",
  "mercado pago": "mercadopago",
  mercadopago: "mercadopago",
  // Labels de la UI de canales (`COMMISSION_CHANNEL_LABELS`). El ejecutor de
  // workflows guarda el label del SELECT, no su clave, así que la
  // normalización tiene que aceptar el texto tal como se ve.
  "mostrador (efectivo)": "mostrador",
  "tpv (tarjeta)": "tpv",
  // Terminal / efectivo no son agregadores: se concilian contra las columnas
  // del corte, no contra `aggregator_sales`.
  "terminal bancaria": "tpv",
  terminal: "tpv",
  tarjeta: "tpv",
  efectivo: "mostrador",
  caja: "mostrador",
};

/** Normaliza el canal a su clave canónica. Texto libre → clave estable. */
export function normalizeSettlementChannel(channel: string): string {
  const key = channel.trim().toLowerCase().replace(/\s+/g, " ");
  return CANONICAL_CHANNEL_ALIASES[key] ?? key;
}

/**
 * Varianza de la liquidación: lo que la plataforma pagará (neto depositado más
 * la comisión que retuvo) contra la venta que Pulso registró en ese canal.
 *
 * Signo: negativo = la plataforma deja menos de lo vendido (faltante); positivo
 * = devuelve más (sobrante). Mismo sentido que `computeCashVariance`.
 *
 * `grossSalesCents` (la venta bruta que declara la plataforma) se conserva como
 * contexto, pero **no** entra en la varianza: compararla contra el neto de la
 * propia plataforma validaba que su estado de cuenta fuera consistente consigo
 * mismo, no que cuadrara con el corte. La conciliación que importa es contra la
 * venta registrada.
 */
export function computeSettlementVarianceCents(input: {
  posSalesCents: number;
  commissionCents: number;
  netDepositedCents: number;
}): number {
  return input.netDepositedCents + input.commissionCents - input.posSalesCents;
}

/** Tolerancia de la conciliación: ±$1.00 por redondeos de la plataforma. */
export const SETTLEMENT_VARIANCE_TOLERANCE_CENTS = 100;

export function settlementStatusForVariance(
  varianceCents: number,
): "RECONCILED" | "DISCREPANCY" {
  return Math.abs(varianceCents) <= SETTLEMENT_VARIANCE_TOLERANCE_CENTS
    ? "RECONCILED"
    : "DISCREPANCY";
}
