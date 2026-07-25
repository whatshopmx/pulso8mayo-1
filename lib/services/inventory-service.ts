import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, suppliers, inventoryPriceHistory, inventoryTransfers, inventoryTransferItems, inventoryWaste } from "@/lib/db/schema";
import { eq, and, sql, desc, inArray, gte, lte } from "drizzle-orm";

export class InventoryService {

    // --- Items ---

    static async getItems(companyId: string, search?: string) {
        // Basic list with search
        // Ideally we would join with batches to get total stock, 
        // but for now let's just return items
        return db.select()
            .from(inventoryItems)
            .where(
                and(
                    eq(inventoryItems.companyId, companyId),
                    eq(inventoryItems.active, true),
                    // Add search logic if needed
                )
            );
    }

    static async getItem(id: string) {
        return db.query.inventoryItems.findFirst({
            where: eq(inventoryItems.id, id)
        });
    }

    static async createItem(data: typeof inventoryItems.$inferInsert & { userId?: string }) {
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

    static async updateItem(id: string, data: Partial<typeof inventoryItems.$inferInsert>, userId?: string) {
        // 1. Check if cost changed
        if (data.lastCost !== undefined && userId) {
            const currentItem = await this.getItem(id);
            if (currentItem && currentItem.lastCost !== data.lastCost) {
                await db.insert(inventoryPriceHistory).values({
                    itemId: id,
                    previousCost: currentItem.lastCost,
                    newCost: data.lastCost,
                    supplierId: data.supplierId || currentItem.supplierId,
                    changedBy: userId,
                });
            }
        }

        const [item] = await db.update(inventoryItems)
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

    // --- Transactions (Movements) ---

  static async recordMovement(data: {
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
  }) {
   return await db.transaction(async (tx) => {
   const [movement] = await tx.insert(inventoryMovements).values({
   branchId: data.branchId,
   itemId: data.itemId,
   batchId: data.batchId,
   type: data.type,
   quantityChange: data.quantityChange,
   reason: data.reason,
   performedBy: data.performedBy,
   referenceId: data.referenceId,
   fromLocationId: data.fromLocationId,
   toLocationId: data.toLocationId,
   }).returning();

            // 2. Update Batch if exists
            if (data.batchId) {
                await tx.update(inventoryBatches)
                    .set({
                        currentQuantity: sql`${inventoryBatches.currentQuantity} + ${data.quantityChange}`,
                        updatedAt: new Date()
                    })
                    .where(eq(inventoryBatches.id, data.batchId));
            }

            // 3. Update Item total (if we stored it, but we calculate it dynamically or just rely on batches)
            // For now, we rely on batches for specific stock, but maybe we want a cache on the item or a separate inventory_stock table?
            // "Inventory tracking by branch" -> We might need a table `inventory_stock` (itemId, branchId, quantity)
            // for non-batch items or aggregated view.

            // NOTE: For MVP, if everything has a batch, we sum batches. 
            // If we allow non-batched items, we need `inventory_stock`.
            // Let's assume for now we might need `inventory_stock` or just sum batches.
            // Requirement says "Batch/lot tracking". 

            return movement;
        });
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

        return result[0]?.total || 0;
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

    static async getTransfer(id: string) {
        const [transfer] = await db.select()
            .from(inventoryTransfers)
            .where(eq(inventoryTransfers.id, id))
            .limit(1);

        if (!transfer) return null;

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

    static async approveTransfer(transferId: string, approvedBy: string, items?: Array<{ id: string; approvedQuantity: number }>) {
        return await db.transaction(async (tx) => {
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

static async rejectTransfer(transferId: string, rejectedBy: string, reason: string) {
  return await db.transaction(async (tx) => {
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

static async shipTransfer(transferId: string, shippedBy: string) {
  return await db.transaction(async (tx) => {
    // Get transfer
    const [transfer] = await tx.select()
      .from(inventoryTransfers)
      .where(eq(inventoryTransfers.id, transferId))
      .limit(1);

    if (!transfer) {
      throw new Error("Transfer not found");
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

    // Decrease stock from origin branch
    for (const { transferItem: item, batch } of items) {
                if (item.batchId) {
                    // Decrease from specific batch
                    await tx.update(inventoryBatches)
                        .set({
                            currentQuantity: sql`${inventoryBatches.currentQuantity} - ${item.requestedQuantity}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(inventoryBatches.id, item.batchId));
                }

                // Record movement
                await tx.insert(inventoryMovements).values({
                    branchId: transfer.fromBranchId,
                    itemId: item.itemId,
                    batchId: item.batchId,
                    type: 'TRANSFER',
                    quantityChange: -item.requestedQuantity,
                    reason: `Transfer to branch ${transfer.toBranchId}`,
                    performedBy: shippedBy,
                    referenceId: transferId,
                });

                // Update shipped quantity
                await tx.update(inventoryTransferItems)
                    .set({ shippedQuantity: item.requestedQuantity })
                    .where(eq(inventoryTransferItems.id, item.id));
            }

    return updatedTransfer;
  });
}

  static async receiveTransfer(transferId: string, receivedBy: string, items?: Array<{ id: string; receivedQuantity: number }>) {
    return await db.transaction(async (tx) => {
      // Get transfer
      const [transfer] = await tx.select()
        .from(inventoryTransfers)
        .where(eq(inventoryTransfers.id, transferId))
        .limit(1);

      if (!transfer) {
        throw new Error("Transfer not found");
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
            initialQuantity: receivedQty,
            currentQuantity: receivedQty,
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
            quantityChange: receivedQty,
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
              quantity: wasteQty,
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
              quantityChange: -wasteQty,
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
          currentQuantity: 0,
          initialQuantity: 0,
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
