import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { inventoryMovements, inventoryItems, users } from '@/lib/db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { startOfDay, endOfDay } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');
    const date = searchParams.get('date');

    const targetDate = date ? new Date(date) : new Date();
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);

    const conditions = [
      gte(inventoryMovements.timestamp, dayStart),
      lte(inventoryMovements.timestamp, dayEnd),
    ];

    // @ts-ignore
    if (branchId && branchId !== 'all') conditions.push(eq(inventoryMovements.branchId, branchId));

    const movements = await db
      .select({
        id: inventoryMovements.id,
        type: inventoryMovements.type,
        itemId: inventoryMovements.itemId,
        itemName: inventoryItems.name,
        quantityChange: inventoryMovements.quantityChange,
        reason: inventoryMovements.reason,
        performedBy: inventoryMovements.performedBy,
        performerName: users.name,
        timestamp: inventoryMovements.timestamp,
      })
      .from(inventoryMovements)
      .leftJoin(inventoryItems, eq(inventoryMovements.itemId, inventoryItems.id))
      .leftJoin(users, eq(inventoryMovements.performedBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(inventoryMovements.timestamp))
      .limit(50);

    const typeLabels: Record<string, string> = {
      RECEIVING: 'Recepción',
      USAGE: 'Uso',
      ADJUSTMENT: 'Ajuste',
      TRANSFER: 'Transferencia',
      WASTE: 'Merma',
      RETURN: 'Devolución',
    };

    return NextResponse.json({
      date: targetDate.toISOString().split('T')[0],
      totalMovements: movements.length,
      movements: movements.map(m => ({
        id: m.id,
        type: m.type,
        typeLabel: typeLabels[m.type] || m.type,
        itemName: m.itemName || 'Producto desconocido',
        quantityChange: Number(m.quantityChange),
        reason: m.reason,
        performerName: m.performerName || 'Sistema',
        timestamp: m.timestamp,
      })),
    });
  } catch (error) {
    console.error('Error fetching inventory activity:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory activity' }, { status: 500 });
  }
}
