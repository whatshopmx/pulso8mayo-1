import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { incidents, branches } from '@/lib/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { IncidentEngine } from '@/lib/services/incident-engine';
import { withTenantAuth } from '@/lib/api/with-auth';

/**
 * GET /api/incidents
 * List incidents scoped to the authenticated tenant
 */
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const { searchParams } = new URL(request.url);

        const branchId = searchParams.get('branchId');
        const status = searchParams.get('status');
        const severity = searchParams.get('severity');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        // Get branches belonging to this tenant
        const tenantBranches = await db
            .select({ id: branches.id })
            .from(branches)
            .where(eq(branches.companyId, auth.tenantId));

        const tenantBranchIds = tenantBranches.map(b => b.id);

        if (tenantBranchIds.length === 0) {
            return NextResponse.json({ incidents: [], total: 0, limit, offset });
        }

        // Build query conditions — always scoped to tenant's branches
        const conditions = [inArray(incidents.branchId, tenantBranchIds as any)];

        if (branchId) {
            // Also check that requested branch belongs to tenant
            if (!tenantBranchIds.includes(branchId as any)) {
                return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
            }
            conditions.push(eq(incidents.branchId, branchId));
        }

        if (status) {
            conditions.push(eq(incidents.status, status as any));
        }

        if (severity) {
            conditions.push(eq(incidents.severity, severity as any));
        }

        // Query incidents
        const query = db
            .select()
            .from(incidents)
            .orderBy(desc(incidents.createdAt))
            .limit(limit)
            .offset(offset);

        if (conditions.length > 0) {
            query.where(and(...conditions));
        }

        const results = await query;

        return NextResponse.json({
            incidents: results,
            total: results.length,
            limit,
            offset,
        });
    } catch (error) {
        console.error('[API] Error fetching incidents:', error);
        return NextResponse.json(
            { error: 'Failed to fetch incidents' },
            { status: 500 }
        );
    }
});

/**
 * POST /api/incidents
 * Create incident manually (for testing or manual reporting)
 */
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const body = await request.json();

        const {
            workflowInstanceId: instanceId,
            stepId,
            branchId,
            severity,
            title,
            description,
        } = body;

        // Validate required fields
        if (!instanceId || !branchId || !severity || !title) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Create incident — detectedBy always from session
        const [incident] = await db
            .insert(incidents)
            .values({
                instanceId,
                stepId,
                branchId,
                severity,
                status: 'DETECTED',
                title,
                description,
                detectedBy: auth.user.id,
            })
            .returning();

        return NextResponse.json({ incident }, { status: 201 });
    } catch (error) {
        console.error('[API] Error creating incident:', error);
        return NextResponse.json(
            { error: 'Failed to create incident' },
            { status: 500 }
        );
    }
});
