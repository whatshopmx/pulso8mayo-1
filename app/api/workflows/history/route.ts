import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, branches, users, workflowInstanceSteps, incidents } from "@/lib/db/schema";
import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm";

export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const status = searchParams.get("status");
        const templateId = searchParams.get("templateId");
        const assigneeId = searchParams.get("assigneeId");
        const branchId = searchParams.get("branchId");
        const dateFrom = searchParams.get("dateFrom");
        const dateTo = searchParams.get("dateTo");
        const search = searchParams.get("search");

        // Build conditions
        const conditions = [
            eq(workflowTemplates.companyId, session.user.companyId),
            eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
        ];

        if (status) {
            conditions.push(eq(workflowInstances.status, status));
        }

        if (templateId) {
            conditions.push(eq(workflowInstances.workflowTemplateId, templateId));
        }

        if (assigneeId) {
            conditions.push(eq(workflowInstances.assigneeId, assigneeId));
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

        if (search) {
            conditions.push(sql`${workflowTemplates.name} ILIKE ${`%${search}%`}`);
        }

        // Fetch workflow instances with related data
        const instances = await db.select({
            id: workflowInstances.id,
            templateName: workflowTemplates.name,
            templateId: workflowTemplates.id,
            status: workflowInstances.status,
            reviewStatus: workflowInstances.reviewStatus,
            reviewedAt: workflowInstances.reviewedAt,
            score: workflowInstances.score,
            assigneeName: users.name,
            assigneeId: workflowInstances.assigneeId,
            branchName: branches.name,
            createdAt: workflowInstances.createdAt,
            updatedAt: workflowInstances.updatedAt,
            completedAt: workflowInstances.completedAt,
        })
            .from(workflowInstances)
            .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
            .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
            .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
            .where(and(...conditions))
            .orderBy(desc(workflowInstances.createdAt))
            .limit(100);

        // Which of these instances produced incidents. One grouped query instead of
        // one per instance; this is a history view, so incidents count whatever their
        // current status (a resolved incident still happened on that run).
        const instanceIds = instances.map(i => i.id);
        const incidentRows = instanceIds.length
            ? await db.selectDistinct({ instanceId: incidents.instanceId })
                .from(incidents)
                .where(inArray(incidents.instanceId, instanceIds))
            : [];
        const instanceIdsWithIncidents = new Set(incidentRows.map(r => r.instanceId));

        // Get step counts for each instance
        const instancesWithSteps = await Promise.all(
            instances.map(async (instance) => {
                const steps = await db.select({
                    id: workflowInstanceSteps.id,
                    status: workflowInstanceSteps.status,
                    evidenceUrl: workflowInstanceSteps.evidenceUrl,
                })
                    .from(workflowInstanceSteps)
                    .where(eq(workflowInstanceSteps.instanceId, instance.id));

                return {
                    ...instance,
                    stepsTotal: steps.length,
                    stepsCompleted: steps.filter(s => s.status === "COMPLETED").length,
                    hasIncidents: instanceIdsWithIncidents.has(instance.id),
                    hasEvidence: steps.some(s => s.evidenceUrl !== null && s.evidenceUrl !== ""),
                    evidenceCount: steps.filter(s => s.evidenceUrl !== null && s.evidenceUrl !== "").length,
                };
            })
        );

        return NextResponse.json({
            success: true,
            data: instancesWithSteps,
        });
    } catch (error) {
        console.error("Failed to fetch workflow history:", error);
        return NextResponse.json(
            { error: "Failed to fetch workflow history" },
            { status: 500 }
        );
    }
}
