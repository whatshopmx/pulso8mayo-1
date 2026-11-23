import type { db } from "@/lib/db";
import { configChangeLogs, inventoryItems, recipes, recipeItems, recipeVersions, recipeConsumptionPolicies, unitConversions } from "@/lib/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveRecipeConsumptionPolicy } from "./recipe-consumption-policy";
import { validateSaleDay } from "./sale-consumption-contract";
import type { SaleRecipeReader } from "./sale-consumption-snapshot";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const archivedLines = z.array(z.object({
  itemId: z.string().uuid(), quantity: z.string().regex(/^\d{1,6}(?:\.\d{1,4})?$/),
  unit: z.string().min(1), isSubRecipe: z.boolean(),
  yieldPercent: z.number().int().min(1).max(100).nullable(),
})).max(10000);

/** Lector opt-in: sólo fichas archivadas y políticas vigentes, en la transacción de venta. */
export function publishedSaleRecipeReader(tx: Transaction, day: string): SaleRecipeReader {
  const saleDay = validateSaleDay(day);
  const catalog = saleRecipeReader(tx);
  return {
    ...catalog,
    async recipe(id, companyId) {
      const isolation = (await tx.execute(sql`SELECT current_setting('transaction_isolation') AS isolation`)).rows[0]?.isolation;
      if (isolation !== 'serializable') throw new Error('El lector publicado requiere transacción serializable');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recipe-consumption-policy:${companyId}:${id}`}, 0))`);
      const rows = await tx.select().from(recipeConsumptionPolicies).where(and(
        eq(recipeConsumptionPolicies.companyId, companyId), eq(recipeConsumptionPolicies.recipeId, id)));
      const policy = resolveRecipeConsumptionPolicy({ companyId, recipeId: id, saleDay }, rows.map(row => ({
        schemaVersion: 1 as const, id: row.id, companyId: row.companyId, recipeId: row.recipeId,
        recipeVersionId: row.recipeVersionId, effectiveFrom: row.effectiveFrom,
        ...(row.mode === 'FINISHED_PRODUCT_ON_SALE'
          ? { mode: row.mode, inventoryItemId: row.inventoryItemId, unit: row.unit }
          : { mode: row.mode }),
      })));
      const [audit] = await tx.select({ id: configChangeLogs.id }).from(configChangeLogs).where(and(
        eq(configChangeLogs.companyId, companyId), eq(configChangeLogs.fieldName, `recipe_consumption_policy:${policy.id}`))).limit(1);
      if (!audit) throw new Error('Política sin prueba de auditoría de publicación');
      const [version] = await tx.select({ id: recipeVersions.id, recipeId: recipeVersions.recipeId,
        companyId: recipeVersions.companyId, versionNumber: recipeVersions.versionNumber,
        baseYield: recipeVersions.baseYield, unit: recipeVersions.unit, items: recipeVersions.itemsSnapshot,
      }).from(recipeVersions).where(and(eq(recipeVersions.id, policy.recipeVersionId),
        eq(recipeVersions.recipeId, id), eq(recipeVersions.companyId, companyId)));
      if (!version) throw new Error('Versión publicada inexistente o de otra empresa');
      // Las versiones antiguas no guardan IDs de línea. La posición archivada
      // da una identidad estable sin consultar recipe_items ni copiar costos.
      const items = archivedLines.parse(version.items).map((line, index) => ({ ...line,
        id: `${version.id}:${index}`, yieldPercent: line.yieldPercent ?? null }));
      return { id, companyId, baseYield: version.baseYield, unit: version.unit, items,
        publication: { policy, recipeVersionId: version.id, versionNumber: version.versionNumber, saleDay } };
    },
  };
}

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
