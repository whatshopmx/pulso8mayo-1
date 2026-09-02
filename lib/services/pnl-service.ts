// M16 / T40: P&L Service (Estado de Resultados Operativo por Sucursal)
//
// Utilidad Operativa = Ventas − Food Cost − Merma − Nómina − Gastos Operativos
// − Comisiones de canal.
//
// A3.2 — **La base de los porcentajes es la venta NETA cuando se puede.** Este
// encabezado decía "(neto, sin IVA)" y no era cierto: `daily_sales_cuts.
// total_sales` es la venta CON IVA, así que todos los porcentajes del estado se
// dividían entre una base inflada un 16% y un food cost real del 34.8% se
// presentaba como 30% — del lado verde del semáforo. Ahora la base la resuelve
// `sales-base.ts`, que la declara: medida cuando el POS exporta el impuesto,
// estimada con la tasa del inquilino cuando no, y bruta declarada cuando el
// inquilino apaga la estimación. `salesBase` viaja en el `BranchPnL` para que la
// pantalla pueda decir cuál se usó.
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
//  - Comisiones de canal como renglón propio (Fase 4 de finance-module-gaps).
//    Antes NO existían en el P&L: lo que Rappi se queda de cada pedido, que en
//    delivery es la diferencia entre ganar y perder, simplemente no aparecía en
//    la utilidad operativa. El renglón es `ESTIMATED` porque se calcula con la
//    tarifa negociada; el sistema no tiene ningún monto neto que medir.

import { db } from "@/lib/db";
import {
  dailySalesCuts,
  operatingExpenses,
  branches,
  pettyCashFunds,
  pettyCashTransactions,
} from "@/lib/db/schema";
import { eq, and, gte, lte, ne, sql } from "drizzle-orm";
import { getFoodCostByBranch } from "@/lib/services/food-cost-service";
import { getLaborCostByBranch } from "@/lib/services/labor-cost-service";
import { getCommissionsByBranch } from "@/lib/services/commission-service";
import { getVatRatePercent, resolveSalesBase } from "@/lib/services/sales-base";
import {
  SECTOR_FOOD_COST_PERCENT,
  SECTOR_LABOR_COST_PERCENT,
  line,
  noDataLine,
  weakestOf,
} from "@/lib/services/pnl-types";
import type {
  BranchPnL,
  CommissionBreakdownItem,
  LineSource,
  PnLLine,
} from "@/lib/services/pnl-types";

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

/**
 * Resuelve el período efectivo del P&L. Exportado para que la ruta lo publique
 * en `meta`: un entregable financiero sin período no se puede archivar ni
 * comparar, y el consumidor no debe tener que adivinar los defaults.
 */
export function resolvePnlPeriod(startDate?: string, endDate?: string) {
  // Sin período explícito se usan los últimos 30 días, que es la ventana
  // operativa HORECA y la que ya asumía la cobertura anterior.
  const endDate_ = endDate ? toDayString(endDate) : new Date().toISOString().slice(0, 10);
  const startDate_ = startDate
    ? toDayString(startDate)
    : new Date(Date.now() - DEFAULT_PERIOD_DAYS * 86_400_000).toISOString().slice(0, 10);
  return {
    startDate: startDate_,
    endDate: endDate_,
    days: daysBetween(startDate_, endDate_),
  };
}

