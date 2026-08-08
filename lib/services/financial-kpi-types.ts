// Contrato de los KPIs financieros (M13/T31).
//
// Igual que `pnl-types.ts`, este módulo NO tiene dependencias de runtime (ni
// `db`, ni servicios): es el contrato compartido entre `financial-kpi-service`
// (servidor) y `financial-kpi-cards` (cliente), para que la UI pueda importar
// los tipos sin arrastrar Drizzle al bundle del navegador.

import type { LineSource } from "@/lib/services/pnl-types";

export type SemaphoreStatus = "OK" | "WARNING" | "CRITICAL";

/**
 * Objetivos financieros del grupo (columnas de `tenant_operating_config`,
 * migración 0039), ya convertidos a número.
 */
export interface FinancialTargets {
  /** Food cost: MENOR es mejor. `target` = tope sano, `warn` = tope tolerable. */
  foodCostTargetPercent: number;
  foodCostWarnPercent: number;
  /** Labor cost: MENOR es mejor. */
  laborCostTargetPercent: number;
  laborCostWarnPercent: number;
  /** Margen: MAYOR es mejor. `target` = piso sano, `warn` = piso tolerable. */
  healthyMarginTargetPercent: number;
  healthyMarginWarnPercent: number;
}

/**
 * Reproducen los valores que estaban hardcodeados antes de la 0039, para que
 * ningún tenant existente cambie de lectura.
 */
export const DEFAULT_FINANCIAL_TARGETS: FinancialTargets = {
  foodCostTargetPercent: 30,
  foodCostWarnPercent: 35,
  laborCostTargetPercent: 28,
  laborCostWarnPercent: 32,
  healthyMarginTargetPercent: 45,
  healthyMarginWarnPercent: 35,
};

/**
 * Un KPI porcentual con su procedencia.
 *
 * `percent` es `null` cuando no hay base para calcularlo (sin ventas, o sin
 * datos del insumo). La UI debe renderizar guion, nunca cero: un 0% de food
 * cost se lee como "no gastamos nada en insumos".
 */
export interface KpiMetric {
  cents: number;
  percent: number | null;
  status: SemaphoreStatus | null;
  source: LineSource;
  /** Explicación en español del método de cálculo. */
  note: string;
  /** Puntos porcentuales contra el período anterior. `null` si no es comparable. */
  deltaPoints: number | null;
}

export interface FinancialKPIsResult {
  /** Período efectivamente evaluado, ya resuelto a días concretos. */
  period: { startDate: string; endDate: string; days: number };
  /** Período inmediatamente anterior del mismo largo, usado para los deltas. */
  previousPeriod: { startDate: string; endDate: string };

  totalSalesCents: number;
  previousTotalSalesCents: number;
  /** Variación porcentual de ventas. `null` si el período anterior fue cero. */
  salesDeltaPercent: number | null;
  cutsCount: number;

  foodCost: KpiMetric;
  laborCost: KpiMetric;

  /** Food + labor sobre ventas. `null` si alguno no es calculable. */
  combinedCostPercent: number | null;
  /** 100 − combinado. Es margen de contribución, NO utilidad operativa. */
  healthyMarginPercent: number | null;
  healthyMarginStatus: SemaphoreStatus | null;
  healthyMarginDeltaPoints: number | null;

  /** Umbrales del tenant con que se pintó cada semáforo. */
  targets: FinancialTargets;
  /** Procedencia más débil entre food y labor: si no es MEASURED, el margen es aproximado. */
  weakestSource: LineSource;
}

// --- Semáforos (puros, compartidos servidor/cliente) ------------------------

/** Costos: MENOR es mejor. */
export function costStatus(percent: number, target: number, warn: number): SemaphoreStatus {
  if (percent <= target) return "OK";
  if (percent <= warn) return "WARNING";
  return "CRITICAL";
}

/** Margen: MAYOR es mejor. */
export function marginStatus(percent: number, target: number, warn: number): SemaphoreStatus {
  if (percent >= target) return "OK";
  if (percent >= warn) return "WARNING";
  return "CRITICAL";
}
