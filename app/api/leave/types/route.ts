import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { leaveTypes, leaveRequests, leaveBalances, users } from '@/lib/db/schema';
import { eq, and, desc, or } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Validation schemas — companyId from session
const createLeaveTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  isPaid: z.boolean().default(true),
  requiresDocumentation: z.boolean().default(false),
  maxDaysPerYear: z.number().optional(),
  accrualRate: z.number().optional(),
  isActive: z.boolean().default(true),
});

const updateLeaveTypeSchema = createLeaveTypeSchema.partial();

// GET - List leave types for a company
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get('isActive');

    const companyId = auth.tenantId;

    const conditions = [eq(leaveTypes.companyId, companyId)];

    if (isActive !== null && isActive !== undefined) {
      conditions.push(eq(leaveTypes.isActive, isActive === 'true'));
    }

    const types = await db
      .select()
      .from(leaveTypes)
      .where(and(...conditions))
      .orderBy(leaveTypes.name);

    return NextResponse.json({ leaveTypes: types });
  } catch (error) {
    console.error('Error fetching leave types:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leave types' },
      { status: 500 }
    );
  }
});

// POST - Create a new leave type
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const validated = createLeaveTypeSchema.safeParse(body);

  if (!validated.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validated.error.issues },
      { status: 400 }
    );
  }

  const [newType] = await db
      .insert(leaveTypes)
      .values({ ...validated.data, companyId: auth.tenantId })
      .returning();

    return NextResponse.json(
      { leaveType: newType, message: 'Leave type created successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating leave type:', error);
    return NextResponse.json(
      { error: 'Failed to create leave type' },
      { status: 500 }
    );
  }
});

// PATCH - Update a leave type
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const leaveTypeId = searchParams.get('id');

    if (!leaveTypeId) {
      return NextResponse.json(
        { error: 'Leave type ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validated = updateLeaveTypeSchema.safeParse(body);

  if (!validated.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validated.error.issues },
      { status: 400 }
    );
  }

  const [updatedType] = await db
      .update(leaveTypes)
      .set({
        ...validated.data,
        updatedAt: new Date(),
      })
      .where(eq(leaveTypes.id, leaveTypeId))
      .returning();

    if (!updatedType) {
      return NextResponse.json(
        { error: 'Leave type not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      leaveType: updatedType,
      message: 'Leave type updated successfully',
    });
  } catch (error) {
    console.error('Error updating leave type:', error);
    return NextResponse.json(
      { error: 'Failed to update leave type' },
      { status: 500 }
    );
  }
});
