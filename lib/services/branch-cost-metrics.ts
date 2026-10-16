// C29 — Definición compartida de los porcentajes de costo.
//
// H06: la Liga de Sucursales (QSR) y el motor financiero calculaban el mismo
// concepto con bases y fórmulas distintas. La vista de sucursales dividía entre
// venta bruta, no cargaba la nómina y, cuando faltaba un costo, inventaba 31.5%
// / 24.5% y lo etiquetaba como VERIFIED. El motor financiero ya usaba base neta
// (A3.2), carga patronal (A3.3) y objetivos del inquilino.
//
// Este módulo concentra la parte **pura** de esa definición —qué procedencia
// tiene un renglón, cómo se degrada cuando el divisor no se midió y cómo se
// combinan numerador, base y objetivos— para que ambos motores la compartan en
// vez de reimplementarla. No toca `db`: recibe agregados ya leídos.
//
// Lo que queda fuera a propósito: los fallbacks descriptivos (percentiles de
// sector) son de C30, que separa dato real, estimado y ausente. Aquí un renglón
// sin insumos vale `null`, nunca un porcentaje inventado.

import { weakestOf } from "@/lib/services/pnl-types";
import type { LineSource } from "@/lib/services/pnl-types";
import { costStatus, marginStatus } from "@/lib/services/financial-kpi-types";
import type { FinancialTargets, SemaphoreStatus } from "@/lib/services/financial-kpi-types";
import type { SalesBase } from "@/lib/services/sales-base";
import type { LaborBurden } from "@/lib/services/labor-burden";

/**
 * `FoodCostSource` → `LineSource`. Misma regla que `pnl-service`: PURCHASES es
 * un proxy sesgado (compras ≠ consumo) y se declara DERIVED, no MEASURED.
 */
export function foodSourceToLineSource(source: string, usedCostFallback: boolean): LineSource {
  switch (source) {
    case "CONSUMPTION":
      return usedCostFallback ? "DERIVED" : "MEASURED";
    case "INVENTORY_DIFF":
    case "PURCHASES":
      return "DERIVED";
    case "SECTOR_DEFAULT":
      return "SECTOR_DEFAULT";
    default:
      return "NO_DATA";
  }
}

/** `LaborCostSource` → `LineSource`. CONTRACT_ONLY es plantilla teórica: DERIVED. */
export function laborSourceToLineSource(source: string): LineSource {
  switch (source) {
    case "MEASURED":
      return "MEASURED";
    case "CONTRACT_ONLY":
      return "DERIVED";
    case "SECTOR_DEFAULT":
      return "SECTOR_DEFAULT";
    default:
      return "NO_DATA";
  }
}

/**
 * La procedencia de un porcentaje no puede ser más fuerte que su divisor.
 *
 * Un food cost medido al centavo, dividido entre una venta neta *estimada* con
 * la tasa de IVA configurada, ya no es una medición: es un cálculo derivado. Es
 * el mismo criterio de `weakestOf` en `pnl-types`, aplicado al denominador —que
 * hasta A3.2 nadie miraba porque se daba por hecho que era neto.
 */
export function degradarPorBase(source: LineSource, kind: SalesBase["kind"]): LineSource {
  if (source === "NO_DATA") return source;
  return kind === "NET_MEASURED" ? source : weakestOf(source, "DERIVED");
}

/**
 * A3.3 — nómina cargada cuando el grupo capturó el factor.
 *
 * El objetivo `laborCostTargetPercent` trae default 28.00, que es un número de
 * industria *cargado*. Comparar contra él un bruto medido pinta verde lo que no
 * lo está. Sin factor capturado se devuelve el bruto sin tocar.
 */
export function aplicarCargaLaboral(cents: number, burden: LaborBurden): number {
  if (burden.totalPercent === null) return cents;
  return Math.round(cents * (1 + burden.totalPercent / 100));
}

