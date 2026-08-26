import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { eq, and, gte } from 'drizzle-orm';
import { inventoryBatches, branches, inventoryItems } from '@/lib/db/schema';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
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
        // Enriquecido para la vista de lotes (/dashboard/inventory/lotes); los
        // consumidores previos ignoran estos campos extra.
        itemName: inventoryItems.name,
        itemSku: inventoryItems.sku,
        itemUnit: inventoryItems.unit,
      })
      .from(inventoryBatches)
      .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
      .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
      .where(whereClause)
      .orderBy(inventoryBatches.expirationDate);

    // `initial_quantity`/`current_quantity` son numeric(12,4) desde la 0051 →
    // drizzle las devuelve como string ("2.5000"). Los tres consumidores del
    // endpoint (waste-form, lot-selector, product-detail-drawer) las declaran
    // `number` y las comparan y renderizan como tales: sin esta coerción el
    // stock se pinta "2.5000" y `currentQuantity === 1` nunca es cierto.
    // Va DESPUÉS de la query — drizzle no acepta `Number(col)` dentro del
    // objeto de `db.select()` (patrón T4).
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
