/**
 * REC-03 — Clasificación de la diferencia saldo↔ledger por el doble incremento
 * de recepción (H01).
 *
 * Lógica pura, sin base de datos: el script de diagnóstico
 * (`scripts/diag-receiving-overcount.ts`) la usa para decidir qué lotes se
 * pueden corregir con exactitud y cuáles quedan para conteo físico.
 */

/** Tolerancia de comparación para `numeric(12,4)` guardado como string. */
export const RECEIVING_DELTA_EPS = 0.00005;

export type ReceivingDeltaClass = "ATTRIBUTABLE" | "AMBIGUOUS" | "NO_HISTORY" | "OK";

/**
 * - `OK`: el saldo cuadra con la suma de movimientos (nada que corregir).
 * - `ATTRIBUTABLE`: delta positivo igual a lo recibido → es el doble incremento.
 * - `NO_HISTORY`: no hay movimiento RECEIVING que explique el saldo.
 * - `AMBIGUOUS`: hay delta pero no cuadra con las recepciones registradas
 *   (transferencias, mermas o ajustes posteriores impiden atribuirlo).
 */
export function classifyReceivingDelta(input: {
  observed: number;
  ledger: number;
  receivingQuantity: number;
  receivingCount: number;
}): ReceivingDeltaClass {
  const delta = input.observed - input.ledger;

  if (Math.abs(delta) < RECEIVING_DELTA_EPS) return "OK";
  if (input.receivingCount === 0) return "NO_HISTORY";
  if (delta > 0 && Math.abs(delta - input.receivingQuantity) < RECEIVING_DELTA_EPS) {
    return "ATTRIBUTABLE";
  }
  return "AMBIGUOUS";
}
