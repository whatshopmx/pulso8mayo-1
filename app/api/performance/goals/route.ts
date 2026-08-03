import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { performanceGoals, users } from '@/lib/db/schema';
import { eq, and, desc, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Validation schemas — userId and companyId from session
const createGoalSchema = z.object({
  branchId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('NOT_STARTED'),
  targetDate: z.string().optional(),
  metrics: z.any().optional(),
});

const updateGoalSchema = createGoalSchema.partial();

// GET - List performance goals
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const conditions = [eq(performanceGoals.companyId, auth.tenantId)];

    if (userId) conditions.push(eq(performanceGoals.userId, userId));
    if (status) conditions.push(eq(performanceGoals.status, status as any));
    if (category) conditions.push(eq(performanceGoals.category, category));

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(performanceGoals)
      .where(and(...conditions));

    const goals = await db
      .select({
        id: performanceGoals.id,
        userId: performanceGoals.userId,
        companyId: performanceGoals.companyId,
        branchId: performanceGoals.branchId,
        title: performanceGoals.title,
        description: performanceGoals.description,
        category: performanceGoals.category,
        status: performanceGoals.status,
        targetDate: performanceGoals.targetDate,
        completedDate: performanceGoals.completedDate,
        metrics: performanceGoals.metrics,
        createdAt: performanceGoals.createdAt,
        updatedAt: performanceGoals.updatedAt,
        userName: users.name,
      })
      .from(performanceGoals)
      .leftJoin(users, eq(performanceGoals.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(performanceGoals.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      goals,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching performance goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch performance goals' },
      { status: 500 }
    );
  }
});

// POST - Create a new goal
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    // userId from body for who the goal is assigned to; companyId from session
    const { userId: goalUserId, ...rest } = body;
    const validated = createGoalSchema.safeParse(rest);

  if (!validated.success || !goalUserId) {
    if (!goalUserId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Invalid input', details: validated.error.issues },
      { status: 400 }
    );
  }

  const data = validated.data;

    const [newGoal] = await db
      .insert(performanceGoals)
      .values({
        ...data,
        userId: goalUserId,
        companyId: auth.tenantId,
        targetDate: data.targetDate ? new Date(data.targetDate) : undefined,
        createdBy: auth.user.id,
      })
      .returning();

    return NextResponse.json(
      { goal: newGoal, message: 'Performance goal created successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating performance goal:', error);
    return NextResponse.json(
      { error: 'Failed to create performance goal' },
      { status: 500 }
    );
  }
});

// PATCH - Update a goal
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const goalId = searchParams.get('id');

    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validated = updateGoalSchema.safeParse(body);

  if (!validated.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validated.error.issues },
      { status: 400 }
    );
  }

  const updateData: any = {
      ...validated.data,
      updatedAt: new Date(),
    };

    // Convert date strings to Date objects
    if (validated.data.targetDate) {
      updateData.targetDate = new Date(validated.data.targetDate);
    }

    // Auto-set completedDate when status changes to COMPLETED
    if (validated.data.status === 'COMPLETED') {
      updateData.completedDate = new Date();
    }

    const [updatedGoal] = await db
      .update(performanceGoals)
      .set(updateData)
      .where(eq(performanceGoals.id, goalId))
      .returning();

    if (!updatedGoal) {
      return NextResponse.json(
        { error: 'Performance goal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      goal: updatedGoal,
      message: 'Performance goal updated successfully',
    });
  } catch (error) {
    console.error('Error updating performance goal:', error);
    return NextResponse.json(
      { error: 'Failed to update performance goal' },
      { status: 500 }
    );
  }
});

// DELETE - Delete a goal
export const DELETE = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const goalId = searchParams.get('id');

    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(performanceGoals)
      .where(eq(performanceGoals.id, goalId))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: 'Performance goal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Performance goal deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting performance goal:', error);
    return NextResponse.json(
      { error: 'Failed to delete performance goal' },
      { status: 500 }
    );
  }
});
