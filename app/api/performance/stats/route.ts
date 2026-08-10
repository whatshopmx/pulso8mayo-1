import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  performanceReviews,
  performanceGoals,
  users,
} from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { withTenantAuth } from '@/lib/api/with-auth';

// GET - Performance summary for the tenant (optionally filtered to one user)
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    const reviewConditions = [eq(performanceReviews.companyId, auth.tenantId)];
    const goalConditions = [eq(performanceGoals.companyId, auth.tenantId)];
    if (userId) {
      reviewConditions.push(eq(performanceReviews.userId, userId));
      goalConditions.push(eq(performanceGoals.userId, userId));
    }

    const [
      [reviewTotals],
      [goalTotals],
      [overdueCount],
      [peopleCount],
      employeeData,
      trend,
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${performanceReviews.status} = 'COMPLETED')::int`,
          submitted: sql<number>`count(*) filter (where ${performanceReviews.status} = 'SUBMITTED')::int`,
          inProgress: sql<number>`count(*) filter (where ${performanceReviews.status} = 'IN_PROGRESS')::int`,
          draft: sql<number>`count(*) filter (where ${performanceReviews.status} = 'DRAFT')::int`,
        })
        .from(performanceReviews)
        .where(and(...reviewConditions)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          notStarted: sql<number>`count(*) filter (where ${performanceGoals.status} = 'NOT_STARTED')::int`,
          inProgress: sql<number>`count(*) filter (where ${performanceGoals.status} = 'IN_PROGRESS')::int`,
          completed: sql<number>`count(*) filter (where ${performanceGoals.status} = 'COMPLETED')::int`,
          cancelled: sql<number>`count(*) filter (where ${performanceGoals.status} = 'CANCELLED')::int`,
        })
        .from(performanceGoals)
        .where(and(...goalConditions)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(performanceGoals)
        .where(and(
          ...goalConditions,
          sql`${performanceGoals.targetDate} < now()`,
          sql`${performanceGoals.status} in ('NOT_STARTED', 'IN_PROGRESS')`
        )),
      db
        .select({ count: sql<number>`count(distinct ${performanceReviews.userId})::int` })
        .from(performanceReviews)
        .where(and(...reviewConditions)),
      userId
        ? db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
        : Promise.resolve([] as { id: string; name: string | null; email: string | null }[]),
      db
        .select({
          reviewPeriod: performanceReviews.reviewPeriod,
          averageRating: sql<number>`round(avg(${performanceReviews.overallRating})::numeric, 2)`,
          completed: sql<number>`count(*) filter (where ${performanceReviews.status} = 'COMPLETED')::int`,
        })
        .from(performanceReviews)
        .where(and(
          ...reviewConditions,
          sql`${performanceReviews.overallRating} is not null`,
          sql`${performanceReviews.status} = 'COMPLETED'`
        ))
        .groupBy(performanceReviews.reviewPeriod)
        .orderBy(performanceReviews.reviewPeriod),
    ]);

    const total = reviewTotals.total ?? 0;
    const pending = (reviewTotals.inProgress ?? 0) + (reviewTotals.draft ?? 0) + (reviewTotals.submitted ?? 0);
    const completionRate = total > 0 ? Math.round(((reviewTotals.completed ?? 0) / total) * 100) : 0;
    const goalCompletionRate = (goalTotals.total ?? 0) > 0
      ? Math.round(((goalTotals.completed ?? 0) / (goalTotals.total ?? 0)) * 100)
      : 0;

    return NextResponse.json({
      user: userId ? (employeeData[0] ?? null) : null,
      stats: {
        reviews: {
          total,
          completed: reviewTotals.completed ?? 0,
          submitted: reviewTotals.submitted ?? 0,
          inProgress: reviewTotals.inProgress ?? 0,
          draft: reviewTotals.draft ?? 0,
          pending,
          completionRate,
        },
        goals: {
          total: goalTotals.total ?? 0,
          notStarted: goalTotals.notStarted ?? 0,
          inProgress: goalTotals.inProgress ?? 0,
          completed: goalTotals.completed ?? 0,
          cancelled: goalTotals.cancelled ?? 0,
          overdue: overdueCount.count ?? 0,
          completionRate: goalCompletionRate,
        },
        people: {
          evaluated: peopleCount.count ?? 0,
        },
      },
      trend,
    });
  } catch (error) {
    console.error('Error fetching performance stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch performance stats' },
      { status: 500 }
    );
  }
});