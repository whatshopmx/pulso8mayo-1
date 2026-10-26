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
import { branches, inventoryBatches, inventoryItems } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { allocateEligibleBatches, type AllocationRequest, type BatchAllocationPlan } from './batch-allocation-policy';

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

export type ScopedAllocationRequest = Pick<AllocationRequest, 'companyId' | 'branchId' | 'itemId' | 'quantity' | 'batchId'>;

/**
 * FEFO-04B-1: consulta común con alcance explícito y política del servidor.
 * Para descontar, executor debe ser la transacción que escribirá saldo/kardex:
 * pasar db sólo sirve como preview; el lock termina al finalizar la consulta.
 * No acepta reloj ni política del cliente. Hasta FEFO-10A, política desconocida
 * exige fecha y usa FEFO. El faltante se devuelve separado, sin escrituras.
 */
export async function allocateScopedBatches(executor: DbExecutor, request: ScopedAllocationRequest): Promise<BatchAllocationPlan> {
  const { companyId, branchId, itemId, quantity, batchId } = request;
  const scope = { companyId, branchId, itemId, quantity, batchId };
  // Validar la cantidad/alcance antes de consultar o tomar locks.
  allocateEligibleBatches([], { ...scope, now: new Date() });
  const batches = await executor.select({
    id: inventoryBatches.id, companyId: inventoryItems.companyId,
    branchId: inventoryBatches.branchId, itemId: inventoryBatches.itemId,
    status: inventoryBatches.status, currentQuantity: inventoryBatches.currentQuantity,
    unitCost: inventoryBatches.unitCost, expirationDate: inventoryBatches.expirationDate,
    receivedAt: inventoryBatches.receivedAt, createdAt: inventoryBatches.createdAt,
  }).from(inventoryBatches)
    .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
    .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
    .where(and(eq(inventoryItems.companyId, companyId), eq(branches.companyId, companyId),
      eq(inventoryBatches.branchId, branchId), eq(inventoryBatches.itemId, itemId),
      eq(inventoryBatches.status, 'AVAILABLE'), sql`${inventoryBatches.currentQuantity} > 0`,
      batchId !== undefined ? eq(inventoryBatches.id, batchId) : undefined))
    // Tomar locks en orden estable; el motor ordena después por FEFO.
    .orderBy(inventoryBatches.id)
    .for('update', { of: inventoryBatches });
  // El reloj se toma DESPUÉS del await: un lote puede vencer mientras espera.
  return allocateEligibleBatches(batches, { ...scope, now: new Date() });
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
