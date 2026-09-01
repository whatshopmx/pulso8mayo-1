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

// ---------------------------------------------------------------------------
// Fase 4 — Conciliación de terminal (TPV).
//
// Es el arqueo del dinero de tarjeta, y va **separado** del de efectivo a
// propósito: mezclar las dos diferencias en un solo número deja que un faltante
// de caja se esconda detrás de una comisión bancaria, que es exactamente el
// fraude que un arqueo debería hacer visible.
//
// Convención de signo: la misma que arriba, **negativo = falta dinero**. El plan
// enuncia la fórmula como `cardSales − depósito − comisión`, cuyo signo es el
// inverso; se implementa al revés para que la lectura sea la misma que la del
// efectivo en la misma pantalla ("me faltan $200"), y porque es la que hace
// cierto el caso de verificación del propio plan (tarjeta $10,000, depósito
// $9,500, comisión $300 → alerta).
// ---------------------------------------------------------------------------

export type TpvVarianceDirection = "faltante" | "sobrante" | "cuadrado";

export interface TpvVarianceResult {
  /** Centavos: (depósito + comisión) − tarjeta. Negativo = llegó menos dinero. */
  varianceCents: number;
  direction: TpvVarianceDirection;
  /**
   * `false` cuando el corte no tiene comisión capturada. En ese caso la
   * diferencia incluye la comisión que la terminal sí cobró, así que un
   * faltante del orden de la tasa negociada es lo esperado y no una anomalía.
   * La UI usa esta bandera para decirlo en vez de acusar.
   */
  commissionCaptured: boolean;
}

export interface TpvVarianceInput {
  cardSales: number | null;
  tpvDepositCents: number | null;
  commissionCents: number | null;
}

/**
 * Diferencia entre lo que la terminal depositó y lo que el POS declaró de
 * tarjeta, una vez descontada la comisión.
 *
 * Devuelve `null` si falta cualquiera de los dos lados de la comparación. Un
 * corte sin depósito capturado **no está cuadrado en cero**: está sin conciliar,
 * y pintarlo como $0.00 afirmaría que el banco ya depositó.
 */
export function computeTpvVariance(cut: TpvVarianceInput): TpvVarianceResult | null {
  if (cut.cardSales === null || cut.tpvDepositCents === null) return null;

  const varianceCents = cut.tpvDepositCents + (cut.commissionCents ?? 0) - cut.cardSales;

  return {
    varianceCents,
    direction: varianceCents === 0 ? "cuadrado" : varianceCents < 0 ? "faltante" : "sobrante",
    commissionCaptured: cut.commissionCents !== null,
  };
}

/**
 * Nota que acompaña a una varianza TPV.
 *
 * Un faltante de tarjeta **no es un error**: las terminales liquidan con uno o
 * dos días de rezago, así que el corte del día casi nunca cuadra contra el
 * estado de cuenta del mismo día. La nota lo dice para que nadie salga a buscar
 * un culpable por una diferencia de calendario.
 */
export function tpvVarianceNote(result: TpvVarianceResult): string {
  if (result.direction === "cuadrado") {
    return "El depósito de la terminal más la comisión cuadran con la venta con tarjeta.";
  }
  if (result.direction === "sobrante") {
    return (
      "La terminal depositó más de lo que el corte declaró con tarjeta. " +
      "Suele ser el depósito de un día anterior que llegó junto: revisa a qué fecha corresponde."
    );
  }
  return result.commissionCaptured
    ? "Llegó menos dinero del que la venta con tarjeta y la comisión explican. " +
        "Las terminales liquidan con 1 o 2 días de rezago, así que revisa primero la fecha del depósito."
    : "La diferencia incluye la comisión de la terminal, que este corte no capturó. " +
        "Un faltante del orden de tu tasa negociada es lo esperado: captura la comisión para conciliar de verdad.";
}
