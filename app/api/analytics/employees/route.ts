import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { employeeProfiles, employeeContracts, employeeAuditLogs, employeeDocuments, employeeOnboarding, employeeOffboarding, companies, branches } from '@/lib/db/schema';
import { eq, and, gte, lte, count, avg, sql, ilike, or, inArray } from 'drizzle-orm';
import { startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subDays } from 'date-fns';
import { withTenantAuth } from '@/lib/api/with-auth';

export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const searchParams = request.nextUrl.searchParams;
  const branchId = searchParams.get('branchId');
  const period = searchParams.get('period') || '30d'; // 7d, 30d, 90d, YTD

  let branchFilter: any = undefined;
  if (branchId && branchId !== 'all') {
    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId);
    if (isValidUuid) {
      branchFilter = branchId;
    }
  }

    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (period) {
      case '7d':
        startDate = subDays(now, 7);
        endDate = now;
        break;
      case '30d':
        startDate = subDays(now, 30);
        endDate = now;
        break;
      case '90d':
        startDate = subDays(now, 90);
        endDate = now;
        break;
      case 'YTD':
        startDate = startOfYear(now);
        endDate = endOfYear(now);
        break;
      default:
        startDate = subDays(now, 30);
        endDate = now;
    }

  // Workforce Overview
  const totalHeadcountConditions: any[] = [
    eq(employeeProfiles.isActive, true),
    eq(employeeProfiles.employeeStatus, 'ACTIVE'),
  ];
  if (branchFilter) totalHeadcountConditions.push(eq(employeeContracts.branchId, branchFilter));

  const totalHeadcount = branchFilter
    ? await db
        .select({ count: count() })
        .from(employeeProfiles)
        .innerJoin(employeeContracts, and(
          eq(employeeProfiles.userId, employeeContracts.userId),
          eq(employeeContracts.status, 'ACTIVE')
        ))
        .where(and(...totalHeadcountConditions))
    : await db
        .select({ count: count() })
        .from(employeeProfiles)
        .where(and(...totalHeadcountConditions));

  const newHiresConditions: any[] = [
    gte(employeeProfiles.hireDate, startDate),
    lte(employeeProfiles.hireDate, endDate),
  ];
  if (branchFilter) newHiresConditions.push(eq(employeeContracts.branchId, branchFilter));

  const newHires = branchFilter
    ? await db
        .select({ count: count() })
        .from(employeeProfiles)
        .innerJoin(employeeContracts, and(
          eq(employeeProfiles.userId, employeeContracts.userId),
          eq(employeeContracts.status, 'ACTIVE')
        ))
        .where(and(...newHiresConditions))
    : await db
        .select({ count: count() })
        .from(employeeProfiles)
        .where(and(...newHiresConditions));

    const terminations = await db
      .select({ count: count() })
      .from(employeeOffboarding)
      .where(
        and(
          gte(employeeOffboarding.resignationDate, startDate),
          lte(employeeOffboarding.resignationDate, endDate)
        )
      );

  // Average tenure (in months)
  const avgTenureConditions: any[] = [eq(employeeProfiles.isActive, true)];
  if (branchFilter) avgTenureConditions.push(eq(employeeContracts.branchId, branchFilter));

  const avgTenure = branchFilter
    ? await db
        .select({ avgMonths: avg(sql`EXTRACT(EPOCH FROM (NOW() - ${employeeProfiles.hireDate})) / 2592000`) })
        .from(employeeProfiles)
        .innerJoin(employeeContracts, and(
          eq(employeeProfiles.userId, employeeContracts.userId),
          eq(employeeContracts.status, 'ACTIVE')
        ))
        .where(and(...avgTenureConditions))
    : await db
        .select({ avgMonths: avg(sql`EXTRACT(EPOCH FROM (NOW() - ${employeeProfiles.hireDate})) / 2592000`) })
        .from(employeeProfiles)
        .where(and(...avgTenureConditions));

  // Demographics - Gender Distribution
  const genderConditions: any[] = [eq(employeeProfiles.isActive, true)];
  if (branchFilter) genderConditions.push(eq(employeeContracts.branchId, branchFilter));

  const genderDistribution = branchFilter
    ? await db
        .select({
          gender: employeeProfiles.gender,
          count: count(),
        })
        .from(employeeProfiles)
        .innerJoin(employeeContracts, and(
          eq(employeeProfiles.userId, employeeContracts.userId),
          eq(employeeContracts.status, 'ACTIVE')
        ))
        .where(and(...genderConditions))
        .groupBy(employeeProfiles.gender)
    : await db
        .select({
          gender: employeeProfiles.gender,
          count: count(),
        })
        .from(employeeProfiles)
        .where(and(...genderConditions))
        .groupBy(employeeProfiles.gender);

  // Department Distribution
  const deptConditions: any[] = [eq(employeeProfiles.isActive, true)];
  if (branchFilter) deptConditions.push(eq(employeeContracts.branchId, branchFilter));

  const departmentDistribution = branchFilter
    ? await db
        .select({
          department: employeeProfiles.department,
          count: count(),
        })
        .from(employeeProfiles)
        .innerJoin(employeeContracts, and(
          eq(employeeProfiles.userId, employeeContracts.userId),
          eq(employeeContracts.status, 'ACTIVE')
        ))
        .where(and(...deptConditions))
        .groupBy(employeeProfiles.department)
    : await db
        .select({
          department: employeeProfiles.department,
          count: count(),
        })
        .from(employeeProfiles)
        .where(and(...deptConditions))
        .groupBy(employeeProfiles.department);

    // Compensation Analytics - Average Salary by Department
    const avgSalaryByDept = await db
      .select({
        department: employeeProfiles.department,
        avgSalary: avg(employeeContracts.baseSalary),
        count: count(),
      })
      .from(employeeContracts)
      .leftJoin(employeeProfiles, eq(employeeContracts.userId, employeeProfiles.userId))
      .where(
        and(
          eq(employeeProfiles.isActive, true),
          eq(employeeContracts.status, 'ACTIVE')
        )
      )
      .groupBy(employeeProfiles.department);

    // Attendance Analytics (mock data for now - will integrate with shift sessions later)
    const attendanceRate = 94.5; // Placeholder
    const absenteeismRate = 2.3; // Placeholder
    const tardinessRate = 3.2; // Placeholder

    // Performance Analytics (mock data - will integrate with performance reviews later)
    const avgPerformanceRating = 3.8; // Placeholder out of 5

    // Compliance Metrics
    const totalRequiredDocs = await db
      .select({ count: count() })
      .from(employeeDocuments)
      .where(eq(employeeDocuments.isRequired, true));

    const validatedDocs = await db
      .select({ count: count() })
      .from(employeeDocuments)
      .where(eq(employeeDocuments.status, 'VALIDATED'));

    const expiringDocs = await db
      .select({ count: count() })
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.status, 'VALIDATED'),
          gte(employeeDocuments.expirationDate, now),
          lte(employeeDocuments.expirationDate, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)) // Next 30 days
        )
      );

    const activeOnboardings = await db
      .select({ count: count() })
      .from(employeeOnboarding)
      .where(eq(employeeOnboarding.status, 'IN_PROGRESS'));

    const completedOnboardings = await db
      .select({ count: count() })
      .from(employeeOnboarding)
      .where(eq(employeeOnboarding.status, 'COMPLETED'));

    const onboardingCompletionRate = activeOnboardings[0].count + completedOnboardings[0].count > 0
      ? (completedOnboardings[0].count / (activeOnboardings[0].count + completedOnboardings[0].count)) * 100
      : 0;

    // Headcount Trend (last 6 months)
    const headcountTrend = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const monthEnd = endOfMonth(subMonths(now, i));

      const monthHires = await db
        .select({ count: count() })
        .from(employeeProfiles)
        .where(
          and(
            gte(employeeProfiles.hireDate, monthStart),
            lte(employeeProfiles.hireDate, monthEnd)
          )
        );

      const monthTerms = await db
        .select({ count: count() })
        .from(employeeOffboarding)
        .where(
          and(
            gte(employeeOffboarding.resignationDate, monthStart),
            lte(employeeOffboarding.resignationDate, monthEnd)
          )
        );

      headcountTrend.push({
        month: monthStart.toLocaleString('es-MX', { month: 'short', year: '2-digit' }),
        hires: monthHires[0].count,
        terminations: monthTerms[0].count,
        net: monthHires[0].count - monthTerms[0].count,
      });
    }

    // Insights & Alerts
    const insights = [];
    if (expiringDocs[0].count > 0) {
      insights.push({
        type: 'WARNING',
        message: `${expiringDocs[0].count} documents expiring in next 30 days`,
        action: 'Review expiring documents',
      });
    }

    if (terminations[0].count > newHires[0].count) {
      insights.push({
        type: 'ALERT',
        message: 'Turnover rate increased - more terminations than new hires',
        action: 'Review retention strategies',
      });
    }

    if (onboardingCompletionRate < 80) {
      insights.push({
        type: 'INFO',
        message: `Onboarding completion rate is ${onboardingCompletionRate.toFixed(1)}%`,
        action: 'Follow up on pending onboardings',
      });
    }

    return NextResponse.json({
      workforce: {
        totalHeadcount: totalHeadcount[0].count,
        newHires: newHires[0].count,
        terminations: terminations[0].count,
        turnoverRate: totalHeadcount[0].count > 0 
          ? ((terminations[0].count / totalHeadcount[0].count) * 100).toFixed(2)
          : 0,
        averageTenure: avgTenure[0].avgMonths 
          ? parseFloat(avgTenure[0].avgMonths).toFixed(1)
          : 0,
        headcountTrend,
      },
      demographics: {
        genderDistribution: genderDistribution.map(g => ({
          name: g.gender || 'Not specified',
          value: g.count,
        })),
        departmentDistribution: departmentDistribution.map(d => ({
          name: d.department || 'Not specified',
          value: d.count,
        })),
      },
      compensation: {
        avgSalaryByDept: avgSalaryByDept.map(d => ({
          department: d.department || 'Not specified',
          avgSalary: d.avgSalary ? parseInt(d.avgSalary) / 100 : 0, // Convert from cents
          count: d.count,
        })),
      },
      attendance: {
        attendanceRate,
        absenteeismRate,
        tardinessRate,
      },
      performance: {
        avgPerformanceRating,
      },
      compliance: {
        documentComplianceRate: totalRequiredDocs[0].count > 0
          ? ((validatedDocs[0].count / totalRequiredDocs[0].count) * 100).toFixed(1)
          : 100,
        expiringDocs: expiringDocs[0].count,
        onboardingCompletionRate: onboardingCompletionRate.toFixed(1),
        activeOnboardings: activeOnboardings[0].count,
      },
      insights,
    });
  } catch (error) {
    console.error('Error fetching employee analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employee analytics data' },
      { status: 500 }
    );
  }
});
