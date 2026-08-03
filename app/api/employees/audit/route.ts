import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { employeeAuditLogs, users } from '@/lib/db/schema';
import { eq, desc, and, gte, lte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// GET - Get audit logs for an employee or company
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');
    const isSensitive = searchParams.get('isSensitive');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Build conditions array — always scoped to authenticated tenant
    const conditions = [];

    if (userId) {
      // If requesting a specific user's audit, it must be in the same tenant
      conditions.push(eq(employeeAuditLogs.userId, userId));
    }

    // Always filter by tenant: get all users in the authenticated company
    const companyUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.companyId, auth.tenantId));

    const userIds = companyUsers.map(u => u.id);

    if (userIds.length > 0) {
      conditions.push(inArray(employeeAuditLogs.userId, userIds));
    } else {
      return NextResponse.json({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    }

    if (entityType) {
      conditions.push(eq(employeeAuditLogs.entityType, entityType));
    }

    if (action) {
      conditions.push(eq(employeeAuditLogs.action, action as any));
    }

    if (isSensitive !== null && isSensitive !== undefined) {
      conditions.push(eq(employeeAuditLogs.isSensitive, isSensitive === 'true'));
    }

    if (startDate) {
      conditions.push(gte(employeeAuditLogs.performedAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(employeeAuditLogs.performedAt, new Date(endDate)));
    }

    // Execute query with all conditions
    const logs = await db
      .select({
        id: employeeAuditLogs.id,
        userId: employeeAuditLogs.userId,
        action: employeeAuditLogs.action,
        entityType: employeeAuditLogs.entityType,
        entityId: employeeAuditLogs.entityId,
        fieldName: employeeAuditLogs.fieldName,
        oldValue: employeeAuditLogs.oldValue,
        newValue: employeeAuditLogs.newValue,
        performedBy: employeeAuditLogs.performedBy,
        performedAt: employeeAuditLogs.performedAt,
        ipAddress: employeeAuditLogs.ipAddress,
        userAgent: employeeAuditLogs.userAgent,
        reason: employeeAuditLogs.reason,
        isSensitive: employeeAuditLogs.isSensitive,
        requiresApproval: employeeAuditLogs.requiresApproval,
        approvedBy: employeeAuditLogs.approvedBy,
        approvedAt: employeeAuditLogs.approvedAt,
        createdAt: employeeAuditLogs.createdAt,
        performedByName: users.name,
        performedByEmail: users.email,
      })
      .from(employeeAuditLogs)
      .leftJoin(users, eq(employeeAuditLogs.performedBy, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(employeeAuditLogs.performedAt));

    // Pagination
    const offset = (page - 1) * limit;
    const paginatedLogs = logs.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: paginatedLogs,
      pagination: {
        page,
        limit,
        total: logs.length,
        totalPages: Math.ceil(logs.length / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
});

// POST - Create audit log (usually called automatically by other endpoints)
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();

    const validationSchema = z.object({
      userId: z.string(),
      action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 'IMPORT']),
      entityType: z.string(),
      entityId: z.string().optional(),
      fieldName: z.string().optional(),
      oldValue: z.any().optional(),
      newValue: z.any().optional(),
      reason: z.string().optional(),
      isSensitive: z.boolean().optional(),
      requiresApproval: z.boolean().optional(),
      ipAddress: z.string().optional(),
      userAgent: z.string().optional(),
    });

    const validatedData = validationSchema.parse(body);

    const [newLog] = await db
      .insert(employeeAuditLogs)
      .values({
        userId: validatedData.userId,
        action: validatedData.action,
        entityType: validatedData.entityType,
        entityId: validatedData.entityId,
        fieldName: validatedData.fieldName,
        oldValue: validatedData.oldValue,
        newValue: validatedData.newValue,
        performedBy: auth.user.id, // ALWAYS from session
        reason: validatedData.reason,
        isSensitive: validatedData.isSensitive || false,
        requiresApproval: validatedData.requiresApproval || false,
        ipAddress: validatedData.ipAddress,
        userAgent: validatedData.userAgent,
      })
      .returning();

    return NextResponse.json(
      {
        success: true,
        data: newLog,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 422 }
      );
    }

    console.error('Error creating audit log:', error);
    return NextResponse.json(
      { error: 'Failed to create audit log' },
      { status: 500 }
    );
  }
});
