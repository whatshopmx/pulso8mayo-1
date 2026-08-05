// P&L Fase 2 — Food cost real por sucursal.
//
// Sustituye la constante sectorial `ventas × 0.285` por el consumo de inventario
// realmente registrado, valorizado con el método de costeo de cada sucursal.
//
// Escalera de cálculo (docs/plan-pnl-real.md Fase 2):
//
//   1. CONSUMPTION — Σ movimientos USAGE + WASTE × costo(ítem). Es el más fiel
//                    y aprovecha la configuración por sucursal que ya existe.
//                    La MERMA se reporta aparte: es el renglón que justifica el
//                    precio del producto (decisión P2 del plan).
//   2. PURCHASES   — Σ RECEIVING × costo. Proxy grueso y SESGADO: una compra
//                    adelantada infla el costo de la semana. Se marca DERIVED.
//   3. NO_DATA     — sin movimientos. El fallback sectorial lo aplica
//                    `pnl-service`, que es quien conoce las ventas.
//
// INVENTORY_DIFF (inv. inicial + compras − inv. final) queda fuera: los conteos
// se guardan como `workflow_instances`, no como una tabla de conteos, y hoy no
// hay ninguno capturado. Ver `StockCountService.getStockCountHistory`.
//
// Lo que NO se usa, y por qué:
//   - `CostingService.getVarianceReport` — devuelve `variance: 0` hardcodeado y
//     escribe en `recipes` dentro de un método de lectura.
//   - COGS teórico desde recetas (`sales_entries × getRecipeCostDetail`) —
//     verificado contra la base: `select count(*) from sales_entries` = 0. La
//     ingesta de POS llena `daily_sales_cuts` (totales por turno/canal), no
//     venta a nivel platillo. Esa vía no existe hoy.
//
// Limitación declarada: `inventory_movements` no guarda el costo del momento,
// así que el costo se valoriza AL MOMENTO DEL CÁLCULO contra `inventory_items`.
// Recalcular un período pasado puede dar un número distinto si el costo del ítem
// cambió — por eso la Fase 3.3 congela el resultado en `pnl_snapshots`.

import { db } from "@/lib/db";
import { branches, companies, inventoryItems, inventoryMovements } from "@/lib/db/schema";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

export type FoodCostSource =
  | "CONSUMPTION" // movimientos USAGE + WASTE valorizados
  | "INVENTORY_DIFF" // inv. inicial + compras − inv. final (no implementado aún)
  | "PURCHASES" // RECEIVING del período (proxy grueso)
  | "SECTOR_DEFAULT"
  | "NO_DATA";

export type CostingMethod = "LAST_COST" | "AVERAGE_COST";

export interface BranchFoodCost {
  branchId: string;
  /** Consumo valorizado, SIN merma (la merma va aparte). */
  foodCostCents: number;
  /** Merma valorizada. Separada a propósito: es el número que el dueño quiere ver. */
  wasteCents: number;
  source: FoodCostSource;
  /** Método configurado para la sucursal. */
  costingMethod: CostingMethod;
  /**
   * `true` si el método configurado es AVERAGE_COST pero algún ítem no tiene
   * `average_cost` y se valorizó con `last_cost`. Degrada la confianza.
   */
  usedCostFallback: boolean;
  /** % de días del período con al menos un movimiento de consumo registrado. */
  coveragePercent: number;
  note: string;
}

/** Acepta "YYYY-MM-DD" o un ISO completo y devuelve "YYYY-MM-DD". */
function toDayString(value: string): string {
  return value.slice(0, 10);
}

