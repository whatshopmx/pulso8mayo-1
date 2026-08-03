import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { leaveBalances, leaveTypes, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Validation schema for updating balance (userId from session)
const upsertBalanceSchema = z.object({
  leaveTypeId: z.string().uuid(),
  year: z.number().min(2000).max(2100),
  totalEntitlement: z.number().min(0),
  used: z.number().min(0).default(0),
  pending: z.number().min(0).default(0),
  balance: z.number(),
});

// GET - Get leave balances for a user
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || auth.user.id;
    const year = searchParams.get('year');

    const conditions = [eq(leaveBalances.userId, userId)];

    if (year) {
      conditions.push(eq(leaveBalances.year, parseInt(year)));
    }

    const balances = await db
      .select({
        id: leaveBalances.id,
        userId: leaveBalances.userId,
        leaveTypeId: leaveBalances.leaveTypeId,
        year: leaveBalances.year,
        totalEntitlement: leaveBalances.totalEntitlement,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
        balance: leaveBalances.balance,
        updatedAt: leaveBalances.updatedAt,
        leaveTypeName: leaveTypes.name,
        leaveTypeDescription: leaveTypes.description,
        isPaid: leaveTypes.isPaid,
      })
      .from(leaveBalances)
      .leftJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(and(...conditions));

    return NextResponse.json({ balances });
  } catch (error) {
    console.error('Error fetching leave balances:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leave balances' },
      { status: 500 }
    );
  }
});

// POST - Create or update a leave balance
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const validated = upsertBalanceSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validated.error.issues },
        { status: 400 }
      );
    }

    const data = validated.data;

    // Check if balance already exists
    const [existingBalance] = await db
      .select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.userId, auth.user.id),
          eq(leaveBalances.leaveTypeId, data.leaveTypeId),
          eq(leaveBalances.year, data.year)
        )
      );

    if (existingBalance) {
      // Update existing balance
      const [updatedBalance] = await db
        .update(leaveBalances)
        .set({
          ...data,
          userId: auth.user.id,
          updatedAt: new Date(),
        })
        .where(eq(leaveBalances.id, existingBalance.id))
        .returning();

      return NextResponse.json({
        balance: updatedBalance,
        message: 'Leave balance updated successfully',
      });
    } else {
      // Create new balance
      const [newBalance] = await db
        .insert(leaveBalances)
        .values({
          ...data,
          userId: auth.user.id,
        })
        .returning();

      return NextResponse.json(
        { balance: newBalance, message: 'Leave balance created successfully' },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error('Error upserting leave balance:', error);
    return NextResponse.json(
      { error: 'Failed to update leave balance' },
      { status: 500 }
    );
  }
});

// PATCH - Bulk update leave balances (e.g., annual accrual)
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const { userIds, leaveTypeId, year, accrualRate } = body;

    if (!userIds || !Array.isArray(userIds) || !leaveTypeId || !year || accrualRate === undefined) {
      return NextResponse.json(
        { error: 'userIds, leaveTypeId, year, and accrualRate are required' },
        { status: 400 }
      );
    }

    // Create or update balances for all users
    const results = [];

    for (const userId of userIds) {
      const [existingBalance] = await db
        .select()
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.userId, userId),
            eq(leaveBalances.leaveTypeId, leaveTypeId),
            eq(leaveBalances.year, year)
          )
        );

      if (existingBalance) {
        const [updated] = await db
          .update(leaveBalances)
          .set({
            totalEntitlement: accrualRate,
            balance: accrualRate - existingBalance.used - existingBalance.pending,
            updatedAt: new Date(),
          })
          .where(eq(leaveBalances.id, existingBalance.id))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db
          .insert(leaveBalances)
          .values({
            userId,
            leaveTypeId,
            year,
            totalEntitlement: accrualRate,
            used: 0,
            pending: 0,
            balance: accrualRate,
          })
          .returning();
        results.push(created);
      }
    }

    return NextResponse.json({
      message: `Leave balances accrued for ${results.length} users`,
      count: results.length,
    });
  } catch (error) {
    console.error('Error accruing leave balances:', error);
    return NextResponse.json(
      { error: 'Failed to accrue leave balances' },
      { status: 500 }
    );
  }
});
