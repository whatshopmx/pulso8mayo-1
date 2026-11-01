// FC-03c — Detalle de los renglones del P&L que NO son documentos.
//
// Nómina, comisiones y utilidad operativa no tienen "documentos" que listar:
// son cálculos. Publicar una tabla de filas inventadas para ellas sería el
// mismo defecto que FC-03b evitó al devolver una estimación sectorial en
// `calculation` y no como movimiento de inventario. Así que este servicio
// devuelve `items: []` y una `calculation` con sus COMPONENTES, de modo que la
// suma de los componentes reproduzca exactamente el importe del renglón.
//
// La autoridad del importe es el P&L (`getPnLByBranch`), no este archivo: si
// mañana cambia la fórmula o el fallback sectorial, el detalle lo hereda sin
// poder discrepar. Los componentes se leen de la misma fuente que usa el P&L
// (`labor-cost-service`, `commission-service`) y, si no cuadran con el renglón,
// la consulta falla con 409 en vez de mostrar un desglose que no explica nada.
// Ese es el caso real de una lectura en dos pasos: entre una consulta y otra
// puede entrar un turno o un corte, y preferimos pedir que se repita antes que
// publicar una diferencia silenciosa.
//
// Límite explícito: la nómina aquí es sueldo BRUTO por contratos/asistencia
// (la misma medida del P&L), no recibos de `payroll_runs` ni costo patronal.
// La comisión es la del P&L, medida cuando la terminal la capturó y estimada
// con la tarifa cuando no. Ninguno de los dos es un pasivo contable.

import { ApiError } from "@/lib/api/error";
import { commissionChannelLabel } from "./commission-types";
import { getCommissionsByBranch } from "./commission-service";
import { getLaborCostByBranch } from "./labor-cost-service";
import { getPnLByBranch } from "./pnl-service";
import type { BranchPnL, LineSource, PnLLine } from "./pnl-types";

export const DERIVED_PNL_LINES = ["labor", "commissions", "operatingProfit"] as const;
export type DerivedPnlLine = (typeof DERIVED_PNL_LINES)[number];

/**
 * Una pieza del cálculo. `cents` va CON SIGNO: en el puente de utilidad la
 * venta suma y cada costo resta, de manera que la suma de componentes es el
 * importe del renglón sin que el consumidor tenga que recordar el signo.
 */
export interface CalculationComponent {
  key: string;
  label: string;
  cents: number;
  source: LineSource;
  /** Venta del canal sobre la que se aplicó la tarifa (comisiones). */
  baseCents?: number;
  /** Tarifa aplicada en bps; `null` si el rango abarcó varias vigencias. */
  rateBps?: number | null;
  vatBps?: number | null;
  /** Parte medida (conciliada con la terminal) del importe del canal. */
  measuredCents?: number;
}

export interface PnlCalculation {
  kind: "LABOR" | "COMMISSIONS" | "PROFIT_BRIDGE";
  cents: number;
  note: string;
  /** Su suma es `cents`. Vacía solo cuando el renglón es una estimación. */
  components: CalculationComponent[];
  /** Líneas que se explican pero NO se suman al importe (provisión aguinaldo). */
  informative?: CalculationComponent[];
  /** Nómina: empleados considerados por el servicio de costo laboral. */
  headcount?: number;
  /** Comisiones: venta valuada y venta de canales sin tarifa configurada. */
  coveredSalesCents?: number;
  uncoveredSalesCents?: number;
  /** Utilidad: el renglón más débil del P&L, que decide si el margen es firme. */
  weakestLine?: LineSource;
  /** Utilidad: base sobre la que se calculó el margen. */
  salesBaseKind?: "NET_MEASURED" | "NET_DERIVED" | "GROSS_DECLARED";
}

export interface DerivedPnlDetail {
  branchId: string;
  line: DerivedPnlLine;
  period: { startDate: string; endDate: string; days: number };
  page: number;
  pageSize: number;
  /** Siempre 0: estos renglones no exponen documentos, exponen un cálculo. */
  totalCount: number;
  totalCents: number;
  hasMore: boolean;
  source: LineSource;
  coveragePercent: number;
  basis: "CALCULATION";
  calculation: PnlCalculation;
  items: never[];
}

