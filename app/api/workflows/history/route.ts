import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, branches, users, workflowInstanceSteps, incidents } from "@/lib/db/schema";
import { eq, desc, asc, and, gte, lte, sql, inArray, count, isNull } from "drizzle-orm";
import { localDayRangeUtc, startOfLocalDayUtc } from "@/lib/workflows/today";

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
        const preset = searchParams.get("preset");
        const sortBy = searchParams.get("sortBy") || "createdAt";
        const sortOrder = searchParams.get("sortOrder") || "desc";

        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
        const offset = (page - 1) * limit;

        // Build conditions
        const conditions = [
            eq(workflowTemplates.companyId, session.user.companyId),
            eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
        ];

        // Filter by branch if provided
        if (branchId && branchId !== "all") {
            conditions.push(eq(workflowInstances.branchId, branchId));
        }

        // Apply Presets
        const now = new Date();
        if (preset === "today") {
            const { start, end } = localDayRangeUtc(now, "America/Mexico_City");
            conditions.push(gte(workflowInstances.createdAt, start));
            conditions.push(lte(workflowInstances.createdAt, end));
        } else if (preset === "this_week") {
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - 7);
            const startUtc = startOfLocalDayUtc(weekStart, "America/Mexico_City");
            conditions.push(gte(workflowInstances.createdAt, startUtc));
        } else if (preset === "with_incidents") {
            // Filter instances with incidents
            conditions.push(
                sql`EXISTS (SELECT 1 FROM ${incidents} WHERE ${incidents.instanceId} = ${workflowInstances.id})`
            );
        } else if (preset === "pending_review") {
            // Completed workflows without a review verdict
            conditions.push(eq(workflowInstances.status, "COMPLETED"));
            conditions.push(isNull(workflowInstances.reviewStatus));
        } else if (preset === "failed_or_blocked") {
            conditions.push(inArray(workflowInstances.status, ["FAILED", "BLOCKED"]));
        }

        // Status filter (takes precedence if specific status requested)
        if (status && status !== "all") {
            conditions.push(eq(workflowInstances.status, status));
        }

        if (templateId && templateId !== "all") {
            conditions.push(eq(workflowInstances.workflowTemplateId, templateId));
        }

        if (assigneeId && assigneeId !== "all") {
            conditions.push(eq(workflowInstances.assigneeId, assigneeId));
        }

        if (dateFrom && !preset) {
            conditions.push(gte(workflowInstances.createdAt, new Date(dateFrom)));
        }

        if (dateTo && !preset) {
            const toDate = new Date(dateTo);
            toDate.setHours(23, 59, 59, 999);
            conditions.push(lte(workflowInstances.createdAt, toDate));
        }

        if (search && search.trim() !== "") {
            conditions.push(sql`${workflowTemplates.name} ILIKE ${`%${search.trim()}%`}`);
        }

        // 1. Total count query for pagination
        const [totalRow] = await db
            .select({ total: count(workflowInstances.id) })
            .from(workflowInstances)
            .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
            .where(and(...conditions));

        const total = totalRow?.total ?? 0;
        const totalPages = Math.ceil(total / limit) || 1;

        // Determine ordering column
        let orderExpression = desc(workflowInstances.createdAt);
        if (sortBy === "score") {
            orderExpression = sortOrder === "asc" ? asc(workflowInstances.score) : desc(workflowInstances.score);
        } else if (sortBy === "templateName") {
            orderExpression = sortOrder === "asc" ? asc(workflowTemplates.name) : desc(workflowTemplates.name);
        } else {
            orderExpression = sortOrder === "asc" ? asc(workflowInstances.createdAt) : desc(workflowInstances.createdAt);
        }

        // 2. Fetch paginated workflow instances
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
            .orderBy(orderExpression)
            .limit(limit)
            .offset(offset);

        // 3. Batch load incident indicators for the current page only
        const instanceIds = instances.map(i => i.id);
        const incidentRows = instanceIds.length > 0
            ? await db.selectDistinct({ instanceId: incidents.instanceId })
                .from(incidents)
                .where(inArray(incidents.instanceId, instanceIds))
            : [];
        const instanceIdsWithIncidents = new Set(incidentRows.map(r => r.instanceId));

        // 4. Batch load steps for the current page only (single query instead of N queries)
        const allSteps = instanceIds.length > 0
            ? await db.select({
                id: workflowInstanceSteps.id,
                instanceId: workflowInstanceSteps.instanceId,
                status: workflowInstanceSteps.status,
                evidenceUrl: workflowInstanceSteps.evidenceUrl,
            })
                .from(workflowInstanceSteps)
                .where(inArray(workflowInstanceSteps.instanceId, instanceIds))
            : [];

        // Group steps by instanceId in memory
        const stepsByInstance = new Map<string, typeof allSteps>();
        for (const step of allSteps) {
            const list = stepsByInstance.get(step.instanceId) || [];
            list.push(step);
            stepsByInstance.set(step.instanceId, list);
        }

        const instancesWithSteps = instances.map((instance) => {
            const steps = stepsByInstance.get(instance.id) || [];
            const completedCount = steps.filter(s => s.status === "COMPLETED").length;
            const evidenceSteps = steps.filter(s => s.evidenceUrl !== null && s.evidenceUrl !== "");

            return {
                ...instance,
                stepsTotal: steps.length,
                stepsCompleted: completedCount,
                hasIncidents: instanceIdsWithIncidents.has(instance.id),
                hasEvidence: evidenceSteps.length > 0,
                evidenceCount: evidenceSteps.length,
            };
        });

        return NextResponse.json({
            success: true,
            data: instancesWithSteps,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            }
        });
    } catch (error) {
        console.error("Failed to fetch workflow history:", error);
        return NextResponse.json(
            { error: "Failed to fetch workflow history" },
            { status: 500 }
        );
    }
}
