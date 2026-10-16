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
import { getVatRatePercent, resolveSalesBase } from "@/lib/services/sales-base";
import type { SalesBase } from "@/lib/services/sales-base";
import { getLaborBurden } from "@/lib/services/labor-burden";
import {
  calcularCostoPorcentual,
  foodSourceToLineSource,
  laborSourceToLineSource,
} from "@/lib/services/branch-cost-metrics";
import { weakestOf } from "@/lib/services/pnl-types";
import { cierreDelPeriodo } from "@/lib/company/period-close";
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

// --- Agregación de un período ----------------------------------------------

interface PeriodTotals {
  /** Venta CON IVA: lo que entró a la caja. */
  totalSalesCents: number;
  /** Base sobre la que se calculan los porcentajes (A3.2). */
  salesBase: SalesBase;
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

  const [salesRows, foodCosts, laborCosts, vatRatePercent] = await Promise.all([
    db
      .select({
        totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
        // A3.2 — el IVA viaja en la misma consulta agregada; la base neta no
        // debe costar un viaje más.
        taxSum: sql<number>`COALESCE(SUM(${dailySalesCuts.taxAmount}), 0)`,
        cutsWithTax: sql<number>`COUNT(${dailySalesCuts.taxAmount})`,
        cutsCount: sql<number>`COUNT(${dailySalesCuts.id})`,
      })
      .from(dailySalesCuts)
      .where(and(...salesConditions)),
    getFoodCostByBranch(companyId, startDay, endDay),
    getLaborCostByBranch(companyId, startDay, endDay),
    // C14.3 — con la tasa vigente al cierre del periodo: cambiar el IVA hoy no
    // debe cambiar cómo se leyó un mes que ya terminó.
    getVatRatePercent(companyId, cierreDelPeriodo(endDay)),
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

  const grossCents = Number(salesRows[0]?.totalSales ?? 0);

  return {
    totalSalesCents: grossCents,
    salesBase: resolveSalesBase({
      grossCents,
      taxCents: Number(salesRows[0]?.taxSum ?? 0),
      cutsWithTax: Number(salesRows[0]?.cutsWithTax ?? 0),
      cutsCount: Number(salesRows[0]?.cutsCount ?? 0),
      vatRatePercent,
    }),
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

  const [targets, burden, current, previous] = await Promise.all([
    getFinancialTargets(filter.companyId),
    getLaborBurden(filter.companyId, cierreDelPeriodo(endDay)),
    aggregatePeriod(filter.companyId, filter.branchId, startDay, endDay),
    aggregatePeriod(filter.companyId, filter.branchId, prevStartDay, prevEndDay),
  ]);

  const sales = current.totalSalesCents;
  const prevSales = previous.totalSalesCents;

  /**
   * A3.2 — el divisor de todos los porcentajes es la base, no la venta bruta.
   *
   * `sales` sigue siendo la venta con IVA porque es la cifra de ingresos que la
   * dueña reconoce; lo que cambia es contra qué se dividen los costos. Antes se
   * dividía entre la bruta y un food cost real del 34.8% se presentaba como
   * 30%, del lado verde del semáforo.
   */
  /**
   * C29 — la fórmula vive en `branch-cost-metrics`, compartida con la Liga de
   * Sucursales. Antes cada motor tenía su propia copia y podían divergir.
   */
  const actual = calcularCostoPorcentual({
    baseCents: current.salesBase.baseCents,
    salesBaseKind: current.salesBase.kind,
    foodCostCents: current.foodCostCents,
    laborCostCents: current.laborCostCents,
    foodSource: current.foodSource,
    laborSource: current.laborSource,
    burden,
    targets,
  });
  const anterior = calcularCostoPorcentual({
    baseCents: previous.salesBase.baseCents,
    salesBaseKind: previous.salesBase.kind,
    foodCostCents: previous.foodCostCents,
    laborCostCents: previous.laborCostCents,
    foodSource: previous.foodSource,
    laborSource: previous.laborSource,
    burden,
    targets,
  });

  const deltaPoints = (now: number | null, before: number | null): number | null =>
    now === null || before === null ? null : Number((now - before).toFixed(1));

  const branchLabel = filter.branchId
    ? "la sucursal"
    : `${current.branchCount} sucursal(es) del grupo`;

  const baseNota = current.salesBase.note;

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
      : `${
          current.laborSource === "MEASURED"
            ? `Sueldo sobre asistencia real de ${branchLabel}.`
            : current.laborSource === "SECTOR_DEFAULT"
              ? "Estimación sectorial HORECA. NO se calcula con tus datos."
              : `Plantilla contratada en lugar de asistencia real en al menos una de ${branchLabel}.`
        } ${burden.nota}`;

  const foodCost: KpiMetric = {
    cents: current.foodCostCents,
    percent: actual.foodPercent,
    status: actual.foodStatus,
    // La base estimada degrada la procedencia: un porcentaje calculado sobre un
    // IVA supuesto no es una medición, por muy medido que esté el numerador.
    source: actual.foodSource,
    note: `${foodNote} ${baseNota}`,
    deltaPoints: deltaPoints(actual.foodPercent, anterior.foodPercent),
  };

  const laborCost: KpiMetric = {
    // El importe es el cargado cuando hay factor: es el que se compara contra
    // el objetivo, y mostrar uno y comparar el otro sería peor que no cargarlo.
    cents: actual.laborCostCargadoCents,
    percent: actual.laborPercent,
    status: actual.laborStatus,
    source: actual.laborSource,
    note: `${laborNote} ${baseNota}`,
    deltaPoints: deltaPoints(actual.laborPercent, anterior.laborPercent),
  };

  // El combinado solo existe si ambos renglones existen. Sumar un food cost real
  // con un labor ausente produce un margen falsamente sano.
  const combinedCostPercent = actual.combinedCostPercent;
  const healthyMarginPercent = actual.healthyMarginPercent;

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
    healthyMarginStatus: actual.healthyMarginStatus,
    healthyMarginDeltaPoints: deltaPoints(
      actual.healthyMarginPercent,
      anterior.healthyMarginPercent,
    ),

    targets,
    weakestSource: weakestOf(current.foodSource, current.laborSource),
  };
}
