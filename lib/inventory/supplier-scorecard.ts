// lib/inventory/supplier-scorecard.ts
//
// Lógica pura de cálculo de scorecard de proveedores (NOM-251, Puntualidad y Calidad).
// Pesos: Puntualidad (35%), Calidad/Faltantes (35%), Cadena de Frío NOM-251 (30%).

export type ScorecardTier = "EXCELENTE" | "ACEPTABLE" | "EN_RIESGO" | "CRITICO";

export interface ScorecardInput {
  onTimeDeliveries: number;
  totalDeliveries: number;
  flawlessReceivings: number;
  totalReceivings: number;
  claimsCount: number;
  compliantTempReadings: number;
  totalTempReadings: number;
}

export interface ScorecardResult {
  punctualityScore: number;
  qualityScore: number;
  nom251ComplianceScore: number;
  totalScore: number;
  tier: ScorecardTier;
}

export function computePunctualityScore(onTime: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((onTime / total) * 100)));
}

export function computeQualityScore(
  flawless: number,
  total: number,
  claimsCount: number
): number {
  if (total <= 0) {
    return claimsCount === 0 ? 100 : Math.max(0, 100 - claimsCount * 20);
  }
  const baseRate = (flawless / total) * 100;
  const penalty = claimsCount * 5;
  return Math.min(100, Math.max(0, Math.round(baseRate - penalty)));
}

export function computeNom251Score(compliant: number, total: number): number {
  if (total <= 0) return 100; // Si no hay perecederos con lectura requerida, pasa en 100
  return Math.min(100, Math.max(0, Math.round((compliant / total) * 100)));
}

export function resolveScorecardTier(score: number): ScorecardTier {
  if (score >= 90) return "EXCELENTE";
  if (score >= 75) return "ACEPTABLE";
  if (score >= 60) return "EN_RIESGO";
  return "CRITICO";
}

export function computeSupplierScorecard(input: ScorecardInput): ScorecardResult {
  const punctualityScore = computePunctualityScore(
    input.onTimeDeliveries,
    input.totalDeliveries
  );

  const qualityScore = computeQualityScore(
    input.flawlessReceivings,
    input.totalReceivings,
    input.claimsCount
  );

  const nom251ComplianceScore = computeNom251Score(
    input.compliantTempReadings,
    input.totalTempReadings
  );

  const totalScore = Math.round(
    punctualityScore * 0.35 + qualityScore * 0.35 + nom251ComplianceScore * 0.3
  );

  const tier = resolveScorecardTier(totalScore);

  return {
    punctualityScore,
    qualityScore,
    nom251ComplianceScore,
    totalScore,
    tier,
  };
}
