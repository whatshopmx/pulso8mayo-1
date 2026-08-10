import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  performanceReviews,
  performanceReviewCriteria,
  performanceReviewResponses,
  users,
} from '@/lib/db/schema';
import { alias } from 'drizzle-orm/pg-core';
import { eq, and, desc, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Validation schemas — userId, reviewerId, companyId from session
const criteriaRatingSchema = z.object({
  criteriaId: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comments: z.string().optional(),
});

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
  criteriaRatings: z.array(criteriaRatingSchema).optional(),
});

const updateReviewSchema = createReviewSchema.partial().extend({
  status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'SUBMITTED']).optional(),
});

const reviewerUser = alias(users, 'reviewer_user');

interface CriteriaRatingInput {
  criteriaId: string;
  rating: number;
  comments?: string;
}

/** Weighted average (1-5, one decimal) from criteria responses using criteria `weight`. */
async function computeWeightedRating(
  companyId: string,
  criteriaRatings: CriteriaRatingInput[]
): Promise<number | null> {
  if (!criteriaRatings.length) return null;

  const criteria = await db
    .select({ id: performanceReviewCriteria.id, weight: performanceReviewCriteria.weight })
    .from(performanceReviewCriteria)
    .where(and(
      eq(performanceReviewCriteria.companyId, companyId),
      eq(performanceReviewCriteria.isActive, true)
    ));

  const weightMap = new Map(criteria.map((c) => [c.id, c.weight ?? 1]));
  let totalWeight = 0;
  let sum = 0;
  for (const cr of criteriaRatings) {
    const w = weightMap.get(cr.criteriaId) ?? 1;
    totalWeight += w;
    sum += cr.rating * w;
  }
  return totalWeight > 0 ? Math.round((sum / totalWeight) * 10) / 10 : null;
}

async function insertCriteriaResponses(reviewId: string, criteriaRatings: CriteriaRatingInput[]) {
  if (!criteriaRatings.length) return;
  await db.insert(performanceReviewResponses).values(
    criteriaRatings.map((cr) => ({
      reviewId,
      criteriaId: cr.criteriaId,
      rating: cr.rating,
      comments: cr.comments ?? null,
    }))
  );
}

const reviewColumns = {
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
  developmentPlan: performanceReviews.developmentPlan,
  comments: performanceReviews.comments,
  submittedAt: performanceReviews.submittedAt,
  completedAt: performanceReviews.completedAt,
  createdAt: performanceReviews.createdAt,
  updatedAt: performanceReviews.updatedAt,
  userName: users.name,
  reviewerName: reviewerUser.name,
};

// GET - List performance reviews (optionally a single one by `id` with criteria responses)
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
    const reviewerId = searchParams.get('reviewerId');
    const reviewType = searchParams.get('reviewType');
    const status = searchParams.get('status');
    const reviewPeriod = searchParams.get('reviewPeriod');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Build conditions — always scoped to authenticated tenant
    const conditions = [eq(performanceReviews.companyId, auth.tenantId)];

    if (id) conditions.push(eq(performanceReviews.id, id));
    if (userId) conditions.push(eq(performanceReviews.userId, userId));
    if (reviewerId) conditions.push(eq(performanceReviews.reviewerId, reviewerId));
    if (reviewType) conditions.push(eq(performanceReviews.reviewType, reviewType as any));
    if (status) conditions.push(eq(performanceReviews.status, status as any));
    if (reviewPeriod) conditions.push(eq(performanceReviews.reviewPeriod, reviewPeriod));
    if (search) {
      conditions.push(or(
        ilike(users.name, `%${search}%`),
        ilike(reviewerUser.name, `%${search}%`)
      ));
    }

    const baseQuery = db
      .select(reviewColumns)
      .from(performanceReviews)
      .leftJoin(users, eq(performanceReviews.userId, users.id))
      .leftJoin(reviewerUser, eq(performanceReviews.reviewerId, reviewerUser.id))
      .where(and(...conditions));

    // Single review by id — include criteria responses
    if (id) {
      const [review] = await baseQuery.limit(1);
      if (!review) {
        return NextResponse.json({ error: 'Review not found' }, { status: 404 });
      }

      const criteria = await db
        .select({
          id: performanceReviewResponses.id,
          criteriaId: performanceReviewResponses.criteriaId,
          rating: performanceReviewResponses.rating,
          comments: performanceReviewResponses.comments,
          name: performanceReviewCriteria.name,
          category: performanceReviewCriteria.category,
          weight: performanceReviewCriteria.weight,
        })
        .from(performanceReviewResponses)
        .leftJoin(
          performanceReviewCriteria,
          eq(performanceReviewResponses.criteriaId, performanceReviewCriteria.id)
        )
        .where(eq(performanceReviewResponses.reviewId, id));

      return NextResponse.json({ review, criteria });
    }

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(performanceReviews)
      .leftJoin(users, eq(performanceReviews.userId, users.id))
      .leftJoin(reviewerUser, eq(performanceReviews.reviewerId, reviewerUser.id))
      .where(and(...conditions));

    const reviews = await baseQuery
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
    const criteriaRatings = data.criteriaRatings ?? [];

    // Weighted criteria rating wins over manual stars when criteria responses exist
    let overallRating = data.overallRating ?? null;
    if (criteriaRatings.length) {
      overallRating = await computeWeightedRating(auth.tenantId, criteriaRatings);
    }

    // Never spread criteriaRatings into the reviews insert — it has no column
    const { criteriaRatings: _ignored, ...reviewFields } = data;

    const [newReview] = await db
      .insert(performanceReviews)
      .values({
        ...reviewFields,
        overallRating,
        reviewerId: auth.user.id, // reviewer is the authenticated user
        companyId: auth.tenantId,
        status: 'DRAFT',
        createdBy: auth.user.id,
      })
      .returning();

    await insertCriteriaResponses(newReview.id, criteriaRatings);

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

    const { criteriaRatings, ...fields } = validated.data;
    const updateData: any = {
      ...fields,
      updatedAt: new Date(),
    };

    // Replace criteria responses when provided — recompute weighted rating
    if (criteriaRatings && criteriaRatings.length) {
      updateData.overallRating = await computeWeightedRating(auth.tenantId, criteriaRatings);
      await db.delete(performanceReviewResponses).where(eq(performanceReviewResponses.reviewId, reviewId));
      await insertCriteriaResponses(reviewId, criteriaRatings);
    }

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
      .where(and(
        eq(performanceReviews.id, reviewId),
        eq(performanceReviews.companyId, auth.tenantId)
      ))
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