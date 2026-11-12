import type { db } from "@/lib/db";
import { inventoryItems, recipes, recipeItems, unitConversions } from "@/lib/db/schema";
import { and, eq, or } from "drizzle-orm";
import type { SaleRecipeReader } from "./sale-consumption-snapshot";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Usar la misma transacción/snapshot que aplicará la venta; nunca la conexión global. */
export function saleRecipeReader(tx: Transaction): SaleRecipeReader {
  return {
    async recipe(id, companyId) {
      const [recipe] = await tx.select({ id: recipes.id, companyId: recipes.companyId, baseYield: recipes.baseYield, unit: recipes.unit })
        .from(recipes).where(and(eq(recipes.id, id), eq(recipes.companyId, companyId)));
      if (!recipe) return null;
      const items = await tx.select({ id: recipeItems.id, itemId: recipeItems.itemId, quantity: recipeItems.quantity,
        unit: recipeItems.unit, isSubRecipe: recipeItems.isSubRecipe, yieldPercent: recipeItems.yieldPercent })
        .from(recipeItems).innerJoin(recipes, eq(recipeItems.recipeId, recipes.id))
        .where(and(eq(recipes.id, id), eq(recipes.companyId, companyId))).orderBy(recipeItems.id);
      return { ...recipe, items };
    },
    async ingredient(id, companyId) {
      const [item] = await tx.select({ id: inventoryItems.id, companyId: inventoryItems.companyId, unit: inventoryItems.unit })
        .from(inventoryItems).where(and(eq(inventoryItems.id, id), eq(inventoryItems.companyId, companyId)));
      return item ?? null;
    },
    async conversions(from, to, companyId) {
      return tx.select({ id: unitConversions.id, companyId: unitConversions.companyId,
        fromUnit: unitConversions.fromUnit, toUnit: unitConversions.toUnit, factor: unitConversions.factor })
        .from(unitConversions).where(and(eq(unitConversions.companyId, companyId), or(
          and(eq(unitConversions.fromUnit, from), eq(unitConversions.toUnit, to)),
          and(eq(unitConversions.fromUnit, to), eq(unitConversions.toUnit, from)),
        ))).orderBy(unitConversions.id);
    },
  };
}
