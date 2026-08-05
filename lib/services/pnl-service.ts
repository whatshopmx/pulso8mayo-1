// M16 / T40: P&L Service (Estado de Resultados Operativo por Sucursal)
//
// Utilidad Operativa = Ventas − Food Cost − Merma − Nómina − Gastos Operativos
// (neto, sin IVA).
//
// Reescrito según docs/plan-pnl-real.md. Lo que cambió y por qué:
//
//  - Food cost y nómina ya NO son constantes sectoriales (`ventas × 0.285` y
//    `× 0.262`). Se delegan a `food-cost-service` y `labor-cost-service`, que
//    calculan con los datos del cliente y declaran su procedencia. La constante
//    sectorial sobrevive solo como último recurso, SIEMPRE etiquetada.
//  - `dataCoveragePercent` global se eliminó: una cobertura única para cuatro
//    renglones de calidad distinta oculta exactamente el problema que este
//    servicio corrige. Ahora cada `PnLLine` trae su propia cobertura.
//  - La merma es un renglón propio (decisión P2).
//  - Los gastos operativos ahora SÍ se filtran por período. La versión anterior
//    sumaba el histórico completo contra las ventas del rango — un margen que
//    empeoraba solo con el paso del tiempo.
//  - Agregación por company con GROUP BY branch_id (Fase 4): ~6 consultas en
//    total, no ~5 por sucursal. Para 15 sucursales eso es la diferencia entre
//    ~75 consultas secuenciales y 6.

import { db } from "@/lib/db";
import { dailySalesCuts, operatingExpenses, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, ne, sql } from "drizzle-orm";
import { getFoodCostByBranch } from "@/lib/services/food-cost-service";
import { getLaborCostByBranch } from "@/lib/services/labor-cost-service";
import {
  SECTOR_FOOD_COST_PERCENT,
  SECTOR_LABOR_COST_PERCENT,
  line,
  noDataLine,
  weakestOf,
} from "@/lib/services/pnl-types";
import type { BranchPnL, LineSource, PnLLine } from "@/lib/services/pnl-types";

export type { BranchPnL, LineSource, PnLLine } from "@/lib/services/pnl-types";
export { weakestOf, isFirm } from "@/lib/services/pnl-types";

/** Días de referencia para la cobertura de ventas cuando no se acota el período. */
const DEFAULT_PERIOD_DAYS = 30;

function toDayString(value: string): string {
  return value.slice(0, 10);
}

