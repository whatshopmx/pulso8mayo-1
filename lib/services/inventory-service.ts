import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, suppliers, inventoryPriceHistory, inventoryTransfers, inventoryTransferItems, inventoryWaste, inventoryPeriods, companies, branches } from "@/lib/db/schema";
import { eq, and, sql, desc, inArray, gte, lte, or, ilike, ne } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { allocateFEFO, type DbExecutor } from "./fefo-allocator";

/**
 * C17.3 — pertenencia de sucursales y artículos a la empresa, para el recorrido
 * de transferencias. La creación aceptaba destino, artículos y lote del cuerpo
 * sin comprobar de qué empresa eran; con una sucursal ajena de destino se
 * montaba una transferencia que `shipTransfer` descontaba del lote que hallara.
 *
 * Falla con 400 nombrando lo que no cuadra (no un 500 genérico): quien lo
 * ve recarga el catálogo, no investiga un stack.
 */
async function assertBranchesOfCompany(companyId: string, branchIds: string[]): Promise<void> {
    const unicas = [...new Set(branchIds)];
    if (unicas.length === 0) return;

    const propias = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(inArray(branches.id, unicas), eq(branches.companyId, companyId)));

    if (propias.length !== unicas.length) {
        throw ApiError.badRequest(
            "La sucursal seleccionada no existe para esta empresa. Recarga el catálogo e inténtalo de nuevo."
        );
    }
}

async function assertItemsOfCompany(companyId: string, itemIds: string[]): Promise<void> {
    const unicos = [...new Set(itemIds)];
    if (unicos.length === 0) return;

    const propios = await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(inArray(inventoryItems.id, unicos), eq(inventoryItems.companyId, companyId)));

    if (propios.length !== unicos.length) {
        throw ApiError.badRequest(
            "Uno o más artículos no pertenecen a esta empresa. Recarga el catálogo e inténtalo de nuevo."
        );
    }
}

/** `tx` de `db.transaction` o `db`: la misma API de queries que usa el servicio. */
type TxLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Entrada de `recordMovement`: el movimiento que mueve el saldo del lote. */
export interface RecordMovementInput {
  branchId: string;
  itemId: string;
  batchId?: string;
  type: 'RECEIVING' | 'USAGE' | 'ADJUSTMENT' | 'TRANSFER' | 'WASTE' | 'RETURN';
  quantityChange: number;
  reason?: string;
  performedBy: string;
  referenceId?: string;
  fromLocationId?: string;
  toLocationId?: string;
}

async function loadTransferInTx(tx: TxLike, transferId: string) {
    const [transfer] = await tx.select()
        .from(inventoryTransfers)
        .where(eq(inventoryTransfers.id, transferId))
        .limit(1);
    return transfer ?? null;
}

/**
 * Las dos sucursales de la transferencia —origen y destino— son de la empresa.
 * Sólo sucursales: `inventory_transfers` no guarda empresa, y su alcance se
 * resuelve por las sucursales que une.
 */
async function transferBelongsToCompany(
    tx: TxLike,
    companyId: string,
    transfer: { fromBranchId: string; toBranchId: string },
): Promise<boolean> {
    const propias = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(
            inArray(branches.id, [transfer.fromBranchId, transfer.toBranchId]),
            eq(branches.companyId, companyId),
        ));
    const ids = new Set(propias.map((row) => row.id));
    return ids.has(transfer.fromBranchId) && ids.has(transfer.toBranchId);
}

export class InventoryService {

    // --- Items ---

    static async getItems(companyId: string, search?: string) {
        const conditions = [
            eq(inventoryItems.companyId, companyId),
            eq(inventoryItems.active, true),
        ];

        if (search) {
            conditions.push(
                or(
                    ilike(inventoryItems.name, `%${search}%`),
                    ilike(inventoryItems.sku, `%${search}%`),
                    ilike(inventoryItems.barcode, `%${search}%`),
                )
            );
        }

        return db.select()
            .from(inventoryItems)
            .where(and(...conditions));
    }

    static async getItem(id: string) {
        return db.query.inventoryItems.findFirst({
            where: eq(inventoryItems.id, id)
        });
    }

