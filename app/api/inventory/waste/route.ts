import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { inventoryWaste, inventoryBatches, inventoryItems, inventoryMovements } from '@/lib/db/schema';
import { AuditService } from '@/lib/services/audit-service';

// GET /api/inventory/waste - Get waste history
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

    // Build query conditions
    const conditions = [
      eq(inventoryWaste.companyId, session.user.companyId),
    ];

    if (branchId) {
      conditions.push(eq(inventoryWaste.branchId, branchId));
    }

    // Fetch waste records with item and batch info
    const wasteRecords = await db
      .select({
        waste: inventoryWaste,
        item: {
          id: inventoryItems.id,
          name: inventoryItems.name,
          sku: inventoryItems.sku,
          unit: inventoryItems.unit,
        },
        batch: {
          id: inventoryBatches.id,
          lotNumber: inventoryBatches.lotNumber,
          expirationDate: inventoryBatches.expirationDate,
        },
      })
      .from(inventoryWaste)
      .leftJoin(inventoryItems, eq(inventoryWaste.itemId, inventoryItems.id))
      .leftJoin(inventoryBatches, eq(inventoryWaste.batchId, inventoryBatches.id))
      .where(and(...conditions))
      .orderBy(desc(inventoryWaste.recordedAt));

    return NextResponse.json({ waste: wasteRecords });
  } catch (error) {
    console.error('Error fetching waste records:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      branchId,
      batchId,
      itemId,
      quantity,
      unit,
      reason,
      costPerUnit,
      totalLoss,
      notes,
    } = body;

    // Validate required fields
    if (!branchId || !itemId || !quantity || !unit || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate quantity
    if (quantity <= 0) {
      return NextResponse.json(
        { error: 'Quantity must be greater than 0' },
        { status: 400 }
      );
    }

    // Check if batch has enough stock
    let updatedStock = null;
    if (batchId) {
      const batch = await db.query.inventoryBatches.findFirst({
        where: eq(inventoryBatches.id, batchId),
      });

      if (!batch) {
        return NextResponse.json(
          { error: 'Batch not found' },
          { status: 404 }
        );
      }

      if (Number(batch.currentQuantity) < quantity) {
        return NextResponse.json(
          { error: 'Insufficient batch stock' },
          { status: 400 }
        );
      }

      // Update batch quantity
      const newQuantity = Number(batch.currentQuantity) - quantity;
      await db
        .update(inventoryBatches)
        .set({
          currentQuantity: String(newQuantity), // numeric(12,4): string en TS
          status: newQuantity === 0 ? 'DEPLETED' : batch.status,
          updatedAt: new Date(),
        })
        .where(eq(inventoryBatches.id, batchId));

      updatedStock = newQuantity;
    }

    // Create waste record
    const [waste] = await db
      .insert(inventoryWaste)
      .values({
        companyId: session.user.companyId,
        branchId,
        batchId: batchId || null,
        itemId,
        quantity,
        unit,
        reason,
        costPerUnit: costPerUnit ? Math.round(costPerUnit * 100) : null, // Convert to cents
        totalLoss: totalLoss ? Math.round(totalLoss * 100) : null, // Convert to cents
        recordedBy: session.user.id,
        recordedAt: new Date(),
        notes: notes || null,
      })
      .returning();

    // Create inventory movement
    // COURTESY se trata igual que STAFF: es consumo (regalo a cliente), no
    // desperdicio — no debe inflar el % de merma (OQ-1).
    const consumoInterno = reason === 'STAFF' || reason === 'COURTESY';
    await db
      .insert(inventoryMovements)
      .values({
        branchId,
        itemId,
        batchId: batchId || null,
        type: consumoInterno ? 'USAGE' : 'WASTE',
        quantityChange: String(-quantity), // numeric(12,4): string en TS; negativo porque quita stock
        reason: consumoInterno
          ? reason === 'STAFF'
            ? 'Consumo de Personal'
            : 'Cortesía a Cliente'
          : `WASTE: ${reason}`,
        performedBy: session.user.id,
        timestamp: new Date(),
      });

    AuditService.logInventoryAction({
      companyId: session.user.companyId,
      branchId,
      action: 'CREATE',
      entityType: 'WASTE',
      entityId: waste.id,
      newValue: { itemId, quantity, unit, reason, notes },
      performedBy: session.user.id,
      reason: `Waste: ${reason}`,
      metadata: { batchId, costPerUnit, totalLoss, notes },
    });

    return NextResponse.json({
      success: true,
      waste,
      updatedStock,
    });
  } catch (error) {
    console.error('Error creating waste record:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
