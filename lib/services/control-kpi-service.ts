// KPIs gerenciales de Control OC/OS (finzasordenes.md §7, Task 10).
//
// Lee; no escribe. Cada KPI declara su base de cálculo para que la UI nunca
// tenga que adivinar si un número es medido o estimado (mismo criterio que
// `financial-kpi-service` con `LineSource`).
//
// Mes de atribución = mes de `created_at` del documento, igual que
// `budget-service.getCommitted` — no la fecha de aprobación ni la de pago.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branchBudgets,
  branches,
  costCenters,
  inventoryItems,
  purchaseOrderItems,
  purchaseOrders,
  salesEntries,
  serviceOrders,
  suppliers,
} from "@/lib/db/schema";
import { calculateFinancialKPIs } from "@/lib/services/financial-kpi-service";
import {
  OC_COMMITTING_STATUSES,
  OS_COMMITTING_STATUSES,
  getCommittedByPair,
} from "@/lib/services/budget-service";
import {
  aggregateBudgetExecution,
  computeBudgetExecution,
  computeEmergencyShare,
  computeFoodCostGap,
  computeOperatingExpenseRatio,
  computePriceSpread,
  withSupplierShare,
  DEFAULT_CONTROL_TARGETS,
  type BudgetExecutionRow,
  type ControlReportResult,
  type ControlTargets,
  type FoodCostComparison,
  type ItemPriceComparisonRow,
  type KpiMetric,
  type SupplierRankingRow,
} from "@/lib/services/control-kpi-types";

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mes del documento. Misma expresión que `budget-service`. */
const monthExpr = sql<string>`to_char(created_at, 'YYYY-MM')`;

export interface ControlReportFilter {
  companyId: string;
  /** "YYYY-MM". */
  month: string;
  /** Acota a una sucursal; `null`/ausente = toda la empresa. */
  branchId?: string | null;
}

interface CommitmentTotals {
  totalCents: number;
  totalCount: number;
  emergencyCents: number;
  emergencyCount: number;
}

const EMPTY_TOTALS: CommitmentTotals = {
  totalCents: 0,
  totalCount: 0,
  emergencyCents: 0,
  emergencyCount: 0,
};

interface SplitCommitmentTotals {
  /** Solo órdenes de servicio: es la base del gasto operativo % del doc §E. */
  os: CommitmentTotals;
  /** Solo órdenes de compra. */
  oc: CommitmentTotals;
  /** OS + OC: denominador del % de emergencias. */
  combined: CommitmentTotals;
}

/**
 * Comprometido del mes con su porción de emergencia, en DOS consultas
 * (una por tipo de documento). A diferencia de `getCommittedByPair`, aquí
 * NO se descartan los documentos sin centro de costo: el denominador del
 * % de emergencias es todo el gasto comprometido, esté atribuido o no.
 */
async function getCommitmentTotals(
  branchIds: string[],
  month: string,
): Promise<SplitCommitmentTotals> {
  if (branchIds.length === 0) {
    return { os: EMPTY_TOTALS, oc: EMPTY_TOTALS, combined: EMPTY_TOTALS };
  }

  const [osRows, ocRows] = await Promise.all([
    db
      .select({
        totalCents: sql<number>`coalesce(sum(${serviceOrders.amount}), 0)::int`,
        totalCount: sql<number>`count(*)::int`,
        emergencyCents: sql<number>`coalesce(sum(${serviceOrders.amount}) filter (where ${serviceOrders.urgency} = 'EMERGENCIA'), 0)::int`,
        emergencyCount: sql<number>`count(*) filter (where ${serviceOrders.urgency} = 'EMERGENCIA')::int`,
      })
      .from(serviceOrders)
      .where(
        and(
          inArray(serviceOrders.branchId, branchIds),
          inArray(serviceOrders.status, [...OS_COMMITTING_STATUSES]),
          sql`${monthExpr} = ${month}`,
        ),
      ),
    db
      .select({
        totalCents: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::int`,
        totalCount: sql<number>`count(*)::int`,
        emergencyCents: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}) filter (where ${purchaseOrders.purchaseType} = 'EMERGENCIA'), 0)::int`,
        emergencyCount: sql<number>`count(*) filter (where ${purchaseOrders.purchaseType} = 'EMERGENCIA')::int`,
      })
      .from(purchaseOrders)
      .where(
        and(
          inArray(purchaseOrders.branchId, branchIds),
          inArray(purchaseOrders.status, [...OC_COMMITTING_STATUSES]),
          sql`${monthExpr} = ${month}`,
        ),
      ),
  ]);

  const pick = (row: Record<string, unknown> | undefined): CommitmentTotals => ({
    totalCents: Number(row?.totalCents ?? 0),
    totalCount: Number(row?.totalCount ?? 0),
    emergencyCents: Number(row?.emergencyCents ?? 0),
    emergencyCount: Number(row?.emergencyCount ?? 0),
  });

  const os = pick(osRows[0]);
  const oc = pick(ocRows[0]);

  return {
    os,
    oc,
    combined: {
      totalCents: os.totalCents + oc.totalCents,
      totalCount: os.totalCount + oc.totalCount,
      emergencyCents: os.emergencyCents + oc.emergencyCents,
      emergencyCount: os.emergencyCount + oc.emergencyCount,
    },
  };
}