    /** Fase 4: regla 80/20 — máx. 30 SKUs de alto valor por empresa. */
    static async assertHighValueLimit(companyId: string, excludeItemId?: string) {
        const rows = await db
            .select({ n: sql<number>`count(*)` })
            .from(inventoryItems)
            .where(
                and(
                    eq(inventoryItems.companyId, companyId),
                    eq(inventoryItems.isHighValue, true),
                    excludeItemId ? ne(inventoryItems.id, excludeItemId) : undefined
                )
            );
        return Number(rows[0]?.n ?? 0);
    }

    static async createItem(data: typeof inventoryItems.$inferInsert & { userId?: string }) {
        // Fase 4: no exceder 30 SKUs de alto valor al crear.
        if (data.isHighValue && data.companyId) {
            const current = await this.assertHighValueLimit(data.companyId);
            if (current >= 30) {
                throw new Error(
                    `Límite de SKUs de alto valor alcanzado (${current} de 30). Marca máximo 30 SKUs (los que concentran el 80% del costo) para no abandonar el conteo semanal.`
                );
            }
        }

        const [item] = await db.insert(inventoryItems).values(data).returning();

        // Initial Price History Logic if cost is provided
        if (data.lastCost && data.userId) {
            await db.insert(inventoryPriceHistory).values({
                itemId: item.id,
                newCost: data.lastCost,
                changedBy: data.userId,
            });
        }

        return item;
    }

