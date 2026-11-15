/** A percentage needs an observed denominator; absence is not success. */
export function observedPercent(part: unknown, total: unknown): number | null {
  const denominator = Number(total);
  const numerator = Number(part);
  if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(numerator)) return null;
  return Math.round((numerator / denominator) * 100);
}
