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
}

export const DEFAULT_CONTROL_TARGETS: ControlTargets = {
  // finzasordenes.md §7: las compras de emergencia deben quedar por debajo
  // del 5% del gasto; arriba del 10% el proceso de compra dejó de existir.
  emergencyTargetPercent: 5,
  emergencyWarnPercent: 10,
  // Mismo umbral que la alerta del grid de presupuestos (Task 9).
  budgetWarnConsumedPercent: 90,
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
