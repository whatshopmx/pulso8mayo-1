/**
 * Cuadre de formas de pago de un corte manual (Fase 2 — operación multi-canal).
 *
 * El corte guarda dos cosas que **no** son lo mismo:
 *
 *  - `other_payments`: el total no-efectivo/no-tarjeta (vales, transferencias y
 *    también las plataformas).
 *  - `aggregator_sales`: el desglose por plataforma, que es un subconjunto de
 *    `other_payments`.
 *
 * Mismo contrato que el ingest del POS (`sales-ingestion-service`), donde
 * `aggregator_sales` desglosa lo que `other_payments` ya suma. Por eso el cuadre
 * contra `total_sales` incluye las plataformas una sola vez, dentro de "Otros".
 *
 * Puro y sin React: la regla de qué se suma y cuándo algo es `null` (sin
 * capturar) en vez de `0` se prueba directamente.
 */

export interface CutPaymentBreakdown {
  /** Plataformas con monto > 0, listas para `aggregator_sales`. */
  aggregatorSales: Record<string, number>;
  aggregatorSumCents: number;
  /** `other_payments` a enviar: base + plataformas, o `null` si nada se capturó. */
  otherTotalCents: number | null;
  /** Suma para el cuadre: efectivo + tarjeta + otros (con plataformas). */
  paymentsSumCents: number;
  /** ¿Se capturó al menos una forma de pago? Decide si se valida el cuadre. */
  anyEntered: boolean;
}

export interface CutPaymentInput {
  cashCents: number | null;
  cardCents: number | null;
  /** "Otros" sin las plataformas; `null` = campo vacío. */
  otherBaseCents: number | null;
  /** Monto por plataforma; `null` = sin capturar. */
  aggregatorCents: Record<string, number | null>;
}

export function computeCutPaymentBreakdown(input: CutPaymentInput): CutPaymentBreakdown {
  // Una plataforma en cero no se escribe: no es lo mismo "no vendió por Rappi"
  // que "no se capturó", y el desglose sólo debe afirmar lo segundo.
  const aggregatorSales: Record<string, number> = {};
  let aggregatorSumCents = 0;
  for (const [key, cents] of Object.entries(input.aggregatorCents)) {
    if (cents !== null && cents > 0) {
      aggregatorSales[key] = cents;
      aggregatorSumCents += cents;
    }
  }

  const anyAggregator = Object.keys(aggregatorSales).length > 0;
  const otherTotalCents =
    input.otherBaseCents === null && !anyAggregator
      ? null
      : (input.otherBaseCents ?? 0) + aggregatorSumCents;

  const anyEntered =
    input.cashCents !== null ||
    input.cardCents !== null ||
    input.otherBaseCents !== null ||
    anyAggregator;

  const paymentsSumCents =
    (input.cashCents ?? 0) +
    (input.cardCents ?? 0) +
    (input.otherBaseCents ?? 0) +
    aggregatorSumCents;

  return { aggregatorSales, aggregatorSumCents, otherTotalCents, paymentsSumCents, anyEntered };
}
