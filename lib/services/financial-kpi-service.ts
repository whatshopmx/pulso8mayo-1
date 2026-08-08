// M13 / T31: Financial KPI Service — Food Cost % y Labor Cost % sobre ventas.
//
// Reescrito. Lo que hacía la versión anterior y por qué no podía quedarse:
//
//  - El food cost salía de `SUM(inventory_batches.initial_quantity * unit_cost)`
//    SIN filtro de fecha: sumaba el histórico completo de lotes contra las
//    ventas del período. El porcentaje empeoraba solo con el paso del tiempo.
//  - El labor cost multiplicaba minutos de `shift_sessions` (también sin filtro
//    de fecha) por $60 MXN/hora hardcodeados, igual para un lavaloza que para
//    un chef.
//  - Cuando cualquiera de los dos daba 0, caía a `ventas × 0.28` y `× 0.25`
//    SIN ETIQUETAR. El dashboard presentaba una constante inventada con la
//    misma tipografía que un dato medido — exactamente el pecado que
//    `docs/plan-pnl-real.md` corrigió en el P&L.
//  - Como resultado, el P&L del dashboard ejecutivo y las tarjetas de KPI de
//    /dashboard/sales daban números distintos para el mismo concepto y período.
//  - Disparaba una notificación de desviación DENTRO de un GET de lectura, con
//    `userId: companyId` (un id de empresa en el campo de usuario). Cada carga
//    del dashboard intentaba notificar.
//
// Ahora delega en los mismos servicios que el P&L (`food-cost-service` y
// `labor-cost-service`), declara la procedencia de cada renglón con el
// vocabulario de `pnl-types`, y lee los umbrales del tenant en vez de
// constantes de módulo.
//
// La alerta de desviación NO vive aquí: una lectura de dashboard no debe tener
// efectos. Corresponde a un job programado que compare el período cerrado.

import { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getFoodCostByBranch } from "@/lib/services/food-cost-service";
import { getLaborCostByBranch } from "@/lib/services/labor-cost-service";
import { getFinancialTargets } from "@/lib/services/tenant-config-service";
import { weakestOf } from "@/lib/services/pnl-types";
import { costStatus, marginStatus } from "@/lib/services/financial-kpi-types";
import type { LineSource } from "@/lib/services/pnl-types";
import type { FinancialKPIsResult, KpiMetric } from "@/lib/services/financial-kpi-types";

// El contrato vive en `financial-kpi-types` (sin Drizzle) para que la UI pueda
// importarlo sin arrastrar la capa de datos al bundle del navegador. Se
// reexporta aquí para no romper a quien ya importaba desde el servicio.
export type {
  FinancialKPIsResult,
  FinancialTargets,
  KpiMetric,
  SemaphoreStatus,
} from "@/lib/services/financial-kpi-types";

/** Ventana operativa HORECA por defecto, igual que `pnl-service`. */
const DEFAULT_PERIOD_DAYS = 30;

