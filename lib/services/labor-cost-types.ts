// Contrato del costo laboral por sucursal (Fase 2 — plan-finance-module-gaps).
//
// Igual que `pnl-types.ts` y `financial-kpi-types.ts`, este módulo NO tiene
// dependencias de runtime (ni `db`, ni servicios): es el contrato compartido
// entre `labor-cost-service` (servidor) y `labor-cost-table` (cliente), para
// que la UI pueda importar los tipos sin arrastrar Drizzle al bundle del
// navegador.

/**
 * Procedencia del costo laboral. Es más fina que `LineSource` del P&L a
 * propósito: el P&L colapsa `CONTRACT_ONLY` en `DERIVED`, pero la pantalla de
 * costo laboral existe justamente para distinguir un ratio calculado sobre
 * asistencia real de uno calculado sobre plantilla contratada.
 *
 * - `MEASURED`      — contratos vigentes × días con turno COMPLETED.
 * - `CONTRACT_ONLY` — plantilla teórica: contratos × días laborables. No es
 *                     asistencia; no incluye faltas ni horas extra.
 * - `SECTOR_DEFAULT`— constante sectorial. No la produce este servicio (la
 *                     aplica `pnl-service`, que es quien conoce las ventas),
 *                     pero vive en el tipo porque el contrato es compartido.
 * - `NO_DATA`       — sin contratos vigentes. La UI muestra guion, **nunca
 *                     cero**: un 0% de costo laboral se lee como "no pagamos
 *                     nómina".
 */
export type LaborCostSource = "MEASURED" | "CONTRACT_ONLY" | "SECTOR_DEFAULT" | "NO_DATA";

export interface BranchLaborCost {
  branchId: string;
  /** Días trabajados × sueldo diario vigente. */
  baseCostCents: number;
  /** Horas extra (LFT art. 68/69) + prima de día festivo (art. 75). */
  overtimeCostCents: number;
  totalCostCents: number;
  headcount: number;
  source: LaborCostSource;
  /** % de días-empleado esperados del período que tienen sesión COMPLETED. */
  coveragePercent: number;
  note: string;
}

/**
 * Costo laboral de una sucursal contra su venta del período.
 *
 * `ratioPercent` es `null` — no cero — cuando falta cualquiera de los dos
 * lados: sin venta capturada no hay denominador, y sin contratos no hay
 * numerador. Un cero en cualquiera de esos casos afirma un dato que nadie
 * midió, que es el mismo defecto que corrige el P&L real.
 */
export interface BranchLaborRatio {
  branchId: string;
  branchName: string;
  /** Sueldo BRUTO del período: no incluye IMSS, INFONAVIT ni provisiones. */
  laborCostCents: number;
  baseCostCents: number;
  overtimeCostCents: number;
  headcount: number;
  /**
   * Nómina con carga patronal aplicada (A3.3). `null` cuando el grupo no ha
   * capturado `laborBurdenFactorPercent`: sin factor no se estima nada.
   *
   * Existe porque `laborCostTargetPercent` viene con default 28.00 — un número
   * de industria que ya trae IMSS, INFONAVIT, provisiones e ISN dentro— y lo
   * medido es bruto. El semáforo pintaba verde un 22% bruto que cargado ronda
   * el 29%, y nómina es el renglón que un QSR ajusta cada semana con la
   * programación de turnos.
   */
  loadedLaborCostCents: number | null;
  /** Costo cargado / base × 100. `null` sin factor capturado. */
  loadedRatioPercent: number | null;
  /** Desglose del factor, para que la nota pueda explicarlo. */
  burden: {
    /** % de carga patronal capturado por el grupo, o `null`. */
    factorPercent: number | null;
    /** % de ISN estatal capturado por el grupo, o `null`. */
    stateTaxPercent: number | null;
  };
  /** Base de venta contra la que se dividió. `null` cuando no hay cortes. */
  salesCents: number | null;
  /** Venta CON IVA del período, para poder contrastar las dos cifras. */
  grossSalesCents: number | null;
  /** De dónde salió la base: medida, estimada o bruta declarada (A3.2). */
  salesBaseKind: SalesBaseKind | null;
  /** Nota de la base de venta, lista para mostrarse al pie del ratio. */
  salesBaseNote: string | null;
  /** Costo laboral / base × 100, redondeado a un decimal. */
  ratioPercent: number | null;
  source: LaborCostSource;
  /** Cobertura de la asistencia (0-100), no de las ventas. */
  coveragePercent: number;
  note: string;
  /** Días del período con corte de venta capturado. */
  salesDaysCovered: number;
}

/** Reexportado para que la UI no tenga que importar la capa de datos. */
export type SalesBaseKind = "NET_MEASURED" | "NET_DERIVED" | "GROSS_DECLARED";

/** Objetivos y período que acompañan al arreglo de sucursales. */
export interface LaborCostReport {
  branches: BranchLaborRatio[];
  targets: {
    laborCostTargetPercent: number;
    laborCostWarnPercent: number;
  };
  period: { startDate: string; endDate: string; days: number };
}
