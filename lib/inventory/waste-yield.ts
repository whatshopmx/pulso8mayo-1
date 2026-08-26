// lib/inventory/waste-yield.ts
//
// Task 11 (plan-loteprod-gaps, manual loteprod §8.1/§8.3): merma por preparación.
// El manual la define como la merma *esperada* del proceso — recorte, grasa,
// hueso — y exige compararla contra el rendimiento de la ficha técnica. Sin esa
// comparación "merma por preparación" es un OTHER con otro nombre: no distingue
// el recorte normal del cocinero que se está llevando producto.
//
// Lógica pura, sin DB: la usa la ruta POST de mermas y el detalle del historial.
// Cantidades en `numeric(12,4)` → llegan como string desde la BD; aquí se
// trabaja en number y se devuelve number (el caller hace String() al escribir).

/**
 * Desviación relativa a partir de la cual la merma se marca para revisión.
 * 0.20 = la merma real supera en 20% a la esperada por el rendimiento de la
 * ficha. Es un default operativo, no un número del manual: el manual pide
 * "investigar cuando se desvía", sin fijar el punto.
 */
export const YIELD_DEVIATION_THRESHOLD = 0.2;

/**
 * Merma mínima (en unidades del insumo) por debajo de la cual no se marca nada.
 * Evita que 60 g contra 40 g esperados —ruido de báscula en una preparación
 * chica— levante una bandera de robo.
 */
export const YIELD_MIN_ABSOLUTE = 0.5;

export interface YieldComparison {
  /** Merma que el rendimiento de la ficha predice para lo procesado. */
  expectedQuantity: number;
  /** (real − esperada) / esperada. `null` cuando no hay esperada > 0. */
  deviationRatio: number | null;
  /** Marca la merma para revisión (§8.3 causa → acción). */
  flagged: boolean;
}

/**
 * Merma esperada = procesado × (1 − rendimiento). Un `yieldPercent` de 87
 * significa que 13% de lo procesado se va en el proceso.
 *
 * `yieldPercent` null/100 → 0 esperado: la ficha no declara pérdida de proceso,
 * así que cualquier merma capturada es desviación (pero sujeta al mínimo
 * absoluto, ver `compareYield`).
 */
export function expectedPreparationWaste(
  processedQuantity: number,
  yieldPercent: number | null | undefined
): number {
  if (!Number.isFinite(processedQuantity) || processedQuantity <= 0) return 0;
  const pct = yieldPercent === null || yieldPercent === undefined ? 100 : yieldPercent;
  const clamped = Math.min(100, Math.max(0, pct));
  return processedQuantity * ((100 - clamped) / 100);
}

/**
 * Compara la merma capturada contra la esperada por la ficha.
 *
 * Casos que decide explícitamente:
 * - esperada 0 y real ≤ mínimo absoluto → no marca (ruido de báscula)
 * - esperada 0 y real > mínimo absoluto → marca (la ficha no predice merma)
 * - real por DEBAJO de la esperada → nunca marca: rendir de más no es un
 *   hallazgo de merma (si acaso, la ficha está mal — eso lo ve el §3.3)
 */
export function compareYield(params: {
  processedQuantity: number;
  actualWaste: number;
  yieldPercent: number | null | undefined;
  threshold?: number;
  minAbsolute?: number;
}): YieldComparison {
  const {
    processedQuantity,
    actualWaste,
    yieldPercent,
    threshold = YIELD_DEVIATION_THRESHOLD,
    minAbsolute = YIELD_MIN_ABSOLUTE,
  } = params;

  const expectedQuantity = expectedPreparationWaste(processedQuantity, yieldPercent);
  const excess = actualWaste - expectedQuantity;

  if (excess <= 0) {
    return { expectedQuantity, deviationRatio: expectedQuantity > 0 ? excess / expectedQuantity : null, flagged: false };
  }
  if (excess <= minAbsolute) {
    return { expectedQuantity, deviationRatio: expectedQuantity > 0 ? excess / expectedQuantity : null, flagged: false };
  }
  if (expectedQuantity <= 0) {
    return { expectedQuantity, deviationRatio: null, flagged: true };
  }

  const deviationRatio = excess / expectedQuantity;
  return { expectedQuantity, deviationRatio, flagged: deviationRatio > threshold };
}
