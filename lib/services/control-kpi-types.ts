// Contrato de los KPIs gerenciales de Control OC/OS (finzasordenes.md §7, Task 10).
//
// Igual que `financial-kpi-types.ts`, este módulo NO tiene dependencias de
// runtime (ni `db`, ni servicios): es el contrato compartido entre
// `control-kpi-service` (servidor) y la página `reports/control` (cliente),
// para que la UI importe los tipos sin arrastrar Drizzle al bundle.

import { costStatus, type SemaphoreStatus } from "@/lib/services/financial-kpi-types";

export type { SemaphoreStatus };

/**
 * Metas de control documental-financiero. A diferencia de food/labor cost
 * (que viven en `tenant_operating_config`), estas salen del documento de
 * negocio y todavía no son configurables por tenant — cuando lo sean, este
 * objeto pasa a ser el default igual que `DEFAULT_FINANCIAL_TARGETS`.
 */
export interface ControlTargets {
  /** % de compras de emergencia sobre el comprometido total. MENOR es mejor. */
  emergencyTargetPercent: number;
  emergencyWarnPercent: number;
  /** % de presupuesto consumido a partir del cual se enciende el ámbar. */
  budgetWarnConsumedPercent: number;
  /**
   * Dispersión tolerable del precio de un mismo insumo entre sucursales.
   * MENOR es mejor. El doc §7 pide el comparativo pero no fija el umbral; se
   * toma la tolerancia de conciliación de proveedores (5%) como meta.
   */
  priceSpreadTargetPercent: number;
  priceSpreadWarnPercent: number;
}

export const DEFAULT_CONTROL_TARGETS: ControlTargets = {
  // finzasordenes.md §7: las compras de emergencia deben quedar por debajo
  // del 5% del gasto; arriba del 10% el proceso de compra dejó de existir.
  emergencyTargetPercent: 5,
  emergencyWarnPercent: 10,
  // Mismo umbral que la alerta del grid de presupuestos (Task 9).
  budgetWarnConsumedPercent: 90,
  priceSpreadTargetPercent: 5,
  priceSpreadWarnPercent: 10,
};

// --- Ejecución presupuestal -------------------------------------------------

export interface BudgetExecution {
  budgetedCents: number;
  committedCents: number;
  /** presupuestado − comprometido. Negativo = sobregiro. */
  availableCents: number;
  /** committed − budgeted. Positivo = sobregiro. Es la "desviación" del doc §7. */
  deviationCents: number;
  /** `null` cuando no hay presupuesto capturado: 0% se leería como "no gastamos". */
  consumedPercent: number | null;
  /**
   * `true` cuando hay dinero comprometido contra un centro de costo sin
   * presupuesto capturado. No es lo mismo que un sobregiro: aquí nunca hubo
   * techo contra el cual medir, y es el hallazgo accionable.
   */
  unbudgeted: boolean;
  /** `null` = nada presupuestado y nada comprometido: la celda no dice nada. */
  status: SemaphoreStatus | null;
}

/**
 * Ejecución de una celda sucursal×centro.
 *
 * Semáforo: consumido ≤ warn → OK · ≤ 100% → WARNING · > 100% (sobregiro) o
 * gasto sin presupuesto → CRITICAL.
 */
export function computeBudgetExecution(
  budgetedCents: number | null,
  committedCents: number,
  targets: ControlTargets = DEFAULT_CONTROL_TARGETS,
): BudgetExecution {
  const budgeted = Math.max(0, budgetedCents ?? 0);
  const committed = Math.max(0, committedCents);
  const base = {
    budgetedCents: budgeted,
    committedCents: committed,
    availableCents: budgeted - committed,
    deviationCents: committed - budgeted,
  };

  if (budgeted === 0) {
    return {
      ...base,
      consumedPercent: null,
      unbudgeted: committed > 0,
      status: committed > 0 ? "CRITICAL" : null,
    };
  }

  const consumedPercent = (committed / budgeted) * 100;
  return {
    ...base,
    consumedPercent,
    unbudgeted: false,
    status: costStatus(consumedPercent, targets.budgetWarnConsumedPercent, 100),
  };
}

// --- Compras de emergencia --------------------------------------------------

export interface EmergencyShare {
  emergencyCents: number;
  /** Comprometido total del período (OC + OS), incluyendo las emergencias. */
  totalCents: number;
  /** `null` si no hubo gasto comprometido: no hay base sobre la cual medir. */
  percent: number | null;
  status: SemaphoreStatus | null;
  emergencyCount: number;
  totalCount: number;
}

