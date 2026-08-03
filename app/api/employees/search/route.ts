import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { employeeProfiles, savedSearches, users } from '@/lib/db/schema';
import { eq, and, ilike, or, sql, asc, desc, count, gte, lte } from 'drizzle-orm';
import { withTenantAuth } from '@/lib/api/with-auth';

// GET - Search employees with advanced filters
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const search = searchParams.get('search');
        const department = searchParams.get('department');
        const position = searchParams.get('position');
        const status = searchParams.get('status');
        const branchId = searchParams.get('branchId');
        const city = searchParams.get('city');
        const state = searchParams.get('state');
        const salaryMin = searchParams.get('salaryMin');
        const salaryMax = searchParams.get('salaryMax');
        const hireDateFrom = searchParams.get('hireDateFrom');
        const hireDateTo = searchParams.get('hireDateTo');
        const sortBy = searchParams.get('sortBy') || 'name';
        const sortOrder = searchParams.get('sortOrder') || 'asc';
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');

        // companyId from session, never from query param
        const companyId = auth.tenantId;

        // Build where conditions
        const conditions = [eq(sql`u."company_id"`, companyId)];

        if (search) {
            const searchCondition = or(
                ilike(employeeProfiles.employeeNumber, `%${search}%`),
                ilike(sql`u.name`, `%${search}%`),
                ilike(employeeProfiles.department, `%${search}%`),
                ilike(employeeProfiles.position, `%${search}%`),
                ilike(employeeProfiles.personalEmail, `%${search}%`)
            );
            if (searchCondition) conditions.push(searchCondition);
        }

        if (department && department !== 'all') {
            conditions.push(eq(employeeProfiles.department, department));
        }

        if (position) {
            conditions.push(ilike(employeeProfiles.position, `%${position}%`));
        }

        if (status && status !== 'all') {
            conditions.push(eq(employeeProfiles.employeeStatus, status as any));
        }

    if (branchId && branchId !== 'all') {
      conditions.push(eq(sql`u."branch_id"`, branchId));
    }

        if (city) {
            conditions.push(ilike(employeeProfiles.city, `%${city}%`));
        }

        if (state) {
            conditions.push(eq(employeeProfiles.state, state));
        }

        if (hireDateFrom) {
            conditions.push(gte(employeeProfiles.hireDate, new Date(hireDateFrom)));
        }

        if (hireDateTo) {
            conditions.push(lte(employeeProfiles.hireDate, new Date(hireDateTo)));
        }

        // Get total count
        const totalResult = await db
            .select({ count: count() })
            .from(employeeProfiles)
            .leftJoin(sql`users u`, eq(employeeProfiles.userId, sql`u.id`))
            .where(and(...conditions));

        const total = totalResult[0].count;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;

    // Build order by - use employeeProfiles columns for sorting
    const validSortColumns: Record<string, any> = {
      userId: employeeProfiles.userId,
      employeeNumber: employeeProfiles.employeeNumber,
      department: employeeProfiles.department,
      position: employeeProfiles.position,
      hireDate: employeeProfiles.hireDate,
      createdAt: employeeProfiles.createdAt,
    };
    const orderBy = sortOrder === 'desc'
      ? desc(validSortColumns[sortBy] || employeeProfiles.userId)
      : asc(validSortColumns[sortBy] || employeeProfiles.userId);

    // Fetch employees
    const employees = await db
      .select({
        id: employeeProfiles.id,
        userId: employeeProfiles.userId,
        employeeNumber: employeeProfiles.employeeNumber,
        name: sql<string>`u.name`,
        email: sql<string>`u.email`,
        image: sql<string>`u.image`,
        department: employeeProfiles.department,
        position: employeeProfiles.position,
        employeeStatus: employeeProfiles.employeeStatus,
        hireDate: employeeProfiles.hireDate,
        branchId: sql<string>`u.branch_id`,
        city: employeeProfiles.city,
        state: employeeProfiles.state,
        profilePhotoUrl: employeeProfiles.profilePhotoUrl,
      })
      .from(employeeProfiles)
      .leftJoin(sql`users u`, eq(employeeProfiles.userId, sql`u.id`))
            .where(and(...conditions))
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset);

        // Get unique departments for filter
        const departments = await db
            .select({ department: employeeProfiles.department })
            .from(employeeProfiles)
            .where(eq(sql`u."company_id"`, companyId))
            .groupBy(employeeProfiles.department);

        return NextResponse.json({
            employees,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            },
            filters: {
                departments: departments.map(d => d.department).filter(Boolean),
            },
        });
    } catch (error) {
        console.error('Error searching employees:', error);
        return NextResponse.json(
            { error: 'Failed to search employees' },
            { status: 500 }
        );
    }
});

// POST - Save a search
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const body = await request.json();
        const { name, description, searchCriteria, entityType } = body;

        if (!name || !searchCriteria) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const saved = await db.insert(savedSearches).values({
            userId: auth.user.id,
            companyId: auth.tenantId,
            name,
            description,
            searchCriteria,
            entityType: entityType || 'EMPLOYEE',
        }).returning();

        return NextResponse.json({ savedSearch: saved[0] });
    } catch (error) {
        console.error('Error saving search:', error);
        return NextResponse.json(
            { error: 'Failed to save search' },
            { status: 500 }
        );
    }
});

// GET - Get saved searches for a user (also wrapped for auth)
export const getSavedSearches = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const searches = await db
            .select()
            .from(savedSearches)
            .where(
                and(
                    eq(savedSearches.userId, auth.user.id),
                    eq(savedSearches.companyId, auth.tenantId)
                )
            )
            .orderBy(desc(savedSearches.lastUsedAt));

        return NextResponse.json({ searches });
    } catch (error) {
        console.error('Error fetching saved searches:', error);
        return NextResponse.json(
            { error: 'Failed to fetch saved searches' },
            { status: 500 }
        );
    }
});

// DELETE - Delete a saved search
export const DELETE = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const searchId = searchParams.get('id');

        if (!searchId) {
            return NextResponse.json(
                { error: 'id is required' },
                { status: 400 }
            );
        }

        // Only delete if owned by the authenticated user
        await db
            .delete(savedSearches)
            .where(
                and(
                    eq(savedSearches.id, searchId as any),
                    eq(savedSearches.userId, auth.user.id)
                )
            );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting saved search:', error);
        return NextResponse.json(
            { error: 'Failed to delete saved search' },
            { status: 500 }
        );
    }
});