/**
 * Precio unitario promedio ponderado por insumo×sucursal, sobre líneas de OC
 * en estados que comprometen (una OC en borrador no es un precio pagado).
 *
 * Ponderado por cantidad y no promedio simple: dos cajas a $100 y una a $130
 * costaron $110 en promedio real, no $115.
 */
async function getPriceComparison(
  branchIds: string[],
  month: string,
  targets: ControlTargets,
): Promise<ItemPriceComparisonRow[]> {
  // Comparar exige al menos dos sucursales en el alcance.
  if (branchIds.length < 2) return [];

  const rows = await db
    .select({
      itemId: purchaseOrderItems.itemId,
      itemName: inventoryItems.name,
      unit: inventoryItems.unit,
      branchId: purchaseOrders.branchId,
      branchName: branches.name,
      branchCode: branches.code,
      unitCostCents: sql<number>`round(
        sum(${purchaseOrderItems.unitCost}::numeric * greatest(${purchaseOrderItems.orderedQuantity}, 1))
        / nullif(sum(greatest(${purchaseOrderItems.orderedQuantity}, 1)), 0)
      )::int`,
      lines: sql<number>`count(*)::int`,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.poId))
    .innerJoin(branches, eq(branches.id, purchaseOrders.branchId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, purchaseOrderItems.itemId))
    .where(
      and(
        inArray(purchaseOrders.branchId, branchIds),
        inArray(purchaseOrders.status, [...OC_COMMITTING_STATUSES]),
        sql`to_char(${purchaseOrders.createdAt}, 'YYYY-MM') = ${month}`,
      ),
    )
    .groupBy(
      purchaseOrderItems.itemId,
      inventoryItems.name,
      inventoryItems.unit,
      purchaseOrders.branchId,
      branches.name,
      branches.code,
    );

  const byItem = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byItem.get(r.itemId);
    if (list) list.push(r);
    else byItem.set(r.itemId, [r]);
  }

  const comparison: ItemPriceComparisonRow[] = [];
  for (const [itemId, itemRows] of byItem) {
    // Un insumo comprado en una sola sucursal no dice nada del comparativo.
    if (itemRows.length < 2) continue;

    const branchPrices = itemRows
      .map((r) => ({
        branchId: r.branchId,
        branchName: r.branchName,
        branchCode: r.branchCode,
        unitCostCents: Number(r.unitCostCents ?? 0),
        lines: Number(r.lines ?? 0),
      }))
      .sort((a, b) => a.unitCostCents - b.unitCostCents);

    const spread = computePriceSpread(
      branchPrices.map((b) => b.unitCostCents),
      targets,
    );
    if (spread.spreadPercent === null) continue;

    const cheapest = branchPrices[0];
    const dearest = branchPrices[branchPrices.length - 1];
    comparison.push({
      itemId,
      itemName: itemRows[0].itemName,
      unit: itemRows[0].unit,
      branches: branchPrices,
      cheapestBranch: cheapest.branchCode ?? cheapest.branchName,
      dearestBranch: dearest.branchCode ?? dearest.branchName,
      ...spread,
    });
  }

  // Primero lo caro de explicar: mayor dispersión arriba.
  return comparison.sort((a, b) => (b.spreadPercent ?? 0) - (a.spreadPercent ?? 0));
}

/**
 * Gasto del mes por proveedor (OC + OS). Los documentos sin proveedor asignado
 * quedan fuera: no son atribuibles y ensuciarían el ranking con una fila
 * "(sin proveedor)" que no se puede accionar.
 */
