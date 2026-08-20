// lib/services/inventory-snapshot-service.ts
//
// T7-T8 (`tasks/plan-conteo-produccion-merma.md`, Phase 2): congela por fecha
// el stock calculado vs contado de cada SKU de alto valor (filtro 80/20).
//
// El stock del sistema (calculado) se lee del ESTADO RESULTANTE de
// `inventory_batches` (`SUM(current_quantity) WHERE status='AVAILABLE'`) — la
// misma definición que `StockCountService.getProductsWithStock`. No se vuelve
// a restar el consumo teórico por ventas: `TheoreticalConsumptionService.consume`
// ya lo descuenta de los lotes en tiempo real (OQ-4), y restarlo aquí lo
// contaría doble. `variance` (columna generada) captura así toda la deriva
// real: merma no capturada, robos, errores de captura.

import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, stockCounts, inventorySnapshots, branches } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { roundQty } from "./stock-count-service";
import { localDateString } from "@/lib/workflows/today";

export interface SnapshotRow {
  companyId: string;
  branchId: string;
  itemId: string;
  snapshotDate: string;
  calculatedStock: number;
  countedStock: number | null;
}

export class InventorySnapshotService {
  /**
   * Idempotente por el único `(companyId, branchId, itemId, snapshotDate)`:
   * correrlo dos veces el mismo día actualiza `calculatedStock`/`countedStock`
   * en vez de duplicar filas (AD-4).
   */
  static async buildSnapshot(companyId: string, branchId: string, date?: string | Date): Promise<number> {
    // A4/O-2: cuando la fecha no viene ya resuelta hay que traducir el instante
    // al día local de la SUCURSAL, no a UTC. `stock_counts.countDate` se sella
    // con ese mismo criterio, y el cruce de abajo es por igualdad de fecha: si
    // los dos lados no usan el mismo huso, el conteo de cierre no aparece.
    let snapshotDate: string;
    if (typeof date === "string") {
      snapshotDate = date;
    } else {
      const branch = await db.query.branches.findFirst({
        where: eq(branches.id, branchId),
      });
      snapshotDate = localDateString(date ?? new Date(), branch?.timezone);
    }

    // 1. SKUs del filtro 80/20 (misma definición que el conteo de inventario).
    const items = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.companyId, companyId),
          eq(inventoryItems.active, true),
          eq(inventoryItems.isHighValue, true)
        )
      );
    if (items.length === 0) return 0;

    const itemIds = items.map((i) => i.id);

    // 2. Stock calculado: suma de lotes AVAILABLE por ítem, en una sola query.
    const stockRows = await db
      .select({
        itemId: inventoryBatches.itemId,
        qty: sql<string>`COALESCE(sum(${inventoryBatches.currentQuantity}), 0)`,
      })
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.branchId, branchId),
          eq(inventoryBatches.status, "AVAILABLE"),
          inArray(inventoryBatches.itemId, itemIds)
        )
      )
      .groupBy(inventoryBatches.itemId);

    const calculatedByItem = new Map<string, number>(
      stockRows.map((r) => [r.itemId, roundQty(parseFloat(String(r.qty)))])
    );

    // 3. Último conteo físico del día por ítem (el más reciente gana).
    const countedRows = await db
      .selectDistinctOn([stockCounts.itemId], {
        itemId: stockCounts.itemId,
        countedQuantity: stockCounts.countedQuantity,
      })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.branchId, branchId),
          eq(stockCounts.countDate, snapshotDate),
          inArray(stockCounts.itemId, itemIds)
        )
      )
      .orderBy(stockCounts.itemId, sql`${stockCounts.createdAt} DESC`);

    const countedByItem = new Map<string, number>(
      countedRows.map((r) => [r.itemId, roundQty(parseFloat(String(r.countedQuantity)))])
    );

    // 4. Upsert: ON CONFLICT actualiza, nunca inserta duplicados.
    const rows: SnapshotRow[] = itemIds.map((itemId) => ({
      companyId,
      branchId,
      itemId,
      snapshotDate,
      calculatedStock: calculatedByItem.get(itemId) ?? 0,
      countedStock: countedByItem.get(itemId) ?? null,
    }));

    await db
      .insert(inventorySnapshots)
      .values(
        rows.map((r) => ({
          ...r,
          calculatedStock: String(r.calculatedStock),
          countedStock: r.countedStock === null ? null : String(r.countedStock),
        }))
      )
      .onConflictDoUpdate({
        target: [
          inventorySnapshots.companyId,
          inventorySnapshots.branchId,
          inventorySnapshots.itemId,
          inventorySnapshots.snapshotDate,
        ],
        set: {
          calculatedStock: sql`excluded.calculated_stock`,
          countedStock: sql`excluded.counted_stock`,
        },
      });

    return rows.length;
  }
}