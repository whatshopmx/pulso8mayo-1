import { db } from "@/lib/db";
import { recipes, recipeItems, inventoryBatches, inventoryItems } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { InventoryService } from "./inventory-service";
import { UnitConversionService } from "./unit-conversion-service";

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

    const batches = await db.select()
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.branchId, branchId),
          eq(inventoryBatches.itemId, itemId),
          eq(inventoryBatches.status, 'AVAILABLE'),
          sql`${inventoryBatches.currentQuantity} > 0`
        )
      )
      .orderBy(inventoryBatches.expirationDate, inventoryBatches.createdAt);

    let remainingToDeduct = adjustedQty;

    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;

      const currentQty = Number(batch.currentQuantity);
      const deductQty = Math.min(currentQty, remainingToDeduct);

      await InventoryService.recordMovement({
        branchId,
        itemId,
        batchId: batch.id,
        type: 'USAGE',
        quantityChange: -deductQty,
        reason,
        performedBy: userId,
      });

      remainingToDeduct -= deductQty;
    }

    if (remainingToDeduct > 0) {
      const lastBatch = batches[batches.length - 1];
      if (lastBatch) {
        const currentQty = Number(lastBatch.currentQuantity);
        await InventoryService.recordMovement({
          branchId,
          itemId,
          batchId: lastBatch.id,
          type: 'USAGE',
          quantityChange: -remainingToDeduct,
          reason: `${reason} (Ajuste negativo por falta de stock)`,
          performedBy: userId,
        });
      } else {
        const [dummyBatch] = await db.insert(inventoryBatches).values({
          branchId,
          itemId,
          initialQuantity: 0,
          currentQuantity: 0,
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
        });
      }
    }
  }
}