async function getSupplierRanking(
  companyId: string,
  branchIds: string[],
  month: string,
): Promise<SupplierRankingRow[]> {
  if (branchIds.length === 0) return [];

  const [ocRows, osRows] = await Promise.all([
    db
      .select({
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        totalCents: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::int`,
        docs: sql<number>`count(*)::int`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(
        and(
          eq(suppliers.companyId, companyId),
          inArray(purchaseOrders.branchId, branchIds),
          inArray(purchaseOrders.status, [...OC_COMMITTING_STATUSES]),
          sql`to_char(${purchaseOrders.createdAt}, 'YYYY-MM') = ${month}`,
        ),
      )
      .groupBy(purchaseOrders.supplierId, suppliers.name),
    db
      .select({
        supplierId: serviceOrders.supplierId,
        supplierName: suppliers.name,
        totalCents: sql<number>`coalesce(sum(${serviceOrders.amount}), 0)::int`,
        docs: sql<number>`count(*)::int`,
      })
      .from(serviceOrders)
      .innerJoin(suppliers, eq(suppliers.id, serviceOrders.supplierId))
      .where(
        and(
          eq(suppliers.companyId, companyId),
          inArray(serviceOrders.branchId, branchIds),
          inArray(serviceOrders.status, [...OS_COMMITTING_STATUSES]),
          sql`to_char(${serviceOrders.createdAt}, 'YYYY-MM') = ${month}`,
        ),
      )
      .groupBy(serviceOrders.supplierId, suppliers.name),
  ]);

  const merged = new Map<string, Omit<SupplierRankingRow, "sharePercent">>();
  const upsert = (
    supplierId: string,
    supplierName: string,
    cents: number,
    docs: number,
    kind: "oc" | "os",
  ) => {
    const current = merged.get(supplierId) ?? {
      supplierId,
      supplierName,
      totalCents: 0,
      purchaseOrders: 0,
      serviceOrders: 0,
    };
    current.totalCents += cents;
    if (kind === "oc") current.purchaseOrders += docs;
    else current.serviceOrders += docs;
    merged.set(supplierId, current);
  };

  for (const r of ocRows) {
    if (r.supplierId) upsert(r.supplierId, r.supplierName, Number(r.totalCents ?? 0), Number(r.docs ?? 0), "oc");
  }
  for (const r of osRows) {
    if (r.supplierId) upsert(r.supplierId, r.supplierName, Number(r.totalCents ?? 0), Number(r.docs ?? 0), "os");
  }

  return withSupplierShare([...merged.values()]);
}

/** Primer y último día del mes "YYYY-MM", en fechas locales "YYYY-MM-DD". */
function monthBounds(month: string): { startDate: string; endDate: string } {
  const [year, m] = month.split("-").map(Number);
  // Día 0 del mes siguiente = último día de éste, sin depender de UTC.
  const lastDay = new Date(year, m, 0).getDate();
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Food cost real vs. teórico del mes.
 *
 * El lado REAL se delega a `calculateFinancialKPIs`, que ya valoriza consumo y
 * merma con su procedencia (`MEASURED`/`DERIVED`/`SECTOR_DEFAULT`/`NO_DATA`) y
 * aplica las metas del tenant. Reimplementarlo aquí duplicaría esa lógica y
 * abriría la puerta a que las dos pantallas reporten food costs distintos.
 *
 * El lado TEÓRICO exige venta a nivel platillo (`sales_entries` × costeo de
 * receta). La ingesta de POS del repo llena `daily_sales_cuts` con totales por
 * turno, no venta por platillo, así que hoy esa vía no existe: se devuelve
 * `NO_DATA` con una nota que nombra el dato faltante, en vez de rellenar con el
 * real (que volvería la brecha 0 y escondería exactamente lo que se busca).
 */
async function getFoodCostComparison(
  companyId: string,
  branchId: string | null,
  month: string,
): Promise<FoodCostComparison> {
  const { startDate, endDate } = monthBounds(month);

  const [kpis, entryRows] = await Promise.all([
    calculateFinancialKPIs({
      companyId,
      branchId: branchId ?? undefined,
      startDate,
      endDate,
    }),
    // Se cuenta en vez de asumir: si algún día la ingesta empieza a poblar
    // sales_entries, la nota lo dice sola y queda claro qué falta implementar.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(salesEntries)
      .where(
        and(
          eq(salesEntries.companyId, companyId),
          branchId ? eq(salesEntries.branchId, branchId) : undefined,
          sql`to_char(${salesEntries.saleDate}, 'YYYY-MM') = ${month}`,
        ),
      ),
  ]);

  const entriesInMonth = Number(entryRows[0]?.n ?? 0);
  const theoretical: KpiMetric = {
    cents: 0,
    percent: null,
    status: null,
    source: "NO_DATA",
    note:
      entriesInMonth === 0
        ? "Requiere venta a nivel platillo en sales_entries; la ingesta de POS solo captura totales por turno en daily_sales_cuts. Sin ese dato no hay teórico — no es 0%."
        : `Hay ${entriesInMonth} venta(s) por platillo en el mes, pero el costeo teórico contra recetas todavía no está conectado a este reporte.`,
    deltaPoints: null,
  };

  return {
    real: kpis.foodCost,
    theoretical,
    gapPoints: computeFoodCostGap(kpis.foodCost.percent, theoretical.percent),
    salesCents: kpis.totalSalesCents,
  };
}

/**
 * Reporte de control del mes: ejecución presupuestal por sucursal×centro y
 * porcentaje de compras de emergencia.
 *
 * El alcance de sucursal ya viene resuelto por el llamador (la ruta aplica el
 * pin de GERENTE/SUPERVISOR): aquí `branchId` se respeta tal cual.
 */
export async function getControlReport(
  filter: ControlReportFilter,
  targets: ControlTargets = DEFAULT_CONTROL_TARGETS,
): Promise<ControlReportResult> {
  const { companyId, month } = filter;
  const branchId = filter.branchId ?? null;

  const branchConditions = [eq(branches.companyId, companyId), eq(branches.active, true)];
  if (branchId) branchConditions.push(eq(branches.id, branchId));

  const [branchRows, ccRows] = await Promise.all([
    db
      .select({ id: branches.id, name: branches.name, code: branches.code })
      .from(branches)
      .where(and(...branchConditions))
      .orderBy(asc(branches.name)),
    db
      .select()
      .from(costCenters)
      .where(and(eq(costCenters.companyId, companyId), eq(costCenters.active, true)))
      .orderBy(asc(costCenters.code)),
  ]);

  const branchIds = branchRows.map((b) => b.id);

  const [
    budgetRows,
    committedByPair,
    commitmentTotals,
    priceComparison,
    supplierRanking,
    foodCost,
  ] = await Promise.all([
      branchIds.length
        ? db
            .select({
              branchId: branchBudgets.branchId,
              costCenterId: branchBudgets.costCenterId,
              amount: branchBudgets.amount,
            })
            .from(branchBudgets)
            .where(and(inArray(branchBudgets.branchId, branchIds), eq(branchBudgets.month, month)))
        : Promise.resolve([]),
      getCommittedByPair(branchIds, month),
      getCommitmentTotals(branchIds, month),
      getPriceComparison(branchIds, month, targets),
      getSupplierRanking(companyId, branchIds, month),
      getFoodCostComparison(companyId, branchId, month),
    ]);

  const budgetByKey = new Map(
    budgetRows.map((r) => [`${r.branchId}:${r.costCenterId}`, r.amount]),
  );

  const rows: BudgetExecutionRow[] = branchRows.flatMap((b) =>
    ccRows.map((cc) => {
      const key = `${b.id}:${cc.id}`;
      const execution = computeBudgetExecution(
        budgetByKey.get(key) ?? null,
        committedByPair.get(key) ?? 0,
        targets,
      );
      return {
        branchId: b.id,
        branchName: b.name,
        branchCode: b.code,
        costCenterId: cc.id,
        costCenterCode: cc.code,
        costCenterName: cc.name,
        accountingLine: cc.accountingLine,
        ...execution,
      };
    }),
  );

  return {
    month,
    branchId,
    budgetExecution: {
      rows,
      totals: aggregateBudgetExecution(rows, targets),
    },
    emergencyShare: computeEmergencyShare(commitmentTotals.combined, targets),
    priceComparison,
    supplierRanking,
    foodCost,
    operatingExpense: computeOperatingExpenseRatio({
      serviceSpendCents: commitmentTotals.os.totalCents,
      salesCents: foodCost.salesCents,
      serviceOrderCount: commitmentTotals.os.totalCount,
    }),
    branchCount: branchRows.length,
    targets,
  };
}
