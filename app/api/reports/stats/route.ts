import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { workflowInstances, workflowAssignments, workflowTemplates, users, branches } from '@/lib/db/schema';
import { eq, desc, and, gte, lte, sql, count, inArray } from 'drizzle-orm';
import { subDays, startOfDay, format } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = session.user.companyId;
    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');
    const days = parseInt(searchParams.get('days') || '7');
    const startDate = startOfDay(subDays(new Date(), days));

    // Completion rate trend (last N days)
    const trendConditions = [
      eq(workflowInstances.status, 'COMPLETED'),
      gte(workflowInstances.completedAt, startDate),
    ];
    if (branchId && branchId !== 'all') {
      trendConditions.push(eq(workflowInstances.branchId, branchId));
    } else if (companyId) {
      trendConditions.push(
        inArray(
          workflowInstances.branchId,
          db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, companyId))
        )
      );
    }

    const completionTrend = await db
      .select({
        date: sql<string>`DATE(${workflowInstances.completedAt})`,
        total: sql<number>`cast(count(*) as integer)`,
        completed: sql<number>`cast(count(*) filter (where ${workflowInstances.status} = 'COMPLETED') as integer)`,
      })
      .from(workflowInstances)
      .where(and(...trendConditions))
      .groupBy(sql`DATE(${workflowInstances.completedAt})`)
      .orderBy(sql`DATE(${workflowInstances.completedAt})`);

    const completionRate = completionTrend.map(t => ({
      date: format(new Date(t.date), 'MMM dd'),
      rate: t.total > 0 ? Math.round((t.completed / t.total) * 100) : 0,
    }));

    // Active workflows (IN_PROGRESS and PENDING, limit 10)
    const activeConditions = [
      sql`${workflowInstances.status} IN ('IN_PROGRESS', 'PENDING')`,
    ];
    if (branchId && branchId !== 'all') {
      activeConditions.push(eq(workflowInstances.branchId, branchId));
    } else if (companyId) {
      activeConditions.push(
        inArray(
          workflowInstances.branchId,
          db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, companyId))
        )
      );
    }

    const activeWorkflows = await db
      .select({
        id: workflowInstances.id,
        title: workflowTemplates.name,
        status: workflowInstances.status,
        assigneeName: users.name,
        assigneeId: workflowInstances.assigneeId,
        createdAt: workflowInstances.createdAt,
        dueDate: workflowInstances.dueDate,
      })
      .from(workflowInstances)
      .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
      .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
      .where(and(...activeConditions))
      .orderBy(desc(workflowInstances.createdAt))
      .limit(10);

    // Employee leaderboard (top 5 by completed assignments in period)
    const leaderboardConditions = [
      eq(workflowAssignments.status, 'COMPLETED'),
      gte(workflowAssignments.completedAt, startDate),
    ];
    if (companyId) {
      leaderboardConditions.push(eq(users.companyId, companyId));
    }
    if (branchId && branchId !== 'all') {
      leaderboardConditions.push(eq(workflowInstances.branchId, branchId));
    }

    const leaderboard = await db
      .select({
        userId: workflowAssignments.assignedTo,
        userName: users.name,
        completed: sql<number>`cast(count(*) as integer)`,
        avgScore: sql<number>`COALESCE(AVG(${workflowInstances.score}), 0)`,
      })
      .from(workflowAssignments)
      .leftJoin(workflowInstances, eq(workflowAssignments.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowAssignments.assignedTo, users.id))
      .where(and(...leaderboardConditions))
      .groupBy(workflowAssignments.assignedTo, users.name)
      .orderBy(sql`count(*) DESC`)
      .limit(5);

    const employeeLeaderboard = leaderboard.map(e => ({
      name: e.userName || 'Unknown',
      email: '',
      completed: Number(e.completed),
      score: Math.round(Number(e.avgScore)),
    }));

    return NextResponse.json({
      completionRate,
      activeWorkflows: activeWorkflows.map(w => ({
        id: w.id,
        title: w.title || 'Untitled',
        assigneeName: w.assigneeName || 'Unassigned',
        status: w.status,
        timeElapsed: w.createdAt ? Math.round((Date.now() - w.createdAt.getTime()) / 60000) + 'm' : '0m',
        dueIn: w.dueDate ? Math.round((w.dueDate.getTime() - Date.now()) / 60000) + 'm' : '—',
      })),
      employeeLeaderboard,
    });

  } catch (error) {
    console.error('Error fetching operations stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
