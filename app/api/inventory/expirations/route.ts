import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { eq, and, gte, lte, isNull, sql } from 'drizzle-orm';
import { inventoryBatches, inventoryItems, branches } from '@/lib/db/schema';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const daysAhead = parseInt(searchParams.get('daysAhead') || '7');
    const includeExpired = searchParams.get('includeExpired') === 'true';
    const itemId = searchParams.get('itemId');
    const status = searchParams.get('status');

    // Calculate date range
    const now = new Date();
    const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    // Build where clause
    let whereClause = and(
      gte(inventoryBatches.currentQuantity, '0'),
      status ? eq(inventoryBatches.status, status as any) : undefined
    );

    if (!includeExpired) {
      whereClause = and(
        whereClause,
        gte(inventoryBatches.expirationDate, now)
      );
    }

    whereClause = and(
      whereClause,
      lte(inventoryBatches.expirationDate, futureDate)
    );

    if (branchId) {
      whereClause = and(whereClause, eq(inventoryBatches.branchId, branchId as any));
    }

    if (itemId) {
      whereClause = and(whereClause, eq(inventoryBatches.itemId, itemId as any));
    }

    // Fetch batches with item and branch info
    const batches = await db
      .select({
        id: inventoryBatches.id,
        lotNumber: inventoryBatches.lotNumber,
        currentQuantity: inventoryBatches.currentQuantity,
        expirationDate: inventoryBatches.expirationDate,
        status: inventoryBatches.status,
        branchName: branches.name,
        itemName: inventoryItems.name,
        itemId: inventoryItems.id,
        unit: inventoryItems.unit,
      })
      .from(inventoryBatches)
      .innerJoin(inventoryItems, eq(inventoryBatches.itemId, inventoryItems.id))
      .innerJoin(branches, eq(inventoryBatches.branchId, branches.id))
      .where(whereClause)
      .orderBy(inventoryBatches.expirationDate);

    // Format response
    const items = batches.map((batch) => {
      const expirationDate = batch.expirationDate || new Date();
      const daysUntilExpiration = Math.ceil(
        (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        itemId: batch.itemId,
        itemName: batch.itemName,
        batchId: batch.id,
        lotNumber: batch.lotNumber || 'N/A',
        currentQuantity: batch.currentQuantity,
        expirationDate,
        daysUntilExpiration,
        branchName: batch.branchName,
        unit: batch.unit,
      };
    });

    // Calculate summary
    const summary = {
      totalItems: items.length,
      expiringSoon: items.filter((i) => i.daysUntilExpiration >= 0 && i.daysUntilExpiration <= 7).length,
      alreadyExpired: items.filter((i) => i.daysUntilExpiration < 0).length,
      estimatedLoss: items.reduce((acc, item) => {
        // This would need actual cost data, using 0 for now
        return acc;
      }, 0),
    };

    return NextResponse.json({ items, summary });
  } catch (error) {
    console.error('Error fetching expirations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
