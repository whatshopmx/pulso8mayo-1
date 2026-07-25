import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { AuditService } from '@/lib/services/audit-service';
import type { InventoryAuditAction, InventoryAuditEntity } from '@/lib/services/audit-service';

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get('branchId') || undefined;
    const entityType = searchParams.get('entityType') as InventoryAuditEntity | undefined;
    const action = searchParams.get('action') as InventoryAuditAction | undefined;
    const entityId = searchParams.get('entityId') || undefined;
    const performedBy = searchParams.get('performedBy') || undefined;
    const dateFrom = searchParams.get('dateFrom') ? new Date(searchParams.get('dateFrom')!) : undefined;
    const dateTo = searchParams.get('dateTo') ? new Date(searchParams.get('dateTo')!) : undefined;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const result = await AuditService.getInventoryAuditLogs({
      companyId: session.user.companyId || '',
      branchId,
      entityType,
      action,
      entityId,
      performedBy,
      dateFrom,
      dateTo,
      limit: Math.min(limit, 200),
      offset,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Inventory Audit] Error fetching logs:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
