import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { performanceReviewCriteria } from '@/lib/db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Validation schemas — companyId from session
const createCriteriaSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  category: z.enum(['TECHNICAL', 'SOFT_SKILLS', 'LEADERSHIP', 'COMMUNICATION', 'PROBLEM_SOLVING', 'TEAMWORK']),
  weight: z.number().min(1).max(10).default(1),
  isActive: z.boolean().default(true),
});

const createResponseSchema = z.object({
  reviewId: z.string().uuid(),
  criteriaId: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comments: z.string().optional(),
});

// GET - List criteria for a company
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');

    const conditions = [eq(performanceReviewCriteria.companyId, auth.tenantId)];

    if (category) conditions.push(eq(performanceReviewCriteria.category, category as any));
    if (isActive !== null && isActive !== undefined) {
      conditions.push(eq(performanceReviewCriteria.isActive, isActive === 'true'));
    }

    const criteria = await db
      .select()
      .from(performanceReviewCriteria)
      .where(and(...conditions))
      .orderBy(asc(performanceReviewCriteria.name));

    return NextResponse.json({ criteria });
  } catch (error) {
    console.error('Error fetching performance criteria:', error);
    return NextResponse.json(
      { error: 'Failed to fetch performance criteria' },
      { status: 500 }
    );
  }
});

// POST - Create a new criteria
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const validated = createCriteriaSchema.safeParse(body);

  if (!validated.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validated.error.issues },
      { status: 400 }
    );
  }

  const [newCriteria] = await db
      .insert(performanceReviewCriteria)
      .values({ ...validated.data, companyId: auth.tenantId })
      .returning();

    return NextResponse.json(
      { criteria: newCriteria, message: 'Performance criteria created successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating performance criteria:', error);
    return NextResponse.json(
      { error: 'Failed to create performance criteria' },
      { status: 500 }
    );
  }
});

// PATCH - Update a criteria
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const criteriaId = searchParams.get('id');

    if (!criteriaId) {
      return NextResponse.json(
        { error: 'Criteria ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const updateData = {
      ...body,
      updatedAt: new Date(),
    };

    const [updatedCriteria] = await db
      .update(performanceReviewCriteria)
      .set(updateData)
      .where(eq(performanceReviewCriteria.id, criteriaId))
      .returning();

    if (!updatedCriteria) {
      return NextResponse.json(
        { error: 'Performance criteria not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      criteria: updatedCriteria,
      message: 'Performance criteria updated successfully',
    });
  } catch (error) {
    console.error('Error updating performance criteria:', error);
    return NextResponse.json(
      { error: 'Failed to update performance criteria' },
      { status: 500 }
    );
  }
});

// DELETE - Delete a criteria
export const DELETE = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const criteriaId = searchParams.get('id');

    if (!criteriaId) {
      return NextResponse.json(
        { error: 'Criteria ID is required' },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(performanceReviewCriteria)
      .where(eq(performanceReviewCriteria.id, criteriaId))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: 'Performance criteria not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Performance criteria deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting performance criteria:', error);
    return NextResponse.json(
      { error: 'Failed to delete performance criteria' },
      { status: 500 }
    );
  }
});
