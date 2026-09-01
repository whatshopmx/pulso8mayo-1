// P&L Fase 3.1 — Contrato de salida con procedencia por renglón.
//
// Este módulo NO tiene dependencias de runtime (ni `db`, ni servicios): es el
// contrato compartido entre `pnl-service` (servidor) y `pnl-branch-table`
// (cliente), para que la UI pueda importar los tipos sin arrastrar Drizzle al
// bundle del navegador.
//
// Regla de diseño (docs/plan-pnl-real.md §3): un P&L parcialmente real solo es
// seguro de mostrar si cada renglón declara de dónde salió. Un número inventado
// etiquetado es aceptable; sin etiquetar, no.

/**
 * Procedencia de un renglón del P&L.
 *
 * - `MEASURED`       — calculado con los datos capturados del cliente.
 * - `DERIVED`        — calculado con datos del cliente pero por una vía
 *                      indirecta o sesgada (p. ej. food cost desde compras en
 *                      lugar de consumo, o nómina desde plantilla contratada en
 *                      lugar de asistencia real).
 * - `ESTIMATED`      — dato del cliente multiplicado por un parámetro que él
 *                      configuró pero que el sistema no midió (la tarifa de
 *                      comisión por canal). Es más débil que `DERIVED` —el
 *                      insumo clave no se observó en ningún lado— y más fuerte
 *                      que `SECTOR_DEFAULT`, porque la tasa es la suya y no una
 *                      constante de la industria.
 * - `SECTOR_DEFAULT` — constante sectorial aplicada sobre ventas. NO son datos
 *                      del cliente. Siempre debe ir marcado en la UI.
 * - `NO_DATA`        — no hay insumos para calcularlo. La UI muestra guion,
 *                      **nunca cero** (un cero se lee como "no gastamos nada").
 */
export type LineSource = "MEASURED" | "DERIVED" | "ESTIMATED" | "SECTOR_DEFAULT" | "NO_DATA";

/** Orden de confianza, de mejor a peor. Se usa para calcular `weakestLine`. */
const SOURCE_RANK: Record<LineSource, number> = {
  MEASURED: 0,
  DERIVED: 1,
  ESTIMATED: 2,
  SECTOR_DEFAULT: 3,
  NO_DATA: 4,
};

/** Devuelve la procedencia menos confiable del conjunto. */
export function weakestOf(...sources: LineSource[]): LineSource {
  return sources.reduce(
    (worst, s) => (SOURCE_RANK[s] > SOURCE_RANK[worst] ? s : worst),
    "MEASURED" as LineSource,
  );
}

/** `true` si el renglón se puede presentar como un número firme. */
export function isFirm(source: LineSource): boolean {
  return source === "MEASURED";
}

export interface PnLLine {
  cents: number;
  /**
   * Porcentaje sobre ventas netas.
   *
   * `null` cuando no hay ventas en el período (o el renglón es `NO_DATA`):
   * un 0% con ventas en cero es tan falso como el 28.5% que este plan corrige.
   * La UI debe renderizar `null` como guion.
   */
  percentOfSales: number | null;
  source: LineSource;
  /** Cobertura de ESTE renglón, no global (0-100). */
  coveragePercent: number;
  /** Explicación en español del método: "12 de 14 turnos capturados". */
  note: string;
}

export interface BranchPnL {
  branchId: string;
  branchName: string;
  sales: PnLLine;
  foodCost: PnLLine;
  /** Merma, separada del food cost (decisión P2 del plan). */
  waste: PnLLine;
  labor: PnLLine;
  operatingExpenses: PnLLine;
  /**
   * Comisiones de canal (Fase 4): TPV y agregadores.
   *
   * Opcional en el tipo, no por descuido: `pnl_snapshots.lines` guarda un
   * `BranchPnL` serializado, y los snapshots congelados antes de esta fase no
   * tienen el renglón. Marcarlo obligatorio haría que releer el histórico
   * mintiera sobre lo que ese período sabía de sí mismo.
   */
  commissions?: PnLLine;
  /** Desglose del renglón anterior. Ausente en snapshots anteriores a Fase 4. */
  commissionsByChannel?: CommissionBreakdownItem[];
  operatingProfit: PnLLine;
  /**
   * El renglón más débil del P&L. Si no es `MEASURED`, el margen operativo
   * NO es confiable y la UI debe marcarlo como aproximado.
   */
  weakestLine: LineSource;
}

/** Una línea del desglose de comisiones por canal, para el tooltip de la tabla. */
export interface CommissionBreakdownItem {
  /** Llave del canal (`tpv`, `rappi`, …). La etiqueta la resuelve `commission-types`. */
  channel: string;
  cents: number;
  /** Tarifa aplicada en bps, o `null` si el rango abarcó varias vigencias. */
  rateBps: number | null;
  /** `true` si el importe salió de la comisión conciliada y no de la tarifa. */
  measured: boolean;
}

/** Constantes sectoriales HORECA. Solo se usan como último recurso, etiquetadas. */
export const SECTOR_FOOD_COST_PERCENT = 28.5;
export const SECTOR_LABOR_COST_PERCENT = 26.2;

/** Construye un renglón `NO_DATA` consistente. */
export function noDataLine(note: string): PnLLine {
  return { cents: 0, percentOfSales: null, source: "NO_DATA", coveragePercent: 0, note };
}

/** Construye un renglón calculando el % sobre ventas (null si no hay ventas). */
export function line(
  cents: number,
  totalSalesCents: number,
  source: LineSource,
  coveragePercent: number,
  note: string,
): PnLLine {
  return {
    cents,
    percentOfSales:
      totalSalesCents > 0 ? Number(((cents / totalSalesCents) * 100).toFixed(1)) : null,
    source,
    coveragePercent: Math.max(0, Math.min(100, Math.round(coveragePercent))),
    note,
  };
}