    static async updateItem(id: string, data: Partial<typeof inventoryItems.$inferInsert>, userId?: string, executor?: DbExecutor) {
        const q = executor ?? db;
        // Fase 4: si se enciende isHighValue, validar el límite de 30 SKUs.
        if (data.isHighValue === true) {
            const currentItem = await this.getItem(id);
            if (currentItem?.companyId && !currentItem.isHighValue) {
                const current = await this.assertHighValueLimit(currentItem.companyId, id);
                if (current >= 30) {
                    throw new Error(
                        `Límite de SKUs de alto valor alcanzado (${current} de 30). Desmarca otro SKU antes de marcar este como alto valor.`
                    );
                }
            }
        }

        // 1. Check if cost changed
        if (data.lastCost !== undefined && userId) {
            const currentItem = await this.getItem(id);
            if (currentItem && currentItem.lastCost !== data.lastCost) {
                await q.insert(inventoryPriceHistory).values({
                    itemId: id,
                    previousCost: currentItem.lastCost,
                    newCost: data.lastCost,
                    supplierId: data.supplierId || currentItem.supplierId,
                    changedBy: userId,
                });
            }
        }

        const [item] = await q.update(inventoryItems)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(inventoryItems.id, id))
            .returning();
        return item;
    }

    // --- Batches ---

    static async getBatches(itemId: string, branchId: string) {
        return db.select()
            .from(inventoryBatches)
            .where(
                and(
                    eq(inventoryBatches.itemId, itemId),
                    eq(inventoryBatches.branchId, branchId)
                )
            )
            .orderBy(desc(inventoryBatches.expirationDate));
    }

    static async createBatch(data: typeof inventoryBatches.$inferInsert) {
        const [batch] = await db.insert(inventoryBatches).values(data).returning();
        return batch;
    }

    /**
     * Alta de un lote recibido: crea el lote y registra su movimiento de entrada
     * en una sola transacción, con **un único dueño del incremento**.
     *
     * Antes cada llamador creaba el lote con `currentQuantity = quantity` y
     * después registraba el movimiento `RECEIVING` con `quantityChange = quantity`;
     * `recordMovement` vuelve a sumar sobre el lote, así que recibir 10 dejaba 20.
     * El lote nace en cero y sólo el movimiento lo incrementa: `currentQuantity`
     * queda como la suma del ledger, no como una segunda fuente de verdad.
     *
     * El lote resultante se relee dentro de la transacción para devolver el saldo
     * ya aplicado (el `INSERT` en cero no es el saldo final) junto con el
     * movimiento que lo incrementó.
     */
    static async createReceivingBatch(
        batchData: Omit<typeof inventoryBatches.$inferInsert, 'currentQuantity'>,
        movement: Omit<RecordMovementInput, 'batchId'>,
        executor?: DbExecutor
    ) {
        const run = async (q: DbExecutor) => {
            const [batch] = await q
                .insert(inventoryBatches)
                .values({ ...batchData, currentQuantity: '0' })
                .returning();

            const recordedMovement = await InventoryService.recordMovement(
                { ...movement, batchId: batch.id },
                q
            );

            const [updated] = await q
                .select()
                .from(inventoryBatches)
                .where(eq(inventoryBatches.id, batch.id))
                .limit(1);

            return { batch: updated ?? batch, movement: recordedMovement };
        };

        // Sin executor abre su propia transacción (llamador suelto); con executor
        // se une a la transacción de la recepción para que lote, movimiento y
        // reporte sean atómicos.
        if (!executor) return db.transaction((tx) => run(tx));
        return run(executor);
    }

    // --- Transactions (Movements) ---

  static async recordMovement(data: RecordMovementInput, executor?: DbExecutor) {
   // Si el llamador ya está dentro de una transacción (p.ej. un `db.transaction`
   // que tomó `FOR UPDATE` en el allocator FEFO), correr en esa misma conexión:
   // abrir otra aquí haría que sus escrituras esperaran el lock del lote que
   // esta transacción ya tomó → deadlock. Por defecto, transacción propia.
   const run = async (q: DbExecutor) => {
   const [movement] = await q.insert(inventoryMovements).values({
   branchId: data.branchId,
   itemId: data.itemId,
   batchId: data.batchId,
   type: data.type,
   quantityChange: String(data.quantityChange), // numeric(12,4): string en TS
   reason: data.reason,
   performedBy: data.performedBy,
   referenceId: data.referenceId,
   fromLocationId: data.fromLocationId,
   toLocationId: data.toLocationId,
   }).returning();

            // 2. Update Batch if exists
            if (data.batchId) {
                await q.update(inventoryBatches)
                    .set({
                        currentQuantity: sql`${inventoryBatches.currentQuantity} + ${data.quantityChange}`,
                        updatedAt: new Date()
                    })
                    .where(eq(inventoryBatches.id, data.batchId));
            }

            // 3. Recalculate averageCost for RECEIVING
            if (data.type === 'RECEIVING') {
             const batches = await q.select({
              unitCost: inventoryBatches.unitCost,
              currentQuantity: inventoryBatches.currentQuantity,
             })
              .from(inventoryBatches)
              .where(
               and(
                eq(inventoryBatches.itemId, data.itemId),
                eq(inventoryBatches.branchId, data.branchId),
                eq(inventoryBatches.status, 'AVAILABLE'),
                sql`${inventoryBatches.unitCost} IS NOT NULL`,
               )
              );

             if (batches.length > 0) {
              const totalQty = batches.reduce((s, b) => s + Number(b.currentQuantity), 0);
              const totalCost = batches.reduce((s, b) => s + Number(b.currentQuantity) * Number(b.unitCost), 0);
              const avgCost = totalQty > 0 ? Math.round(totalCost / totalQty) : 0;

              await q.update(inventoryItems)
               .set({
                averageCost: avgCost,
                averageCostUpdatedAt: new Date(),
                lastCost: batches[batches.length - 1]?.unitCost ?? avgCost,
                updatedAt: new Date(),
               })
               .where(eq(inventoryItems.id, data.itemId));
             }
            }

            return movement;
        };

   if (!executor || executor === db) {
     return db.transaction((tx) => run(tx));
   }
   return run(executor);
    }

    // --- Period Validation ---

    static async ensureOpenPeriod(companyId: string, branchId: string, tx?: any) {
     const dbTx = tx || db;
     const openPeriod = await dbTx.query.inventoryPeriods.findFirst({
      where: and(
       eq(inventoryPeriods.branchId, branchId),
       eq(inventoryPeriods.status, 'OPEN'),
       gte(inventoryPeriods.periodEnd, new Date()),
      ),
      orderBy: desc(inventoryPeriods.periodStart),
     });

     if (openPeriod) return openPeriod;

     const lastClosed = await dbTx.query.inventoryPeriods.findFirst({
      where: and(
       eq(inventoryPeriods.branchId, branchId),
       eq(inventoryPeriods.status, 'CLOSED'),
      ),
      orderBy: desc(inventoryPeriods.periodEnd),
     });

     const periodStart = lastClosed ? lastClosed.periodEnd : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
     const [period] = await dbTx.insert(inventoryPeriods).values({
      companyId,
      branchId,
      periodStart,
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'OPEN',
     }).returning();

     return period;
    }

    static async getStockLevel(itemId: string, branchId: string) {
        // Sum of all generic available batches
        const result = await db.select({
            total: sql<number>`sum(${inventoryBatches.currentQuantity})`
        })
            .from(inventoryBatches)
            .where(
                and(
                    eq(inventoryBatches.itemId, itemId),
                    eq(inventoryBatches.branchId, branchId),
                    eq(inventoryBatches.status, 'AVAILABLE')
                )
            );

        return Number(result[0]?.total || 0);
    }

    static async getMovements(itemId: string, branchId: string) {
        return db.select()
            .from(inventoryMovements)
            .where(
                and(
                    eq(inventoryMovements.itemId, itemId),
                    eq(inventoryMovements.branchId, branchId)
                )
            )
            .orderBy(desc(inventoryMovements.timestamp));
    }

    // --- Suppliers ---

    static async getSuppliers(companyId: string) {
        return db.select()
            .from(suppliers)
            .where(
                and(
                    eq(suppliers.companyId, companyId),
                    eq(suppliers.active, true)
                )
            )
            .orderBy(desc(suppliers.createdAt));
    }

    static async getSupplier(id: string) {
        return db.query.suppliers.findFirst({
            where: eq(suppliers.id, id)
        });
    }

    // --- Stock Management ---

    static async getAllStockLevels(branchId: string) {
        // Get all items with their total stock levels for a branch
        const result = await db.select({
            itemId: inventoryBatches.itemId,
            totalStock: sql<number>`sum(${inventoryBatches.currentQuantity})`,
            batchCount: sql<number>`count(${inventoryBatches.id})`,
        })
        .from(inventoryBatches)
        .where(
            and(
                eq(inventoryBatches.branchId, branchId),
                eq(inventoryBatches.status, 'AVAILABLE')
            )
        )
        .groupBy(inventoryBatches.itemId);

        return result;
    }

    static async getItemsWithLowStock(branchId: string, minLevel?: number) {
        // Get items where total stock is below minimum level
        const stockLevels = await db.select({
            itemId: inventoryBatches.itemId,
            totalStock: sql<number>`sum(${inventoryBatches.currentQuantity})`,
        })
        .from(inventoryBatches)
        .where(
            and(
                eq(inventoryBatches.branchId, branchId),
                eq(inventoryBatches.status, 'AVAILABLE')
            )
        )
        .groupBy(inventoryBatches.itemId);

        // Get item details with minLevel
        const itemIds = stockLevels.map(s => s.itemId);
        if (itemIds.length === 0) return [];

        const items = await db.select({
            id: inventoryItems.id,
            name: inventoryItems.name,
            sku: inventoryItems.sku,
            minLevel: inventoryItems.minLevel,
            unit: inventoryItems.unit,
        })
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, itemIds));

    // Filter items below min level
    const lowStockItems = items.filter(item => {
      const stock = stockLevels.find(s => s.itemId === item.id);
            const threshold = minLevel ?? item.minLevel ?? 0;
            return stock && stock.totalStock < threshold;
        });

        return lowStockItems;
    }

    // --- Transfers ---

    static async createTransfer(data: {
        companyId: string;
        fromBranchId: string;
        toBranchId: string;
        requestedBy: string;
        items: Array<{
            itemId: string;
            batchId?: string;
            requestedQuantity: number;
            notes?: string;
        }>;
        notes?: string;
    }) {
        // C17.3 — pertenencia antes de escribir. La creación aceptaba destino,
        // artículos y lote del cuerpo sin comprobar de qué empresa eran: con el
        // id de una sucursal ajena se montaba una transferencia que después
        // `shipTransfer` descontaba — de la sucursal ajena, que es donde estaba
        // el lote. Sin transferencia no hay envío, así que la guarda va aquí.
        await assertBranchesOfCompany(data.companyId, [data.fromBranchId, data.toBranchId]);
        await assertItemsOfCompany(data.companyId, data.items.map((item) => item.itemId));
        if (data.fromBranchId === data.toBranchId) {
            throw ApiError.badRequest(
                "La transferencia envía de una sucursal a la misma sucursal: elige un destino distinto."
            );
        }
        return await db.transaction(async (tx) => {
            // Generate sequential transfer number: TRF-YYYYMM-XXXX
            const now = new Date();
            const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const [{ count: monthCount }] = await tx.select({ count: sql<number>`count(*)` })
              .from(inventoryTransfers)
              .where(and(
                gte(inventoryTransfers.createdAt, monthStart),
                lte(inventoryTransfers.createdAt, monthEnd)
              ));
            const sequential = String((monthCount || 0) + 1).padStart(4, '0');
            const transferNumber = `TRF-${yearMonth}-${sequential}`;

            // Create transfer header
            const [transfer] = await tx.insert(inventoryTransfers).values({
                transferNumber,
                fromBranchId: data.fromBranchId,
                toBranchId: data.toBranchId,
                status: 'PENDING',
                requestedBy: data.requestedBy,
                notes: data.notes,
            }).returning();

            // Create transfer items
            const transferItemsData = data.items.map(item => ({
                transferId: transfer.id,
                itemId: item.itemId,
                batchId: item.batchId,
                requestedQuantity: item.requestedQuantity,
                notes: item.notes,
            }));

            const transferItems = await tx.insert(inventoryTransferItems).values(transferItemsData).returning();

            return { transfer, items: transferItems };
        });
    }

    static async getTransfer(id: string, companyId: string) {
        const [transfer] = await db.select()
            .from(inventoryTransfers)
            .where(eq(inventoryTransfers.id, id))
            .limit(1);

        if (!transfer) return null;

        // C17.3 — la transferencia se consulta por id, y el id no dice de qué
        // empresa es: sin esta guarda, el detalle era legible para cualquier
        // usuario autenticado que tuviera un UUID. Una transferencia ajena se
        // lee como no encontrada: el 404 no filtra su existencia.
        if (!(await transferBelongsToCompany(db, companyId, transfer))) return null;

        const items = await db.select({
            id: inventoryTransferItems.id,
            itemId: inventoryTransferItems.itemId,
            requestedQuantity: inventoryTransferItems.requestedQuantity,
            approvedQuantity: inventoryTransferItems.approvedQuantity,
            shippedQuantity: inventoryTransferItems.shippedQuantity,
            receivedQuantity: inventoryTransferItems.receivedQuantity,
            itemName: inventoryItems.name,
            itemSku: inventoryItems.sku,
            itemUnit: inventoryItems.unit,
        })
        .from(inventoryTransferItems)
        .leftJoin(inventoryItems, eq(inventoryTransferItems.itemId, inventoryItems.id))
        .where(eq(inventoryTransferItems.transferId, id));

        return {
            ...transfer,
            items,
        };
    }

    static async getTransfersByBranch(branchId: string, role: 'from' | 'to' | 'both' = 'both') {
        const conditions = [];
        
        if (role === 'from') {
            conditions.push(eq(inventoryTransfers.fromBranchId, branchId));
        } else if (role === 'to') {
            conditions.push(eq(inventoryTransfers.toBranchId, branchId));
        } else {
            conditions.push(
                sql`${inventoryTransfers.fromBranchId} = ${branchId} OR ${inventoryTransfers.toBranchId} = ${branchId}`
            );
        }

        const transfers = await db.select()
            .from(inventoryTransfers)
            .where(and(...conditions))
            .orderBy(desc(inventoryTransfers.requestedAt));

        if (transfers.length === 0) return [];

        const transferIds = transfers.map(t => t.id);

        const items = await db.select({
            id: inventoryTransferItems.id,
            transferId: inventoryTransferItems.transferId,
            itemId: inventoryTransferItems.itemId,
            requestedQuantity: inventoryTransferItems.requestedQuantity,
            approvedQuantity: inventoryTransferItems.approvedQuantity,
            shippedQuantity: inventoryTransferItems.shippedQuantity,
            receivedQuantity: inventoryTransferItems.receivedQuantity,
            itemName: inventoryItems.name,
            itemSku: inventoryItems.sku,
            itemUnit: inventoryItems.unit,
        })
        .from(inventoryTransferItems)
        .leftJoin(inventoryItems, eq(inventoryTransferItems.itemId, inventoryItems.id))
        .where(inArray(inventoryTransferItems.transferId, transferIds));

        return transfers.map(t => ({
            transfer: t,
            items: items.filter(item => item.transferId === t.id)
        }));
    }

    static async approveTransfer(transferId: string, companyId: string, approvedBy: string, items?: Array<{ id: string; approvedQuantity: number }>) {
        return await db.transaction(async (tx) => {
            // C17.3 — la transición se busca por id: sin empresa, cualquier
            // usuario autenticado con el UUID aprobaba una transferencia ajena.
            const original = await loadTransferInTx(tx, transferId);
            if (!original || !(await transferBelongsToCompany(tx, companyId, original))) {
                throw ApiError.notFound("Transferencia no encontrada");
            }

            // Update transfer status
            const [transfer] = await tx.update(inventoryTransfers)
                .set({
                    status: 'APPROVED',
                    approvedBy,
                    approvedAt: new Date(),
                })
                .where(eq(inventoryTransfers.id, transferId))
                .returning();

            // Update item quantities if provided
            if (items && items.length > 0) {
                for (const item of items) {
                    await tx.update(inventoryTransferItems)
                        .set({ approvedQuantity: item.approvedQuantity })
                        .where(
                            and(
                                eq(inventoryTransferItems.transferId, transferId),
                                eq(inventoryTransferItems.id, item.id)
                            )
                        );
                }
            }

            return transfer;
        });
    }

    static async rejectTransfer(transferId: string, companyId: string, rejectedBy: string, reason: string) {
  return await db.transaction(async (tx) => {
    // C17.3 — misma guarda que approve: la transición no decide sobre una
    // transferencia que no es de la empresa.
    const original = await loadTransferInTx(tx, transferId);
    if (!original || !(await transferBelongsToCompany(tx, companyId, original))) {
      throw ApiError.notFound("Transferencia no encontrada");
    }
    const [transfer] = await tx.update(inventoryTransfers)
    .set({
      status: 'REJECTED',
      approvedBy: rejectedBy,
      approvedAt: new Date(), // Use approvedAt as timestamp for the rejection action
      rejectionReason: reason,
    })
    .where(eq(inventoryTransfers.id, transferId))
    .returning();

    return transfer;
  });
}

    static async shipTransfer(transferId: string, companyId: string, shippedBy: string) {
  return await db.transaction(async (tx) => {
    // Get transfer
    const [transfer] = await tx.select()
      .from(inventoryTransfers)
      .where(eq(inventoryTransfers.id, transferId))
      .limit(1);

    if (!transfer) {
      throw new Error("Transfer not found");
    }

    // C17.3 — el envío descuenta lotes: sólo si la transferencia es de la
    // empresa. Antes el id bastaba, y el descuento caía donde cayera el lote.
    if (!(await transferBelongsToCompany(tx, companyId, transfer))) {
      throw ApiError.notFound("Transferencia no encontrada");
    }

    if (transfer.status !== 'APPROVED') {
      throw new Error("Transfer must be approved before shipping");
    }

    // Get transfer items with batch info
    const items = await tx.select({
      transferItem: inventoryTransferItems,
      batch: inventoryBatches,
    })
      .from(inventoryTransferItems)
      .leftJoin(inventoryBatches, eq(inventoryTransferItems.batchId, inventoryBatches.id))
      .where(eq(inventoryTransferItems.transferId, transferId));

    // Update transfer status
    const [updatedTransfer] = await tx.update(inventoryTransfers)
    .set({
      status: 'IN_TRANSIT',
      shippedBy,
      shippedAt: new Date(),
    })
    .where(eq(inventoryTransfers.id, transferId))
    .returning();

    // Disminuye stock del origen. Regla loteprod §11.2: toda mercancía viaja
    // con documento y lote — si la línea no trae batchId explícito, se asigna
    // FEFO sobre los lotes AVAILABLE de la sucursal origen (el mismo allocator
    // que producción/consumo). Si el stock no alcanza, la transacción falla:
    // jamás se mueve sin lote.
    for (const { transferItem: item } of items) {
        const qtyToShip = Number(item.approvedQuantity ?? item.requestedQuantity);

        if (item.batchId) {
            // Decrease from specific batch
            await tx.update(inventoryBatches)
                .set({
                    currentQuantity: sql`${inventoryBatches.currentQuantity} - ${qtyToShip}`,
                    updatedAt: new Date(),
                })
                .where(eq(inventoryBatches.id, item.batchId));

            // Record movement
            await tx.insert(inventoryMovements).values({
                branchId: transfer.fromBranchId,
                itemId: item.itemId,
                batchId: item.batchId,
                type: 'TRANSFER',
                quantityChange: String(-qtyToShip), // numeric(12,4): string en TS
                reason: `Transfer to branch ${transfer.toBranchId}`,
                performedBy: shippedBy,
                referenceId: transferId,
            });
        } else {
            const allocations = await allocateFEFO(tx as unknown as DbExecutor, item.itemId, transfer.fromBranchId, qtyToShip);
            const allocated = allocations.reduce((sum, a) => sum + a.quantity, 0);
            if (allocated < qtyToShip) {
                throw new Error(`Stock insuficiente en origen para el item ${item.itemId}: se pidieron ${qtyToShip}, hay ${allocated}. El transfer no sale sin lote.`);
            }

            let primaryBatchId = item.batchId;
            let primaryQty = -1;
            for (const alloc of allocations) {
                await tx.update(inventoryBatches)
                    .set({
                        currentQuantity: sql`${inventoryBatches.currentQuantity} - ${alloc.quantity}`,
                        updatedAt: new Date(),
                    })
                    .where(eq(inventoryBatches.id, alloc.batchId));

                await tx.insert(inventoryMovements).values({
                    branchId: transfer.fromBranchId,
                    itemId: item.itemId,
                    batchId: alloc.batchId,
                    type: 'TRANSFER',
                    quantityChange: String(-alloc.quantity), // numeric(12,4): string en TS
                    reason: `Transfer to branch ${transfer.toBranchId} (FEFO)`,
                    performedBy: shippedBy,
                    referenceId: transferId,
                });

                // El lote de mayor cantidad asignada queda como lote primario:
                // receiveTransfer hereda su lotNumber/expirationDate al crear el
                // lote destino (trazabilidad FEFO, loteprod §5.5).
                if (alloc.quantity > primaryQty) {
                    primaryQty = alloc.quantity;
                    primaryBatchId = alloc.batchId;
                }
            }

            await tx.update(inventoryTransferItems)
                .set({ shippedQuantity: qtyToShip, batchId: primaryBatchId })
                .where(eq(inventoryTransferItems.id, item.id));
            continue; // shippedQuantity ya quedó actualizado arriba
        }

        // Update shipped quantity
        await tx.update(inventoryTransferItems)
            .set({ shippedQuantity: qtyToShip })
            .where(eq(inventoryTransferItems.id, item.id));
    }

    return updatedTransfer;
  });
}

    static async receiveTransfer(transferId: string, companyId: string, receivedBy: string, items?: Array<{ id: string; receivedQuantity: number }>) {
    return await db.transaction(async (tx) => {
      // Get transfer
      const [transfer] = await tx.select()
        .from(inventoryTransfers)
        .where(eq(inventoryTransfers.id, transferId))
        .limit(1);

      if (!transfer) {
        throw new Error("Transfer not found");
      }

      // C17.3 — la recepción crea stock en destino: sólo si la transferencia
      // es de la empresa. El id solo no lo garantizaba.
      if (!(await transferBelongsToCompany(tx, companyId, transfer))) {
        throw ApiError.notFound("Transferencia no encontrada");
      }

      if (transfer.status !== 'IN_TRANSIT') {
        throw new Error("Transfer must be in transit before receiving");
      }

      // Get transfer items
      const transferItems = await tx.select()
        .from(inventoryTransferItems)
        .where(eq(inventoryTransferItems.transferId, transferId));

      // Update transfer status
      const [updatedTransfer] = await tx.update(inventoryTransfers)
      .set({
        status: 'COMPLETED',
        receivedBy,
        receivedAt: new Date(),
      })
      .where(eq(inventoryTransfers.id, transferId))
      .returning();

      // Increase stock in destination branch
      for (const item of transferItems) {
        const shippedQty = item.shippedQuantity !== null && item.shippedQuantity !== undefined
          ? Number(item.shippedQuantity)
          : Number(item.requestedQuantity || 0);

        const receivedQtyRaw = items
          ? Number(items.find(i => i.id === item.id)?.receivedQuantity ?? shippedQty)
          : shippedQty;

        if (receivedQtyRaw > shippedQty) {
          throw new Error(`Received quantity (${receivedQtyRaw}) cannot be greater than shipped quantity (${shippedQty}) for item ID ${item.itemId}`);
        }

        const wasteQty = Math.max(0, Math.round(shippedQty - receivedQtyRaw));
        const receivedQty = Math.round(receivedQtyRaw);

        // Get source batch if available
        const sourceBatch = item.batchId ? await tx.select()
          .from(inventoryBatches)
          .where(eq(inventoryBatches.id, item.batchId))
          .limit(1)
          .then(r => r[0]) : null;

        if (receivedQty > 0) {
          const [newBatch] = await tx.insert(inventoryBatches).values({
            itemId: item.itemId,
            branchId: transfer.toBranchId,
            initialQuantity: String(receivedQty), // numeric(12,4): string en TS
            currentQuantity: String(receivedQty),
            lotNumber: sourceBatch?.lotNumber || `TRF-BATCH-${Date.now()}`,
            expirationDate: sourceBatch?.expirationDate,
            productionDate: sourceBatch?.productionDate,
            status: 'AVAILABLE',
          }).returning();

          // Record movement
          await tx.insert(inventoryMovements).values({
            branchId: transfer.toBranchId,
            itemId: item.itemId,
            batchId: newBatch.id,
            type: 'TRANSFER',
            quantityChange: String(receivedQty), // numeric(12,4): string en TS
            reason: `Transfer from branch ${transfer.fromBranchId}`,
            performedBy: receivedBy,
            referenceId: transferId,
          });
        }

        // If received less than shipped, record transportation waste (merma de transporte)
        if (wasteQty > 0) {
          const [inventoryItem] = await tx.select()
            .from(inventoryItems)
            .where(eq(inventoryItems.id, item.itemId))
            .limit(1);

          if (inventoryItem) {
            const unitCost = sourceBatch?.unitCost || inventoryItem.lastCost || 0;
            const totalLoss = wasteQty * unitCost;

            await tx.insert(inventoryWaste).values({
              companyId: inventoryItem.companyId,
              branchId: transfer.toBranchId,
              batchId: item.batchId || null,
              itemId: item.itemId,
              quantity: String(wasteQty), // numeric(12,4): string en TS
              unit: inventoryItem.unit || 'UNIT',
              reason: 'DAMAGED',
              costPerUnit: unitCost,
              totalLoss: totalLoss,
              recordedBy: receivedBy,
              notes: `Merma de transporte en transferencia ${transfer.transferNumber}. Encontrado en recepción.`,
            });

            // Record movement for waste
            await tx.insert(inventoryMovements).values({
              branchId: transfer.toBranchId,
              itemId: item.itemId,
              batchId: item.batchId || null,
              type: 'WASTE',
              quantityChange: String(-wasteQty), // numeric(12,4): string en TS
              reason: `Merma de transporte en transferencia ${transfer.transferNumber}`,
              performedBy: receivedBy,
              referenceId: transferId,
            });
          }
        }

        // Update received quantity in DB
        if (items) {
          const transferItem = items.find(i => i.id === item.id);
          if (transferItem) {
            await tx.update(inventoryTransferItems)
            .set({ receivedQuantity: transferItem.receivedQuantity })
            .where(eq(inventoryTransferItems.id, item.id));
          }
        }
      }

      return updatedTransfer;
    });
  }

  static async recordAdjustment(data: {
    branchId: string;
    itemId: string;
    batchId?: string;
    quantityChange: number;
    reason?: string;
    performedBy: string;
    referenceId?: string;
    metadata?: { systemQuantity?: number; physicalQuantity?: number };
  }) {
    let batchId = data.batchId;

    if (!batchId) {
      const existingBatch = await db.select({ id: inventoryBatches.id })
        .from(inventoryBatches)
        .where(and(
          eq(inventoryBatches.itemId, data.itemId),
          eq(inventoryBatches.branchId, data.branchId),
          eq(inventoryBatches.status, 'AVAILABLE')
        ))
        .limit(1);

      if (existingBatch.length > 0) {
        batchId = existingBatch[0].id;
      } else {
        const [newBatch] = await db.insert(inventoryBatches).values({
          itemId: data.itemId,
          branchId: data.branchId,
          currentQuantity: '0', // numeric(12,4): string en TS
          initialQuantity: '0',
          status: 'AVAILABLE',
          lotNumber: `SC-${Date.now()}`,
          receivedAt: new Date(),
        }).returning();
        batchId = newBatch.id;
      }
    }

    return await this.recordMovement({
      ...data,
      batchId,
      type: 'ADJUSTMENT',
    });
  }
}