/** `%` sobre la base, o `null` si no hay base o el renglón no tiene datos. */
export function porcentajeSobreBase(
  cents: number,
  baseCents: number,
  source: LineSource,
): number | null {
  if (source === "NO_DATA" || baseCents <= 0) return null;
  return Number(((cents / baseCents) * 100).toFixed(1));
}

export interface CostoPorcentualInput {
  /** Base contra la que se divide (venta neta A3.2). */
  baseCents: number;
  /** Procedencia de esa base, para degradar numeradores. */
  salesBaseKind: SalesBase["kind"];
  /** Food cost del período, con la merma incluida (el KPI la incluye). */
  foodCostCents: number;
  /** Nómina bruta del período, antes de carga. */
  laborCostCents: number;
  /** Procedencia de cada numerador, ya mapeada a `LineSource`. */
  foodSource: LineSource;
  laborSource: LineSource;
  burden: LaborBurden;
  targets: FinancialTargets;
}

/** Los dos porcentajes de costo con su procedencia, estado y combinado. */
export interface CostoPorcentual {
  foodPercent: number | null;
  laborPercent: number | null;
  combinedCostPercent: number | null;
  healthyMarginPercent: number | null;
  foodSource: LineSource;
  laborSource: LineSource;
  foodStatus: SemaphoreStatus | null;
  laborStatus: SemaphoreStatus | null;
  healthyMarginStatus: SemaphoreStatus | null;
  /** Nómina ya cargada: es la cifra que se compara contra el objetivo. */
  laborCostCargadoCents: number;
}

/**
 * Aplica la fórmula única de food cost, labor cost y prime cost.
 *
 * Es la definición que deben compartir el motor financiero y la Liga de
 * Sucursales: misma base, misma carga, mismos objetivos. Un renglón sin datos
 * devuelve `null` —la UI muestra guion— y nunca un porcentaje inventado.
 */
export function calcularCostoPorcentual(input: CostoPorcentualInput): CostoPorcentual {
  const { baseCents, salesBaseKind, burden, targets } = input;

  const foodPercent = porcentajeSobreBase(input.foodCostCents, baseCents, input.foodSource);
  const laborCostCargadoCents = aplicarCargaLaboral(input.laborCostCents, burden);
  const laborPercent = porcentajeSobreBase(laborCostCargadoCents, baseCents, input.laborSource);

  // La base estimada degrada la procedencia del porcentaje.
  const foodSource = degradarPorBase(input.foodSource, salesBaseKind);
  const laborSource =
    burden.totalPercent === null
      ? degradarPorBase(input.laborSource, salesBaseKind)
      : weakestOf(degradarPorBase(input.laborSource, salesBaseKind), "DERIVED");

  const combinedCostPercent =
    foodPercent === null || laborPercent === null
      ? null
      : Number((foodPercent + laborPercent).toFixed(1));
  const healthyMarginPercent =
    combinedCostPercent === null ? null : Number((100 - combinedCostPercent).toFixed(1));

  return {
    foodPercent,
    laborPercent,
    combinedCostPercent,
    healthyMarginPercent,
    foodSource,
    laborSource,
    foodStatus:
      foodPercent === null
        ? null
        : costStatus(foodPercent, targets.foodCostTargetPercent, targets.foodCostWarnPercent),
    // Sin factor de carga el semáforo NO pinta: el objetivo por default (28%)
    // es un número cargado y el medido es bruto. Un color sobre esa comparación
    // afirma una salud que nadie calculó.
    laborStatus:
      laborPercent === null || burden.totalPercent === null
        ? null
        : costStatus(laborPercent, targets.laborCostTargetPercent, targets.laborCostWarnPercent),
    healthyMarginStatus:
      healthyMarginPercent === null
        ? null
        : marginStatus(
            healthyMarginPercent,
            targets.healthyMarginTargetPercent,
            targets.healthyMarginWarnPercent,
          ),
    laborCostCargadoCents,
  };
}