function daysBetween(startDay: string, endDay: string): number {
  const ms =
    new Date(`${endDay}T00:00:00Z`).getTime() - new Date(`${startDay}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

interface MovementAggregate {
  branchId: string;
  type: string;
  /** Valorizado con `average_cost` y fallback a `last_cost`. */
  avgPreferredCents: number;
  /** Valorizado con `last_cost` y fallback a `average_cost`. */
  lastPreferredCents: number;
  /** Cantidad de líneas sin ningún costo capturado. */
  uncostedLines: number;
  /** Cantidad de líneas donde AVERAGE_COST tuvo que caer a `last_cost`. */
  avgFallbackLines: number;
  distinctDays: number;
}

/**
 * Costo de alimentos por sucursal para el período [startDate, endDate].
 *
 * Rendimiento: 3 consultas por company, independientes del número de sucursales
 * (requisito de la Fase 4). Nada de `getBranchMethod` por sucursal — el método
 * se resuelve en una sola lectura de `branches` + `companies`.
 */
export async function getFoodCostByBranch(
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<BranchFoodCost[]> {
  const startDay = toDayString(startDate);
  const endDay = toDayString(endDate);
  const periodStart = new Date(`${startDay}T00:00:00Z`);
  const periodEnd = new Date(`${endDay}T23:59:59.999Z`);
  const periodDays = daysBetween(startDay, endDay);

  // 1/3 — Sucursales + método de costeo efectivo (sucursal > company > default).
  const [branchRows, [company]] = await Promise.all([
    db
      .select({ id: branches.id, costingMethod: branches.costingMethod })
      .from(branches)
      .where(eq(branches.companyId, companyId)),
    db
      .select({ costingMethod: companies.costingMethod })
      .from(companies)
      .where(eq(companies.id, companyId)),
  ]);

  if (branchRows.length === 0) return [];

  const companyMethod: CostingMethod =
    company?.costingMethod === "AVERAGE_COST" ? "AVERAGE_COST" : "LAST_COST";
  const methodByBranch = new Map<string, CostingMethod>(
    branchRows.map((b) => [
      b.id,
      b.costingMethod === "AVERAGE_COST"
        ? "AVERAGE_COST"
        : b.costingMethod === "LAST_COST"
          ? "LAST_COST"
          : companyMethod,
    ]),
  );
  const branchIds = branchRows.map((b) => b.id);

  // 2/3 — Movimientos agregados por sucursal y tipo, valorizados en el motor.
  //
  // Se calculan LAS DOS valorizaciones (promedio-primero y último-primero) en la
  // misma pasada y se elige en memoria según el método de cada sucursal. Sale
  // más barato que un CASE por sucursal y mantiene esto en UNA consulta.
  //
  // `quantity_change` es negativo en USAGE/WASTE y positivo en RECEIVING, así
  // que se toma el valor absoluto para costear.
  const qty = sql<number>`ABS(${inventoryMovements.quantityChange})`;
  const avgPreferred = sql<number>`COALESCE(${inventoryItems.averageCost}, ${inventoryItems.lastCost}, 0)`;
  const lastPreferred = sql<number>`COALESCE(${inventoryItems.lastCost}, ${inventoryItems.averageCost}, 0)`;

  const aggregates: MovementAggregate[] = await db
    .select({
      branchId: inventoryMovements.branchId,
      type: sql<string>`${inventoryMovements.type}::text`,
      avgPreferredCents: sql<number>`COALESCE(SUM(${qty} * ${avgPreferred}), 0)`,
      lastPreferredCents: sql<number>`COALESCE(SUM(${qty} * ${lastPreferred}), 0)`,
      uncostedLines: sql<number>`COUNT(*) FILTER (WHERE ${inventoryItems.lastCost} IS NULL AND ${inventoryItems.averageCost} IS NULL)`,
      avgFallbackLines: sql<number>`COUNT(*) FILTER (WHERE ${inventoryItems.averageCost} IS NULL AND ${inventoryItems.lastCost} IS NOT NULL)`,
      distinctDays: sql<number>`COUNT(DISTINCT DATE(${inventoryMovements.timestamp}))`,
    })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
    .where(
      and(
        inArray(inventoryMovements.branchId, branchIds),
        gte(inventoryMovements.timestamp, periodStart),
        lte(inventoryMovements.timestamp, periodEnd),
      ),
    )
    .groupBy(inventoryMovements.branchId, inventoryMovements.type);

  const byBranch = new Map<string, Map<string, MovementAggregate>>();
  for (const a of aggregates) {
    const m = byBranch.get(a.branchId) ?? new Map<string, MovementAggregate>();
    m.set(a.type, a);
    byBranch.set(a.branchId, m);
  }

  return branchIds.map((branchId) => {
    const costingMethod = methodByBranch.get(branchId) ?? companyMethod;
    const rows = byBranch.get(branchId);

    const pick = (a: MovementAggregate | undefined) => {
      if (!a) return 0;
      return Math.round(
        Number(
          costingMethod === "AVERAGE_COST" ? a.avgPreferredCents : a.lastPreferredCents,
        ),
      );
    };

    const usage = rows?.get("USAGE");
    const waste = rows?.get("WASTE");
    const receiving = rows?.get("RECEIVING");

    const consumptionRows = [usage, waste].filter(Boolean) as MovementAggregate[];
    const uncosted = consumptionRows.reduce((n, a) => n + Number(a.uncostedLines), 0);
    const avgFallback =
      costingMethod === "AVERAGE_COST"
        ? consumptionRows.reduce((n, a) => n + Number(a.avgFallbackLines), 0)
        : 0;

    const fallbackNote =
      avgFallback > 0
        ? ` ${avgFallback} línea(s) sin costo promedio capturado se valorizaron con el último costo.`
        : "";
    const uncostedNote =
      uncosted > 0
        ? ` ${uncosted} línea(s) de ítems sin costo alguno quedaron en $0: captura su costo para que el número cierre.`
        : "";

    // --- Escalón 1: CONSUMPTION ------------------------------------------
    if (usage || waste) {
      const foodCostCents = pick(usage);
      const wasteCents = pick(waste);
      const daysWithMovements = Math.max(
        Number(usage?.distinctDays ?? 0),
        Number(waste?.distinctDays ?? 0),
      );

      return {
        branchId,
        foodCostCents,
        wasteCents,
        source: "CONSUMPTION" as const,
        costingMethod,
        usedCostFallback: avgFallback > 0,
        coveragePercent: Math.min(100, Math.round((daysWithMovements / periodDays) * 100)),
        note:
          `Consumo real de inventario (${daysWithMovements} de ${periodDays} días con movimientos), ` +
          `valorizado a ${costingMethod === "AVERAGE_COST" ? "costo promedio" : "último costo"}.` +
          `${wasteCents > 0 ? " La merma se reporta en su propio renglón." : ""}` +
          `${fallbackNote}${uncostedNote}`,
      };
    }

    // --- Escalón 3: PURCHASES (proxy sesgado) -----------------------------
    if (receiving) {
      const daysWithMovements = Number(receiving.distinctDays ?? 0);
      return {
        branchId,
        foodCostCents: pick(receiving),
        wasteCents: 0,
        source: "PURCHASES" as const,
        costingMethod,
        usedCostFallback: false,
        coveragePercent: Math.min(100, Math.round((daysWithMovements / periodDays) * 100)),
        note:
          `Aproximado con las COMPRAS del período (${daysWithMovements} de ${periodDays} días con recepciones), ` +
          `no con el consumo: no hay movimientos de salida capturados. Una compra adelantada infla ` +
          `este número y una semana sin compras lo desinfla. Registra el consumo para que sea real.`,
      };
    }

    // --- Sin datos --------------------------------------------------------
    return {
      branchId,
      foodCostCents: 0,
      wasteCents: 0,
      source: "NO_DATA" as const,
      costingMethod,
      usedCostFallback: false,
      coveragePercent: 0,
      note: "Sin movimientos de inventario en el período: el food cost no se puede calcular con tus datos",
    };
  });
}
