import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { eq, and, gte, desc } from 'drizzle-orm';
import { hasPermission, type Role } from '@/lib/permissions';
import { resolveBranchScope } from '@/lib/branch-scope';
import { ApiError, isApiError } from '@/lib/api/error';
import { AuditService } from '@/lib/services/audit-service';
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
} from '@/lib/db/schema';
import { z } from 'zod';

const updateStatusSchema = z.object({
  batchId: z.string().uuid(),
  status: z.enum(['AVAILABLE', 'RESERVED', 'EXPIRED', 'QUARANTINED', 'DEPLETED']),
  notes: z.string().trim().min(1).max(1000),
}).strict();

const querySchema = z.object({
  id: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  status: updateStatusSchema.shape.status.optional(),
  trace: z.enum(['true', 'false']).optional(),
}).refine(data => data.trace !== 'true' || data.id || data.batchId, 'Falta identificar el lote')
  .refine(data => !data.id || !data.batchId || data.id === data.batchId, 'Identificadores incompatibles');

function batchScope(user: { companyId: string; role?: string; branchId?: string | null }, requestedBranchId?: string) {
  // EMPLEADO sigue el alcance local del ABAC; el helper histórico sólo incluye gerente/supervisor.
  const role = user.role === 'EMPLEADO' ? 'SUPERVISOR' : user.role as Role;
  const scope = resolveBranchScope(role, user.branchId, requestedBranchId);
  if (scope.kind === 'NONE' || (scope.kind === 'BRANCH' && !z.string().uuid().safeParse(scope.branchId).success)) {
    throw ApiError.forbidden('Se requiere una sucursal asignada válida');
  }
  if (scope.kind === 'BRANCH' && requestedBranchId && scope.branchId !== requestedBranchId) {
    throw ApiError.forbidden('No tienes acceso a la sucursal solicitada');
  }
  return and(eq(branches.companyId, user.companyId), eq(inventoryItems.companyId, user.companyId),
    scope.kind === 'BRANCH' ? eq(inventoryBatches.branchId, scope.branchId) : undefined);
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.companyId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasPermission(session.user.role as Role, 'inventory', 'read')) {
      throw ApiError.forbidden('No tienes permisos para consultar lotes');
    }

    const { searchParams } = new URL(request.url);
    const filters = querySchema.parse(Object.fromEntries(
      ['id', 'batchId', 'itemId', 'branchId', 'status', 'trace']
        .filter(key => searchParams.has(key)).map(key => [key, searchParams.get(key)])
    ));
    const batchId = filters.id || filters.batchId;
    const isTrace = filters.trace === 'true';
    const scope = batchScope({ ...session.user, companyId: session.user.companyId }, filters.branchId);

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
        .leftJoin(suppliers, and(eq(inventoryBatches.supplierId, suppliers.id), eq(suppliers.companyId, session.user.companyId)))
        .where(and(scope, eq(inventoryBatches.id, batchId)))
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
        .leftJoin(recipes, and(eq(productionResults.recipeId, recipes.id), eq(recipes.companyId, session.user.companyId)))
        .where(and(eq(productionIngredients.batchId, batchId), eq(productionIngredients.itemId, batch.itemId),
          eq(productionResults.companyId, session.user.companyId), eq(productionResults.branchId, batch.branchId)))
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
        .where(and(eq(inventoryWaste.batchId, batchId), eq(inventoryWaste.companyId, session.user.companyId),
          eq(inventoryWaste.branchId, batch.branchId), eq(inventoryWaste.itemId, batch.itemId)))
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
        .where(and(eq(inventoryMovements.batchId, batchId), eq(inventoryMovements.branchId, batch.branchId),
          eq(inventoryMovements.itemId, batch.itemId)))
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

    const { itemId, status } = filters;

    // Build where clause
    let whereClause = and(
      scope, gte(inventoryBatches.currentQuantity, '0'),
      batchId ? eq(inventoryBatches.id, batchId) : undefined
    );

    if (itemId) {
      whereClause = and(whereClause, eq(inventoryBatches.itemId, itemId));
    }

    if (status) {
      whereClause = and(whereClause, eq(inventoryBatches.status, status));
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
    if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 });
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

    if (!session?.user?.companyId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = { ...session.user, companyId: session.user.companyId };
    if (!hasPermission(user.role as Role, 'inventory', 'update')) {
      throw ApiError.forbidden('No tienes permisos para cambiar el estado de lotes');
    }
    const scope = batchScope(user);

    const body = await request.json();
    const validated = updateStatusSchema.parse(body);

    const updated = await db.transaction(async tx => {
      const [row] = await tx.select({ batch: inventoryBatches }).from(inventoryBatches)
        .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
        .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
        .where(and(scope, eq(inventoryBatches.id, validated.batchId)))
        .limit(1).for('update', { of: inventoryBatches });
      if (!row) throw ApiError.notFound('Lote no encontrado');
      const batch = row.batch;
      if (batch.status === validated.status) return batch;

      const immobilize = batch.status === 'AVAILABLE' && validated.status === 'QUARANTINED';
      const reserve = batch.status === 'AVAILABLE' && validated.status === 'RESERVED';
      const release = (batch.status === 'QUARANTINED' || batch.status === 'RESERVED') && validated.status === 'AVAILABLE';
      if (!immobilize && !reserve && !release) {
        throw ApiError.conflict('El cambio de estado no está permitido; agotamiento y vencimiento se determinan por saldo y fecha');
      }
      if (!immobilize && !hasPermission(user.role as Role, 'inventory', 'manage')) {
        throw ApiError.forbidden('Se requiere un gerente o superior para reservar o liberar lotes');
      }
      if (release && (Number(batch.currentQuantity) <= 0 || !batch.expirationDate || batch.expirationDate <= new Date())) {
        // Hasta contar con política explícita sin caducidad, fecha nula es dato faltante.
        throw ApiError.conflict('Para liberar el lote se requiere saldo positivo y fecha de caducidad vigente');
      }

      const [changed] = await tx.update(inventoryBatches)
        .set({ status: validated.status, updatedAt: new Date() })
        .where(eq(inventoryBatches.id, batch.id)).returning();
      await AuditService.logInventoryAction({ companyId: user.companyId, branchId: batch.branchId,
        entityType: 'BATCH', entityId: batch.id, action: 'UPDATE', performedBy: user.id,
        reason: validated.notes, oldValue: { status: batch.status }, newValue: { status: validated.status },
      }, tx);
      return changed;
    });

    return NextResponse.json({
      success: true,
      batch: {
        ...updated,
        initialQuantity: Number(updated.initialQuantity),
        currentQuantity: Number(updated.currentQuantity),
      },
    });
  } catch (error) {
    if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    console.error('Error updating batch status:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos', details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Error al actualizar lote' }, { status: 500 });
  }
}

