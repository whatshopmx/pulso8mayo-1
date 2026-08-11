import { db } from "@/lib/db";
import { recipes, recipeItems, inventoryBatches, inventoryItems } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { InventoryService } from "./inventory-service";
import { UnitConversionService } from "./unit-conversion-service";
import { allocateFEFO } from "./fefo-allocator";

export class TheoreticalConsumptionService {
  static async consume(params: {
    companyId: string;
    branchId: string;
    recipeId: string;
    quantitySold: number;
    saleDate: Date;
    userId: string;
  }) {
    const { branchId, recipeId, quantitySold, userId, companyId } = params;
    const notes = `Desconsolidación automática por ventas del ${params.saleDate.toLocaleDateString()}`;

    await this.deductRecipeIngredients(branchId, recipeId, quantitySold, userId, companyId, notes);
  }

  private static async deductRecipeIngredients(
    branchId: string,
    recipeId: string,
    quantityNeeded: number,
    userId: string,
    companyId: string,
    notes: string
  ) {
    const [recipe] = await db.select()
      .from(recipes)
      .where(eq(recipes.id, recipeId));
    if (!recipe) return;

    const baseYield = parseFloat(recipe.baseYield) || 1;

    const items = await db.select()
      .from(recipeItems)
      .where(eq(recipeItems.recipeId, recipeId));

    for (const item of items) {
      const qtyNeeded = (parseFloat(item.quantity) * quantityNeeded) / baseYield;

      if (item.isSubRecipe) {
        await this.deductRecipeIngredients(branchId, item.itemId, qtyNeeded, userId, companyId, notes);
      } else {
        await this.deductItemFIFO(branchId, item.itemId, qtyNeeded, userId, companyId, notes, item.unit ?? undefined, item.yieldPercent ?? undefined);
      }
    }
  }

  private static async deductItemFIFO(
    branchId: string,
    itemId: string,
    quantityToDeduct: number,
    userId: string,
    companyId: string,
    reason: string,
    recipeUnit?: string,
    yieldPercent?: number
  ) {
    const effectiveYield = yieldPercent ?? 100;

    let adjustedQty = quantityToDeduct * (100 / effectiveYield);

    if (recipeUnit) {
      const item = await db.query.inventoryItems.findFirst({
        where: eq(inventoryItems.id, itemId),
      });
      if (item && item.unit && recipeUnit !== item.unit) {
        const converted = await UnitConversionService.convert(adjustedQty, recipeUnit, item.unit, companyId);
        if (converted !== null) {
          adjustedQty = converted;
        }
      }
    }

    // FEFO con lock (T14): la asignación toma `FOR UPDATE` dentro de la misma
    // transacción que escribe, para que dos consumos concurrentes no asignen
    // el mismo lote. `recordMovement` recibe el `tx` y corre en esta conexión.
    await db.transaction(async (tx) => {
      const allocations = await allocateFEFO(tx, itemId, branchId, adjustedQty);
      const allocated = allocations.reduce((s, a) => s + a.quantity, 0);

      for (const alloc of allocations) {
        await InventoryService.recordMovement({
          branchId,
          itemId,
          batchId: alloc.batchId,
          type: 'USAGE',
          quantityChange: -alloc.quantity,
          reason,
          performedBy: userId,
        }, tx);
      }

      if (allocated < adjustedQty) {
        const remainingToDeduct = adjustedQty - allocated;
        const lastBatch = allocations[allocations.length - 1];
        if (lastBatch) {
          const currentQty = await tx
            .select({ qty: inventoryBatches.currentQuantity })
            .from(inventoryBatches)
            .where(eq(inventoryBatches.id, lastBatch.batchId))
            .limit(1)
            .then((rows) => Number(rows[0]?.qty ?? 0));
          await InventoryService.recordMovement({
            branchId,
            itemId,
            batchId: lastBatch.batchId,
            type: 'USAGE',
            quantityChange: -remainingToDeduct,
            reason: `${reason} (Ajuste negativo por falta de stock)`,
            performedBy: userId,
          }, tx);
        } else {
          const [dummyBatch] = await tx.insert(inventoryBatches).values({
            branchId,
            itemId,
            initialQuantity: '0', // numeric(12,4): string en TS
            currentQuantity: '0',
            lotNumber: `DUMMY-NEG-${Date.now()}`,
            status: 'AVAILABLE',
          }).returning();

          await InventoryService.recordMovement({
            branchId,
            itemId,
            batchId: dummyBatch.id,
            type: 'USAGE',
            quantityChange: -remainingToDeduct,
            reason: `${reason} (Ajuste negativo inicial)`,
            performedBy: userId,
          }, tx);
        }
      }
    });
  }
}