export interface FinancialKPIFilter {
  companyId: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

// --- Utilidades de período -------------------------------------------------

function toDayString(value: string): string {
  return value.slice(0, 10);
}

function daysBetween(startDay: string, endDay: string): number {
  const ms =
    new Date(`${endDay}T00:00:00Z`).getTime() - new Date(`${startDay}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

function shiftDay(day: string, deltaDays: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + deltaDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// --- Mapeo de procedencia ---------------------------------------------------

/**
 * `FoodCostSource` → `LineSource`. Misma regla que `pnl-service`: PURCHASES es
 * un proxy sesgado (compras ≠ consumo) y se declara DERIVED, no MEASURED.
 */
function foodSourceToLineSource(source: string, usedCostFallback: boolean): LineSource {
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
function laborSourceToLineSource(source: string): LineSource {
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

// --- Agregación de un período ----------------------------------------------

interface PeriodTotals {
  totalSalesCents: number;
  cutsCount: number;
  foodCostCents: number;
  foodSource: LineSource;
  foodBranchesWithData: number;
  laborCostCents: number;
  laborSource: LineSource;
  laborBranchesWithData: number;
  branchCount: number;
}

async function aggregatePeriod(
  companyId: string,
  branchId: string | undefined,
  startDay: string,
  endDay: string,
): Promise<PeriodTotals> {
  const salesConditions = [
    eq(dailySalesCuts.companyId, companyId),
    gte(dailySalesCuts.businessDate, startDay),
    lte(dailySalesCuts.businessDate, endDay),
  ];
  if (branchId) salesConditions.push(eq(dailySalesCuts.branchId, branchId));

  const [salesRows, foodCosts, laborCosts] = await Promise.all([
    db
      .select({
        totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
        cutsCount: sql<number>`COUNT(${dailySalesCuts.id})`,
      })
      .from(dailySalesCuts)
      .where(and(...salesConditions)),
    getFoodCostByBranch(companyId, startDay, endDay),
    getLaborCostByBranch(companyId, startDay, endDay),
  ]);

  // Ambos servicios devuelven todas las sucursales de la company; el filtro por
  // sucursal se aplica aquí para no multiplicar consultas.
  const food = branchId ? foodCosts.filter((f) => f.branchId === branchId) : foodCosts;
  const labor = branchId ? laborCosts.filter((l) => l.branchId === branchId) : laborCosts;

  const foodWithData = food.filter((f) => f.source !== "NO_DATA");
  const laborWithData = labor.filter((l) => l.source !== "NO_DATA");

  // La procedencia del agregado es la MÁS DÉBIL de las sucursales que aportan
  // datos: si una de cinco se calculó con compras, el total del grupo no puede
  // presentarse como medido.
  const foodSource: LineSource =
    foodWithData.length === 0
      ? "NO_DATA"
      : weakestOf(
          ...foodWithData.map((f) => foodSourceToLineSource(f.source, f.usedCostFallback)),
        );

  const laborSource: LineSource =
    laborWithData.length === 0
      ? "NO_DATA"
      : weakestOf(...laborWithData.map((l) => laborSourceToLineSource(l.source)));

  return {
    totalSalesCents: Number(salesRows[0]?.totalSales ?? 0),
    cutsCount: Number(salesRows[0]?.cutsCount ?? 0),
    // El food cost del KPI incluye la merma: la pregunta "¿cuánto de mi venta se
    // fue en insumos?" no distingue si el insumo se sirvió o se tiró. El P&L sí
    // los separa, porque ahí la merma es una línea accionable por sí misma.
    foodCostCents: foodWithData.reduce((sum, f) => sum + f.foodCostCents + f.wasteCents, 0),
    foodSource,
    foodBranchesWithData: foodWithData.length,
    laborCostCents: laborWithData.reduce((sum, l) => sum + l.totalCostCents, 0),
    laborSource,
    laborBranchesWithData: laborWithData.length,
    branchCount: branchId ? 1 : Math.max(food.length, labor.length),
  };
}

// --- API pública ------------------------------------------------------------

export async function calculateFinancialKPIs(
  filter: FinancialKPIFilter,
): Promise<FinancialKPIsResult> {
  const endDay = filter.endDate
    ? toDayString(filter.endDate)
    : new Date().toISOString().slice(0, 10);
  const startDay = filter.startDate
    ? toDayString(filter.startDate)
    : new Date(Date.now() - DEFAULT_PERIOD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const periodDays = daysBetween(startDay, endDay);

  // Período anterior: mismo largo, pegado al inicio del actual.
  const prevEndDay = shiftDay(startDay, -1);
  const prevStartDay = shiftDay(prevEndDay, -(periodDays - 1));

  const [targets, current, previous] = await Promise.all([
    getFinancialTargets(filter.companyId),
    aggregatePeriod(filter.companyId, filter.branchId, startDay, endDay),
    aggregatePeriod(filter.companyId, filter.branchId, prevStartDay, prevEndDay),
  ]);

  const sales = current.totalSalesCents;
  const prevSales = previous.totalSalesCents;

  /** % sobre ventas, o `null` si no hay base contra la cual dividir. */
  const pctOfSales = (cents: number, base: number, source: LineSource): number | null => {
    if (source === "NO_DATA" || base <= 0) return null;
    return Number(((cents / base) * 100).toFixed(1));
  };

  const foodPercent = pctOfSales(current.foodCostCents, sales, current.foodSource);
  const laborPercent = pctOfSales(current.laborCostCents, sales, current.laborSource);
  const prevFoodPercent = pctOfSales(previous.foodCostCents, prevSales, previous.foodSource);
  const prevLaborPercent = pctOfSales(previous.laborCostCents, prevSales, previous.laborSource);

  const deltaPoints = (now: number | null, before: number | null): number | null =>
    now === null || before === null ? null : Number((now - before).toFixed(1));

  const branchLabel = filter.branchId
    ? "la sucursal"
    : `${current.branchCount} sucursal(es) del grupo`;

  const foodNote =
    current.foodSource === "NO_DATA"
      ? "Sin movimientos de inventario en el período. No es un 0%: es un dato que falta."
      : current.foodSource === "MEASURED"
        ? `Consumo y merma valorizados desde movimientos de inventario de ${branchLabel}.`
        : current.foodSource === "SECTOR_DEFAULT"
          ? "Estimación sectorial HORECA. NO se calcula con tus datos."
          : `Cálculo indirecto (compras del período o costo con respaldo) en al menos una de ${branchLabel}.`;

  const laborNote =
    current.laborSource === "NO_DATA"
      ? "Sin contratos ni sesiones de turno en el período. No es un 0%: es un dato que falta."
      : current.laborSource === "MEASURED"
        ? `Sueldo bruto sobre asistencia real de ${branchLabel}. No incluye IMSS ni provisiones.`
        : current.laborSource === "SECTOR_DEFAULT"
          ? "Estimación sectorial HORECA. NO se calcula con tus datos."
          : `Plantilla contratada en lugar de asistencia real en al menos una de ${branchLabel}. No incluye IMSS ni provisiones.`;

  const foodCost: KpiMetric = {
    cents: current.foodCostCents,
    percent: foodPercent,
    status:
      foodPercent === null
        ? null
        : costStatus(foodPercent, targets.foodCostTargetPercent, targets.foodCostWarnPercent),
    source: current.foodSource,
    note: foodNote,
    deltaPoints: deltaPoints(foodPercent, prevFoodPercent),
  };

  const laborCost: KpiMetric = {
    cents: current.laborCostCents,
    percent: laborPercent,
    status:
      laborPercent === null
        ? null
        : costStatus(laborPercent, targets.laborCostTargetPercent, targets.laborCostWarnPercent),
    source: current.laborSource,
    note: laborNote,
    deltaPoints: deltaPoints(laborPercent, prevLaborPercent),
  };

  // El combinado solo existe si ambos renglones existen. Sumar un food cost real
  // con un labor ausente produce un margen falsamente sano.
  const combinedCostPercent =
    foodPercent === null || laborPercent === null
      ? null
      : Number((foodPercent + laborPercent).toFixed(1));

  const healthyMarginPercent =
    combinedCostPercent === null ? null : Number((100 - combinedCostPercent).toFixed(1));

  const prevCombined =
    prevFoodPercent === null || prevLaborPercent === null
      ? null
      : Number((prevFoodPercent + prevLaborPercent).toFixed(1));
  const prevMargin = prevCombined === null ? null : Number((100 - prevCombined).toFixed(1));

  return {
    period: { startDate: startDay, endDate: endDay, days: periodDays },
    previousPeriod: { startDate: prevStartDay, endDate: prevEndDay },

    totalSalesCents: sales,
    previousTotalSalesCents: prevSales,
    salesDeltaPercent:
      prevSales > 0 ? Number((((sales - prevSales) / prevSales) * 100).toFixed(1)) : null,
    cutsCount: current.cutsCount,

    foodCost,
    laborCost,

    combinedCostPercent,
    healthyMarginPercent,
    healthyMarginStatus:
      healthyMarginPercent === null
        ? null
        : marginStatus(
            healthyMarginPercent,
            targets.healthyMarginTargetPercent,
            targets.healthyMarginWarnPercent,
          ),
    healthyMarginDeltaPoints: deltaPoints(healthyMarginPercent, prevMargin),

    targets,
    weakestSource: weakestOf(current.foodSource, current.laborSource),
  };
}
