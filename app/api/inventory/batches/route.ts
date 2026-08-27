import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import {
  inventoryBatches,
  branches,
  inventoryItems,
  suppliers,
  productionIngredients,
  productionResults,
  recipes,
  inventoryWaste,
  inventoryMovements,
  users,
  type inventoryBatchStatusEnum,
} from '@/lib/db/schema';
import { z } from 'zod';

const updateStatusSchema = z.object({
  batchId: z.string().uuid(),
  status: z.enum(['AVAILABLE', 'RESERVED', 'EXPIRED', 'QUARANTINED', 'DEPLETED']),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('id') || searchParams.get('batchId');
    const isTrace = searchParams.get('trace') === 'true';

    // Trazabilidad profunda de un lote específico
    if (batchId && isTrace) {
      const [batch] = await db
        .select({
          id: inventoryBatches.id,
          itemId: inventoryBatches.itemId,
          branchId: inventoryBatches.branchId,
          supplierId: inventoryBatches.supplierId,
          lotNumber: inventoryBatches.lotNumber,
          productionDate: inventoryBatches.productionDate,
          expirationDate: inventoryBatches.expirationDate,
          receivedAt: inventoryBatches.receivedAt,
          initialQuantity: inventoryBatches.initialQuantity,
          currentQuantity: inventoryBatches.currentQuantity,
          unitCost: inventoryBatches.unitCost,
          status: inventoryBatches.status,
          supplierBatchInfo: inventoryBatches.supplierBatchInfo,
          origin: inventoryBatches.origin,
          createdAt: inventoryBatches.createdAt,
          branchName: branches.name,
          itemName: inventoryItems.name,
          itemSku: inventoryItems.sku,
          itemUnit: inventoryItems.unit,
          supplierName: suppliers.name,
        })
        .from(inventoryBatches)
        .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
        .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
        .leftJoin(suppliers, eq(inventoryBatches.supplierId, suppliers.id))
        .where(eq(inventoryBatches.id, batchId))
        .limit(1);

      if (!batch) {
        return NextResponse.json({ error: 'Lote no encontrado' }, { status: 404 });
      }

      // 1. Consumos en Producción
      const productions = await db
        .select({
          id: productionIngredients.id,
          actualQuantity: productionIngredients.actualQuantity,
          unit: productionIngredients.unit,
          recipeName: recipes.name,
          producedQuantity: productionResults.producedQuantity,
          producedAt: productionResults.productionDate,
        })
        .from(productionIngredients)
        .innerJoin(productionResults, eq(productionIngredients.resultId, productionResults.id))
        .leftJoin(recipes, eq(productionResults.recipeId, recipes.id))
        .where(eq(productionIngredients.batchId, batchId))
        .orderBy(desc(productionResults.productionDate));

      // 2. Mermas registradas
      const wasteRecords = await db
        .select({
          id: inventoryWaste.id,
          quantity: inventoryWaste.quantity,
          unit: inventoryWaste.unit,
          reason: inventoryWaste.reason,
          totalLoss: inventoryWaste.totalLoss,
          createdAt: inventoryWaste.createdAt,
        })
        .from(inventoryWaste)
        .where(eq(inventoryWaste.batchId, batchId))
        .orderBy(desc(inventoryWaste.createdAt));

      // 3. Movimientos del kardex
      const movements = await db
        .select({
          id: inventoryMovements.id,
          type: inventoryMovements.type,
          quantityChange: inventoryMovements.quantityChange,
          reason: inventoryMovements.reason,
          timestamp: inventoryMovements.timestamp,
        })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.batchId, batchId))
        .orderBy(desc(inventoryMovements.timestamp));

      return NextResponse.json({
        success: true,
        batch: {
          ...batch,
          initialQuantity: Number(batch.initialQuantity),
          currentQuantity: Number(batch.currentQuantity),
        },
        trace: {
          productions: productions.map(p => ({ ...p, actualQuantity: Number(p.actualQuantity) })),
          waste: wasteRecords.map(w => ({ ...w, quantity: Number(w.quantity) })),
          movements: movements.map(m => ({ ...m, quantityChange: Number(m.quantityChange) })),
        },
      });
    }

    const itemId = searchParams.get('itemId');
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status');

    // Build where clause
    let whereClause = and(
      gte(inventoryBatches.currentQuantity, '0')
    );

    if (itemId) {
      whereClause = and(whereClause, eq(inventoryBatches.itemId, itemId as any));
    }

    if (branchId) {
      whereClause = and(whereClause, eq(inventoryBatches.branchId, branchId as any));
    }

    if (status) {
      whereClause = and(whereClause, eq(inventoryBatches.status, status as any));
    }

    // Fetch batches with branch info
    const rows = await db
      .select({
        id: inventoryBatches.id,
        itemId: inventoryBatches.itemId,
        branchId: inventoryBatches.branchId,
        lotNumber: inventoryBatches.lotNumber,
        productionDate: inventoryBatches.productionDate,
        expirationDate: inventoryBatches.expirationDate,
        receivedAt: inventoryBatches.receivedAt,
        initialQuantity: inventoryBatches.initialQuantity,
        currentQuantity: inventoryBatches.currentQuantity,
        unitCost: inventoryBatches.unitCost,
        status: inventoryBatches.status,
        branchName: branches.name,
        itemName: inventoryItems.name,
        itemSku: inventoryItems.sku,
        itemUnit: inventoryItems.unit,
      })
      .from(inventoryBatches)
      .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
      .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
      .where(whereClause)
      .orderBy(inventoryBatches.expirationDate);

    const batches = rows.map((b) => ({
      ...b,
      initialQuantity: Number(b.initialQuantity),
      currentQuantity: Number(b.currentQuantity),
    }));

    return NextResponse.json({ batches });
  } catch (error) {
    console.error('Error fetching batches:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = updateStatusSchema.parse(body);

    const [updated] = await db
      .update(inventoryBatches)
      .set({
        status: validated.status as (typeof inventoryBatches.$inferInsert)['status'],
        updatedAt: new Date(),
      })
      .where(eq(inventoryBatches.id, validated.batchId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Lote no encontrado' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      batch: {
        ...updated,
        initialQuantity: Number(updated.initialQuantity),
        currentQuantity: Number(updated.currentQuantity),
      },
    });
  } catch (error) {
    console.error('Error updating batch status:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Error al actualizar lote' }, { status: 500 });
  }
}

