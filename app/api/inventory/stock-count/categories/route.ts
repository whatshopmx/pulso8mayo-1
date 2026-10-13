import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { inventoryItems } from '@/lib/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { requirePermissionApi } from '@/lib/rbac/abac';
import { ApiError, isApiError } from '@/lib/api/error';

export async function GET() {
  try {
    const { user } = await requirePermissionApi('inventory', 'read');
    if (!user.companyId) throw ApiError.forbidden('Tu usuario no tiene una empresa asignada.');
    const categories = await db.select({ category: inventoryItems.category, productCount: sql<number>`count(*)::int` })
      .from(inventoryItems).where(and(eq(inventoryItems.companyId, user.companyId), eq(inventoryItems.active, true)))
      .groupBy(inventoryItems.category).orderBy(asc(inventoryItems.category));
    return NextResponse.json(categories.filter(row => row.category?.trim()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudieron cargar las categorías.' }, { status: isApiError(error) ? error.statusCode : 500 });
  }
}