/** % de emergencias sobre el comprometido. MENOR es mejor. */
export function computeEmergencyShare(
  input: { emergencyCents: number; totalCents: number; emergencyCount: number; totalCount: number },
  targets: ControlTargets = DEFAULT_CONTROL_TARGETS,
): EmergencyShare {
  const { emergencyCents, totalCents, emergencyCount, totalCount } = input;
  if (totalCents <= 0) {
    return { emergencyCents, totalCents, percent: null, status: null, emergencyCount, totalCount };
  }
  const percent = (emergencyCents / totalCents) * 100;
  return {
    emergencyCents,
    totalCents,
    percent,
    status: costStatus(percent, targets.emergencyTargetPercent, targets.emergencyWarnPercent),
    emergencyCount,
    totalCount,
  };
}

// --- Comparativo de precios entre sucursales --------------------------------

export interface PriceSpread {
  minCents: number;
  maxCents: number;
  /** (max − min) / min × 100. `null` si el mínimo es 0: no hay base. */
  spreadPercent: number | null;
  status: SemaphoreStatus | null;
}

/**
 * Dispersión del precio unitario de un mismo insumo entre sucursales.
 *
 * Se mide contra el precio MÁS BAJO, no contra el promedio: la pregunta del
 * dueño es "cuánto de más está pagando la sucursal cara respecto de la que
 * mejor compró", y ése es el ahorro recuperable.
 */
export function computePriceSpread(
  unitCosts: number[],
  targets: ControlTargets = DEFAULT_CONTROL_TARGETS,
): PriceSpread {
  const valid = unitCosts.filter((c) => Number.isFinite(c) && c > 0);
  if (valid.length === 0) {
    return { minCents: 0, maxCents: 0, spreadPercent: null, status: null };
  }
  const minCents = Math.min(...valid);
  const maxCents = Math.max(...valid);
  const spreadPercent = ((maxCents - minCents) / minCents) * 100;
  return {
    minCents,
    maxCents,
    spreadPercent,
    status: costStatus(spreadPercent, targets.priceSpreadTargetPercent, targets.priceSpreadWarnPercent),
  };
}

export interface ItemPriceByBranch {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  /** Precio unitario promedio ponderado por cantidad, en centavos. */
  unitCostCents: number;
  /** Líneas de OC que sustentan el promedio. */
  lines: number;
}

export interface ItemPriceComparisonRow extends PriceSpread {
  itemId: string;
  itemName: string;
  unit: string;
  branches: ItemPriceByBranch[];
  /** Sucursal que mejor compró y la que peor compró, para leer la fila de un golpe. */
  cheapestBranch: string;
  dearestBranch: string;
}

// --- Ranking de proveedores -------------------------------------------------

export interface SupplierRankingRow {
  supplierId: string;
  supplierName: string;
  /** Comprometido del mes con ese proveedor (OC + OS con proveedor asignado). */
  totalCents: number;
  purchaseOrders: number;
  serviceOrders: number;
  /** Participación sobre el gasto atribuido a proveedores del período. */
  sharePercent: number;
}

/** Reparte la participación porcentual sobre el total ya ordenado por monto. */
export function withSupplierShare(
  rows: Omit<SupplierRankingRow, "sharePercent">[],
): SupplierRankingRow[] {
  const total = rows.reduce((s, r) => s + r.totalCents, 0);
  return rows
    .map((r) => ({ ...r, sharePercent: total > 0 ? (r.totalCents / total) * 100 : 0 }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

// --- Resultado del reporte --------------------------------------------------

export interface BudgetExecutionRow extends BudgetExecution {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  accountingLine: string | null;
}

export interface ControlReportResult {
  /** Mes evaluado, "YYYY-MM". */
  month: string;
  /** Sucursal a la que se acotó el reporte, o `null` si abarca la empresa. */
  branchId: string | null;
  budgetExecution: {
    rows: BudgetExecutionRow[];
    totals: BudgetExecution;
  };
  emergencyShare: EmergencyShare;
  /**
   * Insumos comprados en más de una sucursal durante el mes, ordenados por
   * dispersión. Vacío cuando el alcance es una sola sucursal: comparar exige
   * al menos dos, y un GERENTE no debe ver precios de sucursales ajenas.
   */
  priceComparison: ItemPriceComparisonRow[];
  supplierRanking: SupplierRankingRow[];
  /** Sucursales dentro del alcance; la UI lo usa para explicar un comparativo vacío. */
  branchCount: number;
  targets: ControlTargets;
}

/** Agrega celdas en un total con el mismo semáforo que una celda individual. */
export function aggregateBudgetExecution(
  rows: BudgetExecution[],
  targets: ControlTargets = DEFAULT_CONTROL_TARGETS,
): BudgetExecution {
  const budgeted = rows.reduce((s, r) => s + r.budgetedCents, 0);
  const committed = rows.reduce((s, r) => s + r.committedCents, 0);
  const total = computeBudgetExecution(budgeted, committed, targets);
  // El total puede estar dentro de presupuesto y aun así esconder celdas sin
  // techo: se conserva la bandera para que la UI no la pierda al sumar.
  return { ...total, unbudgeted: rows.some((r) => r.unbudgeted) };
}
