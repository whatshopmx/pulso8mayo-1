/**
 * Contrato de confianza de la verificación por IA.
 *
 * La unidad canónica es una **fracción 0–1** (`0.92` = 92 %), que es lo que
 * devuelven los motores de visión y lo que documenta `EvidenceAiMetadata`.
 * El seed histórico escribió la misma magnitud como porcentaje (60–100), así
 * que la lectura encuentra ambas escalas y las normaliza en un solo lugar.
 *
 * Sin esta frontera, el consumidor multiplicaba por 100 sin mirar la unidad y
 * una confianza de 99 se mostraba como 9 900 %.
 */

/** Fracción 0–1, o `null` si el valor no es un número utilizable. */
export function normalizeConfidence(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0) return null;

  // 0–1 es la escala canónica. 1 < x ≤ 100 es el formato histórico en
  // porcentaje. Fuera de ese rango no se inventa un valor: se descarta.
  if (numeric <= 1) return numeric;
  if (numeric <= 100) return numeric / 100;
  return null;
}

/** Porcentaje entero 0–100 listo para mostrar, o `null` si no hay dato. */
export function confidencePercent(value: unknown): number | null {
  const ratio = normalizeConfidence(value);
  if (ratio === null) return null;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/** Un resultado se considera aprobado sólo con `passed === true` explícito. */
export function isAiPassed(value: unknown): boolean {
  return value === true || value === "true";
}