type Input = {
  companyId: string;
  branchId: string;
  line: DerivedPnlLine;
  period: { startDate: string; endDate: string; days: number };
  page: number;
  pageSize: number;
};

function exact(cents: number) {
  if (!Number.isSafeInteger(cents)) {
    throw ApiError.conflict("El importe excede el rango de centavos exactos.");
  }
  return cents;
}

/**
 * La suma de componentes tiene que ser el renglón publicado. Si no lo es, los
 * insumos cambiaron entre la lectura del P&L y la del desglose: se pide repetir
 * la consulta en vez de servir una explicación que no cuadra.
 */
function reconcile(components: CalculationComponent[], expected: number, message: string) {
  const sum = components.reduce((acc, component) => acc + exact(component.cents), 0);
  if (exact(sum) !== exact(expected)) throw ApiError.conflict(message);
  return sum;
}

function envelope(
  p: Input,
  line: PnLLine,
  calculation: PnlCalculation,
  extra: Partial<Pick<DerivedPnlDetail, "totalCount" | "hasMore">> = {},
): DerivedPnlDetail {
  return {
    branchId: p.branchId,
    line: p.line,
    period: p.period,
    page: p.page,
    pageSize: p.pageSize,
    totalCount: extra.totalCount ?? 0,
    totalCents: exact(line.cents),
    hasMore: extra.hasMore ?? false,
    source: line.source,
    coveragePercent: line.coveragePercent,
    basis: "CALCULATION",
    calculation,
    items: [],
  };
}

/**
 * Nómina: sueldo base devengado + horas extra y prima de día festivo.
 * Cuando el P&L recurrió a la constante sectorial, no hay desglose que dar y se
 * declara así — sin fabricar dos componentes que sumen un porcentaje inventado.
 */
async function laborDetail(p: Input, line: PnLLine): Promise<PnlCalculation> {
  const fromLaborService = line.source === "MEASURED" || line.source === "DERIVED";
  if (!fromLaborService) {
    return { kind: "LABOR", cents: line.cents, note: line.note, components: [] };
  }

  const breakdown = (await getLaborCostByBranch(p.companyId, p.period.startDate, p.period.endDate))
    .find((row) => row.branchId === p.branchId);
  if (!breakdown || breakdown.source === "NO_DATA") {
    throw ApiError.conflict("Los datos de nómina cambiaron durante la consulta. Vuelve a consultar el detalle.");
  }

  // El P&L colapsa CONTRACT_ONLY en DERIVED; el desglose conserva esa lectura.
  const source: LineSource = breakdown.source === "MEASURED" ? "MEASURED" : "DERIVED";
  if (source !== line.source || breakdown.coveragePercent !== line.coveragePercent) {
    throw ApiError.conflict("Los datos de nómina cambiaron durante la consulta. Vuelve a consultar el detalle.");
  }
  const components: CalculationComponent[] = [
    { key: "base", label: "Sueldo base devengado", cents: breakdown.baseCostCents, source },
    { key: "overtime", label: "Horas extra y prima de día festivo", cents: breakdown.overtimeCostCents, source },
  ];
  reconcile(components, line.cents, "Los datos de nómina cambiaron durante la consulta. Vuelve a consultar el detalle.");

  // La provisión de aguinaldo es informativa: el P&L no la suma y aquí tampoco.
  const informative: CalculationComponent[] | undefined =
    breakdown.provisionAguinaldoCents === undefined
      ? undefined
      : [{
          key: "aguinaldoProvision",
          label: "Provisión informativa de aguinaldo (no incluida en el importe)",
          cents: breakdown.provisionAguinaldoCents,
          source: "DERIVED",
        }];

  return {
    kind: "LABOR",
    cents: line.cents,
    note: line.note,
    components,
    ...(informative ? { informative } : {}),
    headcount: breakdown.headcount,
  };
}

/**
 * Comisiones: una pieza por canal con su venta valuada, tarifa e IVA. `measured`
 * indica que el importe salió de la terminal; el resto es la tarifa aplicada.
 */
