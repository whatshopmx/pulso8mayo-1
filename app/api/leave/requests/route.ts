import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { leaveRequests, leaveBalances, users, branches } from '@/lib/db/schema';
import { eq, and, desc, or, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Validation schemas — userId and companyId come from session, not body
const createLeaveRequestSchema = z.object({
  branchId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  totalDays: z.number().min(1),
  reason: z.string().min(1),
  supportingDocumentId: z.string().uuid().optional(),
});

const rejectLeaveRequestSchema = z.object({
  rejectionReason: z.string().min(1),
});

// GET - List leave requests
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const leaveTypeId = searchParams.get('leaveTypeId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const conditions = [eq(leaveRequests.companyId, auth.tenantId)];

    if (userId) conditions.push(eq(leaveRequests.userId, userId));
    if (leaveTypeId) conditions.push(eq(leaveRequests.leaveTypeId, leaveTypeId));
    if (status) conditions.push(eq(leaveRequests.status, status as any));
    if (startDate) conditions.push(gte(leaveRequests.startDate, new Date(startDate)));
    if (endDate) conditions.push(lte(leaveRequests.endDate, new Date(endDate)));

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(and(...conditions));

    const requests = await db
      .select({
        id: leaveRequests.id,
        userId: leaveRequests.userId,
        companyId: leaveRequests.companyId,
        branchId: leaveRequests.branchId,
        leaveTypeId: leaveRequests.leaveTypeId,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        totalDays: leaveRequests.totalDays,
        reason: leaveRequests.reason,
        status: leaveRequests.status,
        requestedAt: leaveRequests.requestedAt,
        approvedBy: leaveRequests.approvedBy,
        approvedAt: leaveRequests.approvedAt,
        rejectedBy: leaveRequests.rejectedBy,
        rejectedAt: leaveRequests.rejectedAt,
        rejectionReason: leaveRequests.rejectionReason,
        createdAt: leaveRequests.createdAt,
        userName: users.name,
        userPhoto: users.image,
      })
      .from(leaveRequests)
      .leftJoin(users, eq(leaveRequests.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(leaveRequests.requestedAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      requests,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching leave requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leave requests' },
      { status: 500 }
    );
  }
});

// POST - Create a new leave request
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const validated = createLeaveRequestSchema.safeParse(body);

  if (!validated.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validated.error.issues },
      { status: 400 }
    );
  }

  const data = validated.data;

  // Check leave balance
    const [balance] = await db
      .select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.userId, auth.user.id),
          eq(leaveBalances.leaveTypeId, data.leaveTypeId),
          eq(leaveBalances.year, new Date().getFullYear())
        )
      );

    if (balance && balance.balance < data.totalDays) {
      return NextResponse.json(
        { error: 'Insufficient leave balance', balance: balance.balance, requested: data.totalDays },
        { status: 400 }
      );
    }

    const [newRequest] = await db
      .insert(leaveRequests)
      .values({
        ...data,
        userId: auth.user.id,
        companyId: auth.tenantId,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        status: 'PENDING',
        createdBy: auth.user.id,
      })
      .returning();

    // Update pending balance if exists
    if (balance) {
      await db
        .update(leaveBalances)
        .set({
          pending: balance.pending + data.totalDays,
          updatedAt: new Date(),
        })
        .where(eq(leaveBalances.id, balance.id));
    }

    return NextResponse.json(
      { request: newRequest, message: 'Leave request created successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating leave request:', error);
    return NextResponse.json(
      { error: 'Failed to create leave request' },
      { status: 500 }
    );
  }
});

// PATCH - Update leave request (approve/reject)
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('id');
    const action = searchParams.get('action'); // 'approve' or 'reject'

    if (!requestId) {
      return NextResponse.json(
        { error: 'Request ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();

    let updateData: any = {
      updatedAt: new Date(),
    };

  if (action === 'approve') {
    updateData = {
        ...updateData,
        status: 'APPROVED',
        approvedBy: auth.user.id, // ALWAYS from session
        approvedAt: new Date(),
      };
  } else if (action === 'reject') {
    const validated = rejectLeaveRequestSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validated.error.issues },
        { status: 400 }
      );
    }

    updateData = {
        ...updateData,
        status: 'REJECTED',
        rejectedBy: auth.user.id, // ALWAYS from session
        rejectedAt: new Date(),
        rejectionReason: validated.data.rejectionReason,
      };
    } else {
      // Generic update
      updateData = { ...body, updatedAt: new Date() };
    }

    const [updatedRequest] = await db
      .update(leaveRequests)
      .set(updateData)
      .where(eq(leaveRequests.id, requestId))
      .returning();

    if (!updatedRequest) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    // If approved, update balance
    if (action === 'approve') {
      const [balance] = await db
        .select()
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.userId, updatedRequest.userId),
            eq(leaveBalances.leaveTypeId, updatedRequest.leaveTypeId),
            eq(leaveBalances.year, new Date().getFullYear())
          )
        );

      if (balance) {
        await db
          .update(leaveBalances)
          .set({
            used: balance.used + updatedRequest.totalDays,
            pending: Math.max(0, balance.pending - updatedRequest.totalDays),
            balance: balance.balance - updatedRequest.totalDays,
            updatedAt: new Date(),
          })
          .where(eq(leaveBalances.id, balance.id));
      }
    }

    // If rejected, reduce pending
    if (action === 'reject') {
      const [balance] = await db
        .select()
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.userId, updatedRequest.userId),
            eq(leaveBalances.leaveTypeId, updatedRequest.leaveTypeId),
            eq(leaveBalances.year, new Date().getFullYear())
          )
        );

      if (balance) {
        await db
          .update(leaveBalances)
          .set({
            pending: Math.max(0, balance.pending - updatedRequest.totalDays),
            updatedAt: new Date(),
          })
          .where(eq(leaveBalances.id, balance.id));
      }
    }

    return NextResponse.json({
      request: updatedRequest,
      message: action === 'approve' ? 'Leave request approved' : action === 'reject' ? 'Leave request rejected' : 'Leave request updated successfully',
    });
  } catch (error) {
    console.error('Error updating leave request:', error);
    return NextResponse.json(
      { error: 'Failed to update leave request' },
      { status: 500 }
    );
  }
});

// DELETE - Cancel a leave request
export const DELETE = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('id');

    if (!requestId) {
      return NextResponse.json(
        { error: 'Request ID is required' },
        { status: 400 }
      );
    }

    const userId = auth.user.id;

    const [leaveRequest] = await db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.id, requestId));

    if (!leaveRequest) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    if (leaveRequest.userId !== userId && leaveRequest.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only pending requests can be cancelled' },
        { status: 400 }
      );
    }

    const [cancelledRequest] = await db
      .update(leaveRequests)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(eq(leaveRequests.id, requestId))
      .returning();

    // Reduce pending balance
    const [balance] = await db
      .select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.userId, userId),
          eq(leaveBalances.leaveTypeId, leaveRequest.leaveTypeId),
          eq(leaveBalances.year, new Date().getFullYear())
        )
      );

    if (balance) {
      await db
        .update(leaveBalances)
        .set({
          pending: Math.max(0, balance.pending - leaveRequest.totalDays),
          updatedAt: new Date(),
        })
        .where(eq(leaveBalances.id, balance.id));
    }

    return NextResponse.json({
      request: cancelledRequest,
      message: 'Leave request cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling leave request:', error);
    return NextResponse.json(
      { error: 'Failed to cancel leave request' },
      { status: 500 }
    );
  }
});
