// lib/services/fefo-allocator.ts
//
// T14 (`tasks/plan-conteo-produccion-merma.md`, Phase 4): allocator FEFO
// (First-Expired-First-Out) extraído de `TheoreticalConsumptionService.
// deductItemFIFO` — que ya ordenaba por `expirationDate, createdAt`, o sea ya
// era FEFO aunque el nombre mintiera.
//
// `allocateFEFO` NO escribe: devuelve el desglose `[{batchId, qty, unitCost}]`
// que consume `quantity` del stock AVAILABLE de la sucursal, en orden de
// caducidad. El lock `FOR UPDATE` (R-3) hace que dos workflows de producción
// concurrentes en la misma sucursal no puedan asignar el mismo lote: la
// segunda transacción espera a que la primera escriba y haga commit.
//
// El llamador decide el alcance de la transacción: pasar el `tx` de un
// `db.transaction` para que el lock cubra también la escritura, o `db` directo
// para una asignación de solo lectura.

import { db } from "@/lib/db";
import { inventoryBatches } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

/** El `tx` que entrega `db.transaction` callback — derivado, sin `any`. */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** `db` directo o el `tx` de un `db.transaction` — misma API de queries. */
export type DbExecutor = typeof db | DbTransaction;

export interface FefoAllocation {
  batchId: string;
  /** Cantidad a descontar de este lote (exacta; la frontera integer es del llamador). */
  quantity: number;
  unitCost: number | null;
}

/**
 * Asigna `quantity` sobre los lotes AVAILABLE con `currentQuantity > 0`,
 * ordenados por caducidad (NULLs al final) y luego por antigüedad — la misma
 * forma que el antiguo `deductItemFIFO`. Devuelve el desglose sin escribir.
 *
 * Si el stock no alcanza, devuelve lo que haya (la suma puede ser menor que
 * `quantity`): el llamador decide qué hacer con el faltante.
 */
export async function allocateFEFO(
  executor: DbExecutor,
  itemId: string,
  branchId: string,
  quantity: number
): Promise<FefoAllocation[]> {
  if (!Number.isFinite(quantity) || quantity <= 0) return [];

  const batches = await executor
    .select({
      id: inventoryBatches.id,
      currentQuantity: inventoryBatches.currentQuantity,
      unitCost: inventoryBatches.unitCost,
      expirationDate: inventoryBatches.expirationDate,
      createdAt: inventoryBatches.createdAt,
    })
    .from(inventoryBatches)
    .where(
      and(
        eq(inventoryBatches.branchId, branchId),
        eq(inventoryBatches.itemId, itemId),
        eq(inventoryBatches.status, "AVAILABLE"),
        sql`${inventoryBatches.currentQuantity} > 0`
      )
    )
    .orderBy(inventoryBatches.expirationDate, inventoryBatches.createdAt)
    .for("update");

  const allocations: FefoAllocation[] = [];
  let remaining = quantity;

  for (const batch of batches) {
    if (remaining <= 0) break;

    const current = Number(batch.currentQuantity);
    const take = Math.min(current, remaining);
    if (take <= 0) continue;

    allocations.push({
      batchId: batch.id,
      quantity: take,
      unitCost: batch.unitCost === null ? null : Number(batch.unitCost),
    });
    remaining -= take;
  }

  return allocations;
}