async function commissionsDetail(p: Input, line: PnLLine): Promise<PnlCalculation> {
  const branchCommissions = (await getCommissionsByBranch(p.companyId, p.period.startDate, p.period.endDate))
    .find((row) => row.branchId === p.branchId);

  if ((branchCommissions?.source ?? "NO_DATA") !== line.source
    || (branchCommissions?.coveragePercent ?? 0) !== line.coveragePercent) {
    throw ApiError.conflict("Los datos de comisiones cambiaron durante la consulta. Vuelve a consultar el detalle.");
  }

  const components: CalculationComponent[] = (branchCommissions?.channels ?? []).map((channel) => ({
    key: channel.channel,
    label: commissionChannelLabel(channel.channel),
    cents: channel.commissionCents,
    source: channel.source,
    baseCents: channel.baseSalesCents,
    rateBps: channel.rateBps,
    vatBps: channel.vatBps,
    measuredCents: channel.measuredCents,
  }));

  // `NO_DATA` no tiene canales valuados: el renglón es cero porque no hay
  // tarifa, no porque Rappi no haya cobrado. La nota lo dice y no se suma nada.
  reconcile(components, line.cents, "Los datos de comisiones cambiaron durante la consulta. Vuelve a consultar el detalle.");

  return {
    kind: "COMMISSIONS",
    cents: line.cents,
    note: line.note,
    components,
    coveredSalesCents: branchCommissions?.coveredSalesCents ?? 0,
    uncoveredSalesCents: branchCommissions?.uncoveredSalesCents ?? 0,
  };
}

/**
 * Puente de utilidad: venta base menos los seis costos que el P&L resta. Los
 * componentes van con signo, así que su suma ES el margen operativo publicado.
 * No incluye la merma por separado de nada ni crea un séptimo costo: refleja la
 * fórmula vigente del P&L, incluida la caja chica.
 */
function profitBridge(branch: BranchPnL): PnlCalculation {
  const line = branch.operatingProfit;
  if (line.source === "NO_DATA") {
    return { kind: "PROFIT_BRIDGE", cents: line.cents, note: line.note, components: [] };
  }
  if (!branch.salesBase) {
    throw ApiError.conflict("El P&L no publicó la base de venta del periodo. Vuelve a consultar el detalle.");
  }

  const cost = (key: string, label: string, source: PnLLine) =>
    ({ key, label, cents: -source.cents, source: source.source }) satisfies CalculationComponent;

  const components: CalculationComponent[] = [
    {
      key: "salesBase",
      label: "Venta base del margen",
      cents: branch.salesBase.baseCents,
      source: branch.sales.source,
    },
    cost("foodCost", "Food cost", branch.foodCost),
    cost("waste", "Merma", branch.waste),
    cost("labor", "Nómina", branch.labor),
    cost("operatingExpenses", "Gastos operativos", branch.operatingExpenses),
    cost("commissions", "Comisiones de canal", branch.commissions ?? { ...line, cents: 0, source: "NO_DATA" }),
    cost("pettyCash", "Caja chica", branch.pettyCash ?? { ...line, cents: 0, source: "NO_DATA" }),
  ];
  reconcile(components, line.cents, "Los renglones del P&L cambiaron durante la consulta. Vuelve a consultar el detalle.");

  return {
    kind: "PROFIT_BRIDGE",
    cents: line.cents,
    note: line.note,
    components,
    weakestLine: branch.weakestLine,
    salesBaseKind: branch.salesBase.kind,
  };
}

/** Internal: la sesión y el alcance de sucursal ya se validaron en la frontera. */
export async function getDerivedPnlDetail(p: Input): Promise<DerivedPnlDetail> {
  const branch = (await getPnLByBranch(p.companyId, p.period.startDate, p.period.endDate))
    .find((row) => row.branchId === p.branchId);
  // Sucursal de otra empresa o inexistente: el P&L no la devuelve.
  if (!branch) throw ApiError.notFound("Sucursal no encontrada.");

  if (p.line === "labor") return envelope(p, branch.labor, await laborDetail(p, branch.labor));
  if (p.line === "commissions") {
    const line = branch.commissions;
    if (!line) throw ApiError.conflict("El P&L no publicó el renglón de comisiones. Vuelve a consultar el detalle.");
    return envelope(p, line, await commissionsDetail(p, line));
  }
  return envelope(p, branch.operatingProfit, profitBridge(branch));
}