function daysBetween(startDay: string, endDay: string): number {
  const ms =
    new Date(`${endDay}T00:00:00Z`).getTime() - new Date(`${startDay}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export async function getPnLByBranch(
  companyId: string,
  startDate?: string,
  endDate?: string,
): Promise<BranchPnL[]> {
  // Sin período explícito se usan los últimos 30 días, que es la ventana
  // operativa HORECA y la que ya asumía la cobertura anterior.
  const endDay = endDate ? toDayString(endDate) : new Date().toISOString().slice(0, 10);
  const startDay = startDate
    ? toDayString(startDate)
    : new Date(Date.now() - DEFAULT_PERIOD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const periodDays = daysBetween(startDay, endDay);

  const branchList = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  if (branchList.length === 0) return [];

  // 4 consultas en paralelo, todas agregadas por company. Ninguna escala con
  // el número de sucursales.
  const [salesRows, expenseRows, foodCosts, laborCosts] = await Promise.all([
    db
      .select({
        branchId: dailySalesCuts.branchId,
        totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
        cutsCount: sql<number>`COUNT(${dailySalesCuts.id})`,
        daysCovered: sql<number>`COUNT(DISTINCT ${dailySalesCuts.businessDate})`,
      })
      .from(dailySalesCuts)
      .where(
        and(
          eq(dailySalesCuts.companyId, companyId),
          gte(dailySalesCuts.businessDate, startDay),
          lte(dailySalesCuts.businessDate, endDay),
        ),
      )
      .groupBy(dailySalesCuts.branchId),

    // El gasto se imputa al período por su fecha efectiva: pago > vencimiento >
    // captura. Los rechazados no son costo.
    db
      .select({
        branchId: operatingExpenses.branchId,
        totalExp: sql<number>`COALESCE(SUM(${operatingExpenses.amount}), 0)`,
        expenseCount: sql<number>`COUNT(${operatingExpenses.id})`,
      })
      .from(operatingExpenses)
      .where(
        and(
          eq(operatingExpenses.companyId, companyId),
          ne(operatingExpenses.status, "REJECTED"),
          sql`COALESCE(${operatingExpenses.paidAt}::date, ${operatingExpenses.dueDate}, ${operatingExpenses.createdAt}::date) BETWEEN ${startDay}::date AND ${endDay}::date`,
        ),
      )
      .groupBy(operatingExpenses.branchId),

    getFoodCostByBranch(companyId, startDay, endDay),
    getLaborCostByBranch(companyId, startDay, endDay),
  ]);

  const salesByBranch = new Map(salesRows.map((r) => [r.branchId, r]));
  const expenseByBranch = new Map(expenseRows.map((r) => [r.branchId, r]));
  const foodByBranch = new Map(foodCosts.map((f) => [f.branchId, f]));
  const laborByBranch = new Map(laborCosts.map((l) => [l.branchId, l]));

  return branchList.map((branch) => {
    const salesRow = salesByBranch.get(branch.id);
    const totalSalesCents = Number(salesRow?.totalSales ?? 0);
    const cutsCount = Number(salesRow?.cutsCount ?? 0);
    const daysCovered = Number(salesRow?.daysCovered ?? 0);

    // --- Ventas -----------------------------------------------------------
    const sales: PnLLine =
      cutsCount > 0
        ? line(
            totalSalesCents,
            totalSalesCents,
            "MEASURED",
            (daysCovered / periodDays) * 100,
            `${daysCovered} de ${periodDays} días con corte registrado (${cutsCount} cortes).`,
          )
        : noDataLine(
            `Sin cortes de venta capturados en el período (${periodDays} días). ` +
              `Sube el corte diario del POS para que el P&L tenga base.`,
          );

    // --- Food cost y merma ------------------------------------------------
    const food = foodByBranch.get(branch.id);
    let foodCost: PnLLine;
    let waste: PnLLine;

    if (food && food.source !== "NO_DATA") {
      // PURCHASES es un proxy sesgado: se declara DERIVED, no MEASURED.
      const foodSource: LineSource = food.source === "CONSUMPTION" ? "MEASURED" : "DERIVED";
      foodCost = line(
        food.foodCostCents,
        totalSalesCents,
        food.usedCostFallback && foodSource === "MEASURED" ? "DERIVED" : foodSource,
        food.coveragePercent,
        food.note,
      );
      waste =
        food.source === "CONSUMPTION"
          ? line(
              food.wasteCents,
              totalSalesCents,
              "MEASURED",
              food.coveragePercent,
              food.wasteCents > 0
                ? "Merma registrada en inventario, valorizada al costo de la sucursal."
                : "Sin merma registrada en el período. Si hubo desperdicio y no se capturó, este cero no es real.",
            )
          : noDataLine("La merma solo se puede medir con movimientos de salida de inventario.");
    } else if (totalSalesCents > 0) {
      // Último recurso: constante sectorial, ETIQUETADA.
      foodCost = line(
        Math.round(totalSalesCents * (SECTOR_FOOD_COST_PERCENT / 100)),
        totalSalesCents,
        "SECTOR_DEFAULT",
        0,
        `Estimación sectorial HORECA (${SECTOR_FOOD_COST_PERCENT}% de ventas). ` +
          `NO se calcula con tus datos: no hay movimientos de inventario en el período.`,
      );
      waste = noDataLine("La merma no se puede estimar: requiere movimientos de inventario.");
    } else {
      foodCost = noDataLine(food?.note ?? "Sin movimientos de inventario en el período.");
      waste = noDataLine("Sin movimientos de inventario en el período.");
    }

    // --- Nómina -----------------------------------------------------------
    const labor = laborByBranch.get(branch.id);
    let laborLine: PnLLine;

    if (labor && labor.source !== "NO_DATA") {
      // CONTRACT_ONLY es plantilla teórica, no asistencia: DERIVED.
      const laborSource: LineSource = labor.source === "MEASURED" ? "MEASURED" : "DERIVED";
      laborLine = line(
        labor.totalCostCents,
        totalSalesCents,
        laborSource,
        labor.coveragePercent,
        labor.note,
      );
    } else if (totalSalesCents > 0) {
      laborLine = line(
        Math.round(totalSalesCents * (SECTOR_LABOR_COST_PERCENT / 100)),
        totalSalesCents,
        "SECTOR_DEFAULT",
        0,
        `Estimación sectorial HORECA (${SECTOR_LABOR_COST_PERCENT}% de ventas). ` +
          `NO se calcula con tus datos: no hay contratos vigentes en el período.`,
      );
    } else {
      laborLine = noDataLine(labor?.note ?? "Sin contratos vigentes en el período.");
    }

    // --- Gastos operativos ------------------------------------------------
    const expenseRow = expenseByBranch.get(branch.id);
    const expenseCount = Number(expenseRow?.expenseCount ?? 0);
    const operatingExpensesLine: PnLLine =
      expenseCount > 0
        ? line(
            Number(expenseRow?.totalExp ?? 0),
            totalSalesCents,
            "MEASURED",
            100,
            `${expenseCount} gasto(s) operativo(s) imputado(s) al período por fecha de pago, ` +
              `vencimiento o captura. Excluye los rechazados.`,
          )
        : noDataLine(
            "Sin gastos operativos capturados en el período. Renta, servicios y nómina de " +
              "administración no aparecen aquí si no se registran.",
          );

    // --- Utilidad operativa -----------------------------------------------
    const weakestLine = weakestOf(
      sales.source,
      foodCost.source,
      laborLine.source,
      operatingExpensesLine.source,
    );

    // Un renglón NO_DATA vale 0 en la suma, pero el `weakestLine` avisa que el
    // margen está incompleto. Nunca se presenta como un número firme si algún
    // insumo no es MEASURED (regla §3.2 del plan).
    const totalCostCents =
      foodCost.cents + waste.cents + laborLine.cents + operatingExpensesLine.cents;
    const operatingProfitCents = totalSalesCents - totalCostCents;

    const operatingProfit: PnLLine =
      sales.source === "NO_DATA"
        ? noDataLine("Sin ventas capturadas no hay margen que calcular.")
        : line(
            operatingProfitCents,
            totalSalesCents,
            weakestLine === "MEASURED" ? "MEASURED" : "DERIVED",
            Math.min(
              sales.coveragePercent,
              foodCost.coveragePercent,
              laborLine.coveragePercent,
            ),
            weakestLine === "MEASURED"
              ? "Calculado con datos capturados en los cuatro renglones."
              : `Aproximado: el renglón más débil del P&L es ${weakestLine === "SECTOR_DEFAULT" ? "una estimación sectorial" : weakestLine === "NO_DATA" ? "un renglón sin datos" : "un cálculo indirecto"}.`,
          );

    return {
      branchId: branch.id,
      branchName: branch.name,
      sales,
      foodCost,
      waste,
      labor: laborLine,
      operatingExpenses: operatingExpensesLine,
      operatingProfit,
      weakestLine,
    };
  });
}
