import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, branches, users, workflowInstanceSteps, incidents } from "@/lib/db/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const resourceType = searchParams.get("resourceType");
        const userId = searchParams.get("userId");
        const branchId = searchParams.get("branchId");
        const dateFrom = searchParams.get("dateFrom");
        const dateTo = searchParams.get("dateTo");
        const search = searchParams.get("search");

        // Build conditions for workflow audit trail
        const conditions = [
            eq(workflowTemplates.companyId, session.user.companyId),
            eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
        ];

        if (userId) {
            conditions.push(eq(workflowInstances.assigneeId, userId));
        }

        if (branchId) {
            conditions.push(eq(workflowInstances.branchId, branchId));
        }

        if (dateFrom) {
            conditions.push(gte(workflowInstances.createdAt, new Date(dateFrom)));
        }

        if (dateTo) {
            conditions.push(lte(workflowInstances.createdAt, new Date(dateTo)));
        }

        // Fetch workflow audit trail
        const workflowLogs = await db.select({
            id: workflowInstances.id,
            action: sql<string>`'WORKFLOW_' || ${workflowInstances.status}`,
            resource: workflowTemplates.name,
            resourceType: sql<string>`'WORKFLOW'`,
            userId: workflowInstances.assigneeId,
            userName: users.name,
            userRole: users.role,
            branchId: workflowInstances.branchId,
            branchName: branches.name,
            details: sql`jsonb_build_object(
                'status', ${workflowInstances.status},
                'score', ${workflowInstances.score},
                'startedAt', ${workflowInstances.startedAt},
                'completedAt', ${workflowInstances.completedAt}
            )`,
            ipAddress: sql<string>`null`,
            userAgent: sql<string>`null`,
            createdAt: workflowInstances.createdAt,
        })
            .from(workflowInstances)
            .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
            .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
            .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
            .where(and(...conditions))
            .orderBy(desc(workflowInstances.createdAt))
            .limit(50);

        // Fetch incidents as audit logs
        const incidentConditions = [
            eq(branches.companyId, session.user.companyId)
        ];

        if (userId) {
            incidentConditions.push(eq(incidents.detectedBy, userId));
        }

        if (branchId) {
            incidentConditions.push(eq(incidents.branchId, branchId));
        }

        if (dateFrom) {
            incidentConditions.push(gte(incidents.createdAt, new Date(dateFrom)));
        }

        if (dateTo) {
            incidentConditions.push(lte(incidents.createdAt, new Date(dateTo)));
        }

        const incidentLogs = await db.select({
            id: incidents.id,
            action: sql<string>`'INCIDENT_' || ${incidents.status}`,
            resource: incidents.title,
            resourceType: sql<string>`'INCIDENT'`,
            userId: incidents.detectedBy,
            userName: users.name,
            userRole: users.role,
            branchId: incidents.branchId,
            branchName: branches.name,
            details: sql`jsonb_build_object(
                'severity', ${incidents.severity},
                'status', ${incidents.status},
                'description', ${incidents.description}
            )`,
            ipAddress: sql<string>`null`,
            userAgent: sql<string>`null`,
            createdAt: incidents.createdAt,
        })
            .from(incidents)
            .leftJoin(users, eq(incidents.detectedBy, users.id))
            .leftJoin(branches, eq(incidents.branchId, branches.id))
            .where(and(...incidentConditions))
            .orderBy(desc(incidents.createdAt))
            .limit(50);

        // Combine and sort logs
        const allLogs = [...workflowLogs, ...incidentLogs]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Filter by resource type if specified
        let filteredLogs = allLogs;
        if (resourceType && resourceType !== "all") {
            filteredLogs = allLogs.filter(log => {
                if (resourceType === "WORKFLOW") return log.resourceType === "WORKFLOW";
                if (resourceType === "INCIDENT") return log.resourceType === "INCIDENT";
                return true;
            });
        }

        // Filter by search term if specified
        if (search) {
            filteredLogs = filteredLogs.filter(log => 
                log.action.toLowerCase().includes(search.toLowerCase()) ||
                log.resource.toLowerCase().includes(search.toLowerCase()) ||
                log.userName?.toLowerCase().includes(search.toLowerCase())
            );
        }

        return NextResponse.json({
            success: true,
            data: filteredLogs,
        });
    } catch (error) {
        console.error("Failed to fetch audit logs:", error);
        return NextResponse.json(
            { error: "Failed to fetch audit logs" },
            { status: 500 }
        );
    }
}