export async function getPnLByBranch(
  companyId: string,
  startDate?: string,
  endDate?: string,
): Promise<BranchPnL[]> {
  const { startDate: startDay, endDate: endDay } = resolvePnlPeriod(startDate, endDate);
  const periodDays = daysBetween(startDay, endDay);

  const branchList = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  if (branchList.length === 0) return [];

  // 4 consultas en paralelo, todas agregadas por company. Ninguna escala con
  // el número de sucursales.
  const [salesRows, expenseRows, foodCosts, laborCosts, commissions, pettyCashRows] =
    await Promise.all([
    db
      .select({
        branchId: dailySalesCuts.branchId,
        totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
        // A3.2 — el IVA se agrega en la misma consulta: la base neta no debe
        // costar una consulta más por sucursal.
        taxSum: sql<number>`COALESCE(SUM(${dailySalesCuts.taxAmount}), 0)`,
        cutsWithTax: sql<number>`COUNT(${dailySalesCuts.taxAmount})`,
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
    getCommissionsByBranch(companyId, startDay, endDay),

    // A4.2 — caja chica agregada por sucursal, en la misma tanda paralela: es
    // una consulta más para toda la empresa, no una por sucursal.
    db
      .select({
        branchId: pettyCashFunds.branchId,
        totalOut: sql<number>`COALESCE(SUM(${pettyCashTransactions.amount}), 0)`,
        movements: sql<number>`COUNT(${pettyCashTransactions.id})`,
      })
      .from(pettyCashTransactions)
      .innerJoin(pettyCashFunds, eq(pettyCashTransactions.fundId, pettyCashFunds.id))
      .where(
        and(
          eq(pettyCashFunds.companyId, companyId),
          // Sólo las salidas: la reposición es el efectivo que **entra** al
          // fondo, y contarla como gasto cobraría dos veces la misma compra.
          eq(pettyCashTransactions.type, "OUT"),
          sql`${pettyCashTransactions.createdAt}::date BETWEEN ${startDay}::date AND ${endDay}::date`,
        ),
      )
      .groupBy(pettyCashFunds.branchId),
  ]);

  // Una sola lectura de la tasa para todo el grupo: es configuración del
  // inquilino, no de la sucursal.
  const vatRatePercent = await getVatRatePercent(companyId);

  const salesByBranch = new Map(salesRows.map((r) => [r.branchId, r]));
  const expenseByBranch = new Map(expenseRows.map((r) => [r.branchId, r]));
  const foodByBranch = new Map(foodCosts.map((f) => [f.branchId, f]));
  const laborByBranch = new Map(laborCosts.map((l) => [l.branchId, l]));
  const commissionByBranch = new Map(commissions.map((c) => [c.branchId, c]));
  const pettyCashByBranch = new Map(pettyCashRows.map((p) => [p.branchId, p]));

  return branchList.map((branch) => {
    const salesRow = salesByBranch.get(branch.id);
    const totalSalesCents = Number(salesRow?.totalSales ?? 0);
    const cutsCount = Number(salesRow?.cutsCount ?? 0);
    const daysCovered = Number(salesRow?.daysCovered ?? 0);

    /**
     * A3.2 — el divisor de TODOS los porcentajes del estado.
     *
     * El renglón de ventas sigue mostrando la venta bruta como importe —es el
     * dinero que entró y es lo que la dueña reconoce— pero los porcentajes se
     * calculan contra la base, que es neta cuando hay con qué. Mezclar las dos
     * cosas en una sola cifra es justo lo que producía el food cost optimista.
     */
    const salesBase = resolveSalesBase({
      grossCents: totalSalesCents,
      taxCents: Number(salesRow?.taxSum ?? 0),
      cutsWithTax: Number(salesRow?.cutsWithTax ?? 0),
      cutsCount,
      vatRatePercent,
    });
    const baseCents = salesBase.baseCents;

    // --- Ventas -----------------------------------------------------------
    const sales: PnLLine =
      cutsCount > 0
        ? line(
            totalSalesCents,
            baseCents,
            "MEASURED",
            (daysCovered / periodDays) * 100,
            `${daysCovered} de ${periodDays} días con corte registrado (${cutsCount} cortes). ${salesBase.note}`,
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
        baseCents,
        food.usedCostFallback && foodSource === "MEASURED" ? "DERIVED" : foodSource,
        food.coveragePercent,
        food.note,
      );
      waste =
        food.source === "CONSUMPTION"
          ? line(
              food.wasteCents,
              baseCents,
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
        Math.round(baseCents * (SECTOR_FOOD_COST_PERCENT / 100)),
        baseCents,
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
        baseCents,
        laborSource,
        labor.coveragePercent,
        labor.note,
      );
    } else if (totalSalesCents > 0) {
      laborLine = line(
        Math.round(baseCents * (SECTOR_LABOR_COST_PERCENT / 100)),
        baseCents,
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
            baseCents,
            "MEASURED",
            100,
            `${expenseCount} gasto(s) operativo(s) imputado(s) al período por fecha de pago, ` +
              `vencimiento o captura. Excluye los rechazados.`,
          )
        : noDataLine(
            "Sin gastos operativos capturados en el período. Renta, servicios y nómina de " +
              "administración no aparecen aquí si no se registran.",
          );

    // --- Caja chica -------------------------------------------------------
    //
    // MEASURED cuando hay movimientos: son salidas capturadas una por una con
    // su concepto, no una estimación. Un período sin movimientos NO es cero
    // medido: es "nadie registró nada", que en caja chica suele significar que
    // el fondo se está usando sin capturar.
    const pettyRow = pettyCashByBranch.get(branch.id);
    const pettyMovements = Number(pettyRow?.movements ?? 0);
    const pettyCashLine: PnLLine =
      pettyMovements > 0
        ? line(
            Number(pettyRow?.totalOut ?? 0),
            baseCents,
            "MEASURED",
            100,
            `${pettyMovements} salida(s) de caja chica capturadas en el período. ` +
              "No pasan por la cola de autorización de gastos: por eso existe el fondo.",
          )
        : noDataLine(
            "Sin salidas de caja chica capturadas en el período. Si la sucursal usó el fondo y " +
              "no lo registró, este renglón vacío deja la utilidad operativa sobreestimada.",
          );

    // --- Comisiones de canal ----------------------------------------------
    // `MEASURED` sólo cuando TODO el importe salió de comisiones conciliadas
    // contra el depósito de la terminal. En cuanto una parte se calcula con la
    // tarifa, el renglón entero es `ESTIMATED`: es lo más fuerte que se puede
    // afirmar de una suma con un sumando calculado.
    const commission = commissionByBranch.get(branch.id);
    const commissionsLine: PnLLine =
      !commission || commission.source === "NO_DATA"
        ? noDataLine(
            commission?.note ??
              "Sin ventas capturadas en el período: no hay comisiones que calcular.",
          )
        : line(
            commission.totalCommissionCents,
            baseCents,
            commission.source === "MEASURED" ? "MEASURED" : "ESTIMATED",
            commission.coveragePercent,
            commission.note,
          );

    const commissionsByChannel: CommissionBreakdownItem[] | undefined = commission
      ? commission.channels.map((c) => ({
          channel: c.channel,
          cents: c.commissionCents,
          rateBps: c.rateBps,
          measured: c.source === "MEASURED",
        }))
      : undefined;

    // --- Utilidad operativa -----------------------------------------------
    // Las comisiones entran en `weakestLine` (criterio F4.4). Consecuencia
    // buscada: un tenant con venta con tarjeta y sin tarifas configuradas deja
    // de verse "medido" — porque no lo está, le falta un costo real del renglón
    // de ingresos. La merma sigue fuera, como estaba: se explica dentro del
    // food cost y no es un insumo independiente del margen.
    // La caja chica **no** entra en `weakestLine`: un período sin movimientos
    // capturados es lo normal en una sucursal que no usó el fondo, y degradar
    // por eso el margen entero convertiría la ausencia de menudencias en una
    // advertencia sobre el P&L completo. Igual que la merma, se explica sola.
    const weakestLine = weakestOf(
      sales.source,
      foodCost.source,
      laborLine.source,
      operatingExpensesLine.source,
      commissionsLine.source,
    );

    // Un renglón NO_DATA vale 0 en la suma, pero el `weakestLine` avisa que el
    // margen está incompleto. Nunca se presenta como un número firme si algún
    // insumo no es MEASURED (regla §3.2 del plan).
    const totalCostCents =
      foodCost.cents +
      waste.cents +
      laborLine.cents +
      operatingExpensesLine.cents +
      commissionsLine.cents +
      // A4.2 — la caja chica es dinero que salió. Antes no estaba en esta suma
      // y la utilidad operativa venía inflada exactamente en ese monto.
      pettyCashLine.cents;
    // A3.2 — la utilidad sale de la venta NETA, no de la bruta. El IVA
    // trasladado no es dinero del restaurante: se cobra y se entera al SAT.
    // Restarle los costos a la venta con IVA inflaba la utilidad operativa
    // exactamente en el impuesto. Cuando no hay base neta, `baseCents` es la
    // bruta y el comportamiento es el de antes, declarado en la nota.
    const operatingProfitCents = baseCents - totalCostCents;

    const operatingProfit: PnLLine =
      sales.source === "NO_DATA"
        ? noDataLine("Sin ventas capturadas no hay margen que calcular.")
        : line(
            operatingProfitCents,
            baseCents,
            weakestLine === "MEASURED" ? "MEASURED" : "DERIVED",
            Math.min(
              sales.coveragePercent,
              foodCost.coveragePercent,
              laborLine.coveragePercent,
            ),
            weakestLine === "MEASURED"
              ? "Calculado con datos capturados en los cinco renglones."
              : `Aproximado: el renglón más débil del P&L es ${
                  weakestLine === "SECTOR_DEFAULT"
                    ? "una estimación sectorial"
                    : weakestLine === "NO_DATA"
                      ? "un renglón sin datos"
                      : weakestLine === "ESTIMATED"
                        ? "un cálculo con una tarifa configurada, no medida"
                        : "un cálculo indirecto"
                }.`,
          );

    return {
      branchId: branch.id,
      branchName: branch.name,
      sales,
      foodCost,
      waste,
      labor: laborLine,
      operatingExpenses: operatingExpensesLine,
      pettyCash: pettyCashLine,
      commissions: commissionsLine,
      commissionsByChannel,
      operatingProfit,
      weakestLine,
      salesBase,
    };
  });
}
