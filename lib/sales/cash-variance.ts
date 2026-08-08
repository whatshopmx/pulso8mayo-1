/**
 * Arqueo de caja: comparación entre el efectivo declarado en el corte y el
 * efectivo contado físicamente.
 *
 * Convención de signo — se expone la diferencia como `contado − declarado`,
 * que es la lectura natural para el operador ("me falta / me sobra dinero en
 * la caja"). Nótese que `schema.ts:2368` documenta la derivación inversa
 * (`cashSales − cashCountedCents`); ambas describen el mismo hecho, esta
 * invierte el signo para que **negativo = faltante**, que es como se presenta.
 */

export type CashVarianceDirection = "faltante" | "sobrante" | "cuadrado";

export interface CashVarianceResult {
  /** Centavos: contado − declarado. Negativo = falta efectivo en caja. */
  varianceCents: number;
  direction: CashVarianceDirection;
}

/** Corte con los dos lados del arqueo; ambos pueden faltar. */
export interface CashVarianceInput {
  cashSales: number | null;
  cashCountedCents: number | null;
}

/**
 * Devuelve la varianza del arqueo, o `null` cuando falta cualquiera de los dos
 * lados de la comparación — un corte con conteo pero sin efectivo declarado (o
 * viceversa) no tiene diferencia que reportar, y no debe pintarse como $0.00.
 */
export function computeCashVariance(cut: CashVarianceInput): CashVarianceResult | null {
  if (cut.cashSales === null || cut.cashCountedCents === null) return null;

  const varianceCents = cut.cashCountedCents - cut.cashSales;

  return {
    varianceCents,
    direction: varianceCents === 0 ? "cuadrado" : varianceCents < 0 ? "faltante" : "sobrante",
  };
}

/** Clase de color semántico para una dirección de arqueo. */
export function cashVarianceToneClass(direction: CashVarianceDirection): string {
  return direction === "cuadrado" ? "text-success" : "text-destructive";
}
