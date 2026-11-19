import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { account, users, companies, branches, recipes, recipeItems, inventoryItems, inventoryBatches,
  inventoryMovements, salesEntries, salesConsumptionIdentities, salesConsumptionRevisions } from '@/lib/db/schema';
import type { createSalesRuntimeDatabase } from './sales-runtime-database';

export async function seedCsvRuntimeScenario(database: Awaited<ReturnType<typeof createSalesRuntimeDatabase>>) {
  const companyId = randomUUID(), branchId = randomUUID(), actorId = randomUUID();
  const recipeIds = [randomUUID(), randomUUID()], itemIds = [randomUUID(), randomUUID()], batchIds = [randomUUID(), randomUUID()];
  const recipeNames = ['Synthetic CSV, dish', 'Synthetic CSV, second dish'];
  const password = `Synthetic-${randomUUID()}`, hash = await hashPassword(password), now = new Date();
  await database.owner.transaction(async tx => {
    await tx.insert(companies).values({ id: companyId, name: 'Synthetic CSV runtime company' });
    await tx.insert(branches).values({ id: branchId, companyId, name: 'Synthetic CSV runtime branch' });
    await tx.insert(inventoryItems).values(itemIds.map(id => ({ id, companyId, name: `Synthetic CSV ingredient ${id.slice(0, 8)}`, unit: 'KG' })));
    await tx.insert(recipes).values(recipeIds.map((id, i) => ({ id, companyId, name: recipeNames[i], baseYield: '1', unit: 'PORTION' })));
    await tx.insert(recipeItems).values(recipeIds.map((recipeId, i) => ({ recipeId, itemId: itemIds[i], quantity: '1', unit: 'KG', yieldPercent: 100 })));
    await tx.insert(inventoryBatches).values(batchIds.map((id, i) => ({ id, branchId, itemId: itemIds[i], initialQuantity: '20', currentQuantity: '20',
      status: 'AVAILABLE' as const, expirationDate: new Date('2099-01-01') })));
    await tx.insert(users).values({ id: actorId, companyId, branchId, role: 'ADMIN', email: `${actorId}@example.invalid`,
      name: 'Synthetic CSV runtime actor', emailVerified: true, createdAt: now, updatedAt: now });
    await tx.insert(account).values({ id: randomUUID(), userId: actorId, accountId: actorId, providerId: 'credential', password: hash, createdAt: now, updatedAt: now });
  });
  const state = () => database.owner.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.current_company_id', ${companyId}, true), set_config('app.current_branch_id', ${branchId}, true)`);
    return {
      batches: await tx.select({ id: inventoryBatches.id, quantity: inventoryBatches.currentQuantity }).from(inventoryBatches)
        .where(inArray(inventoryBatches.id, batchIds)).orderBy(inventoryBatches.id),
      movements: await tx.select({ id: inventoryMovements.id, quantity: inventoryMovements.quantityChange, batchId: inventoryMovements.batchId })
        .from(inventoryMovements).where(eq(inventoryMovements.branchId, branchId)).orderBy(inventoryMovements.id),
      sales: await tx.select({ id: salesEntries.id, recipeId: salesEntries.recipeId, quantity: salesEntries.quantitySold,
        revenue: salesEntries.totalRevenue, updated: salesEntries.updatedAt }).from(salesEntries)
        .where(and(eq(salesEntries.companyId, companyId), eq(salesEntries.branchId, branchId))).orderBy(salesEntries.recipeId),
      identities: await tx.select({ id: salesConsumptionIdentities.id, source: salesConsumptionIdentities.source,
        productKey: salesConsumptionIdentities.productKey, day: salesConsumptionIdentities.saleDay }).from(salesConsumptionIdentities)
        .where(eq(salesConsumptionIdentities.companyId, companyId)).orderBy(salesConsumptionIdentities.productKey),
      revisions: await tx.select({ id: salesConsumptionRevisions.id, identityId: salesConsumptionRevisions.identityId,
        recipeId: salesConsumptionRevisions.recipeId, revision: salesConsumptionRevisions.revision, quantity: salesConsumptionRevisions.quantitySold,
        revenue: salesConsumptionRevisions.totalRevenue }).from(salesConsumptionRevisions)
        .where(eq(salesConsumptionRevisions.companyId, companyId)).orderBy(salesConsumptionRevisions.identityId, salesConsumptionRevisions.revision),
    };
  });
  return { companyId, branchId, actorId, recipeIds, recipeNames, batchIds, password, state };
}
