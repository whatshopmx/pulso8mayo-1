import "dotenv/config";
import { db } from "@/lib/db";
import {
  inventoryItems, inventoryBatches, stockCounts, productionPlans,
  productionPlanItems, productionOrders, recipes, recipeVersions, recipeItems,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { produceRecipeWithFefo } from "@/lib/services/recipe-production";
import { InventorySnapshotService } from "@/lib/services/inventory-snapshot-service";
import { localDateString } from "@/lib/workflows/today";
import { COMPANY_ID, DEMO_BRANCHES, USER_ADMIN } from "./seed-constants";

export async function main() {
  console.log("=== Phase 14: Producción FEFO, conteos y snapshots ===");
  const catalog = await db.select().from(recipes).where(eq(recipes.companyId, COMPANY_ID));
  const recipe = catalog.find((row) => row.name === "Salsa Roja Base");
  if (!recipe) throw new Error("Falta Salsa Roja Base: ejecuta la fase 4.");
  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.companyId, COMPANY_ID));
  const today = localDateString(new Date(), "America/Mexico_City");
  // La fase completa reinicia los datos; no fabrica resultados de producción:
  // pasa por el mismo cálculo de receta, rendimientos y FEFO que la aplicación.
  for (const branch of DEMO_BRANCHES) {
    const [plan] = await db.insert(productionPlans).values({
      companyId: COMPANY_ID, branchId: branch.id, targetDate: new Date(`${today}T12:00:00Z`),
      shift: "MATUTINO", status: "PUBLISHED", createdBy: USER_ADMIN,
    }).returning();
    await db.insert(productionPlanItems).values({
      planId: plan.id, recipeId: recipe.id, plannedQuantity: "4.5000",
      unitOfMeasure: recipe.unit, assignedTo: branch.operatorId,
      status: "PENDING", notes: "Preparación para el servicio de comida",
    });
    await db.insert(productionOrders).values({
      companyId: COMPANY_ID, branchId: branch.id, recipeId: recipe.id,
      plannedQuantity: 6, unit: recipe.unit, plannedDate: new Date(`${today}T12:00:00Z`),
      station: "Cocina fría", shift: "MATUTINO", responsibleUserId: branch.operatorId,
      deadlineTime: "13:00", createdBy: USER_ADMIN,
    });
    // Existencias conocidas para demostrar descuentos fraccionarios sin
    // depender de qué lotes aleatorios de la fase 4 quedaron caducados.
    for (const sku of ["VER-001", "VER-002", "VER-005"]) {
      const item = items.find((row) => row.sku === sku);
      if (!item) throw new Error(`Falta insumo ${sku}`);
      await db.insert(inventoryBatches).values({
        itemId: item.id, branchId: branch.id, supplierId: item.supplierId,
        lotNumber: `DEMO-PREP-${sku}`, initialQuantity: "10.5000", currentQuantity: "10.5000",
        unitCost: item.lastCost, origin: "RECEIVING", status: "AVAILABLE",
        expirationDate: new Date(Date.now() + 5 * 86400000),
      });
    }
    const [order] = await db.insert(productionOrders).values({
      companyId: COMPANY_ID, branchId: branch.id, recipeId: recipe.id,
      plannedQuantity: 2, unit: recipe.unit, plannedDate: new Date(),
      station: "Cocina fría", shift: "MATUTINO", responsibleUserId: branch.operatorId,
      deadlineTime: "12:00", createdBy: USER_ADMIN,
    }).returning();
    const outcome = await db.transaction((tx) => produceRecipeWithFefo(tx, {
      companyId: COMPANY_ID, branchId: branch.id, recipeId: recipe.id,
      quantity: 2, unit: recipe.unit, recordedBy: branch.operatorId, orderId: order.id,
    }));
    if (outcome.status !== "produced" || outcome.shortfalls.length) {
      throw new Error(`Producción demo incompleta en ${branch.id}`);
    }
    await db.update(productionOrders).set({ completedBy: branch.operatorId }).where(eq(productionOrders.id, order.id));
    const stock = await db.select({ itemId: inventoryBatches.itemId, quantity: sql<string>`sum(${inventoryBatches.currentQuantity})` })
      .from(inventoryBatches).where(and(eq(inventoryBatches.branchId, branch.id), eq(inventoryBatches.status, "AVAILABLE")))
      .groupBy(inventoryBatches.itemId);
    const stockByItem = new Map(stock.map((row) => [row.itemId, Number(row.quantity)]));
    for (const [index, item] of items.filter((row) => row.isHighValue).entries()) {
      const system = stockByItem.get(item.id) ?? 0;
      const counted = Math.max(0, system - (index % 2 === 0 ? 0.25 : 0));
      await db.insert(stockCounts).values({
        companyId: COMPANY_ID, branchId: branch.id, itemId: item.id,
        countDate: today, systemQuantity: String(system), countedQuantity: String(counted), countedBy: branch.operatorId,
      });
    }
    await InventorySnapshotService.buildSnapshot(COMPANY_ID, branch.id, today);
  }
  for (const row of catalog) {
    const ingredients = await db.select().from(recipeItems).where(eq(recipeItems.recipeId, row.id));
    await db.insert(recipeVersions).values({
      recipeId: row.id, companyId: COMPANY_ID, versionNumber: 1,
      name: row.name, description: row.description, baseYield: row.baseYield,
      unit: row.unit, holdTimeMinutes: row.holdTimeMinutes,
      calculatedCost: row.calculatedCost, priceSelling: row.priceSelling,
      foodCostPercentage: row.foodCostPercentage, itemsSnapshot: ingredients,
      changedBy: USER_ADMIN, changeReason: "Ficha inicial demo",
    });
  }
}
