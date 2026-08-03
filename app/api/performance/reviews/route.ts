import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { performanceReviews, performanceReviewCriteria, performanceGoals, users, companies, branches } from '@/lib/db/schema';
import { eq, and, desc, asc, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Validation schemas — userId, reviewerId, companyId from session
const createReviewSchema = z.object({
  userId: z.string(), // The employee being reviewed
  branchId: z.string().uuid().optional(),
  reviewType: z.enum(['SELF', 'MANAGER', 'PEER', '360']),
  reviewPeriod: z.string(),
  overallRating: z.number().min(1).max(5).optional(),
  strengths: z.string().optional(),
  areasForImprovement: z.string().optional(),
  goals: z.array(z.object({
    goal: z.string(),
    target: z.string(),
    deadline: z.string(),
  })).optional(),
  achievements: z.any().optional(),
  developmentPlan: z.string().optional(),
  comments: z.string().optional(),
});

const updateReviewSchema = createReviewSchema.partial().extend({
  status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'SUBMITTED']).optional(),
});

// GET - List performance reviews
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const reviewerId = searchParams.get('reviewerId');
    const reviewType = searchParams.get('reviewType');
    const status = searchParams.get('status');
    const reviewPeriod = searchParams.get('reviewPeriod');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Build conditions — always scoped to authenticated tenant
    const conditions = [eq(performanceReviews.companyId, auth.tenantId)];

    if (userId) conditions.push(eq(performanceReviews.userId, userId));
    if (reviewerId) conditions.push(eq(performanceReviews.reviewerId, reviewerId));
    if (reviewType) conditions.push(eq(performanceReviews.reviewType, reviewType as any));
    if (status) conditions.push(eq(performanceReviews.status, status as any));
    if (reviewPeriod) conditions.push(eq(performanceReviews.reviewPeriod, reviewPeriod));

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(performanceReviews)
      .where(and(...conditions));

    // Get reviews with user details
    const reviews = await db
      .select({
        id: performanceReviews.id,
        userId: performanceReviews.userId,
        reviewerId: performanceReviews.reviewerId,
        reviewType: performanceReviews.reviewType,
        reviewPeriod: performanceReviews.reviewPeriod,
        reviewDate: performanceReviews.reviewDate,
        status: performanceReviews.status,
        overallRating: performanceReviews.overallRating,
        strengths: performanceReviews.strengths,
        areasForImprovement: performanceReviews.areasForImprovement,
        submittedAt: performanceReviews.submittedAt,
        completedAt: performanceReviews.completedAt,
        createdAt: performanceReviews.createdAt,
        updatedAt: performanceReviews.updatedAt,
        userName: users.name,
        reviewerName: users.name,
      })
      .from(performanceReviews)
      .leftJoin(users, eq(performanceReviews.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(performanceReviews.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      reviews,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching performance reviews:', error);
    return NextResponse.json(
      { error: 'Failed to fetch performance reviews' },
      { status: 500 }
    );
  }
});

// POST - Create a new performance review
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const validated = createReviewSchema.safeParse(body);

  if (!validated.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validated.error.issues },
      { status: 400 }
    );
  }

  const data = validated.data;

    const [newReview] = await db
      .insert(performanceReviews)
      .values({
        ...data,
        reviewerId: auth.user.id, // reviewer is the authenticated user
        companyId: auth.tenantId,
        status: 'DRAFT',
        createdBy: auth.user.id,
      })
      .returning();

    return NextResponse.json(
      { review: newReview, message: 'Performance review created successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating performance review:', error);
    return NextResponse.json(
      { error: 'Failed to create performance review' },
      { status: 500 }
    );
  }
});

// PATCH - Update a performance review
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const reviewId = searchParams.get('id');

    if (!reviewId) {
      return NextResponse.json(
        { error: 'Review ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validated = updateReviewSchema.safeParse(body);

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

    // Set timestamps based on status changes
    if (validated.data.status === 'SUBMITTED' && !updateData.submittedAt) {
      updateData.submittedAt = new Date();
    }
    if (validated.data.status === 'COMPLETED' && !updateData.completedAt) {
      updateData.completedAt = new Date();
    }

    const [updatedReview] = await db
      .update(performanceReviews)
      .set(updateData)
      .where(eq(performanceReviews.id, reviewId))
      .returning();

    if (!updatedReview) {
      return NextResponse.json(
        { error: 'Performance review not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      review: updatedReview,
      message: 'Performance review updated successfully',
    });
  } catch (error) {
    console.error('Error updating performance review:', error);
    return NextResponse.json(
      { error: 'Failed to update performance review' },
      { status: 500 }
    );
  }
});
