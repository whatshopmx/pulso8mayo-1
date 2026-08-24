import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstanceSteps, workflowInstances, workflowTemplates, branches, users } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { resolveEvidenceUrl } from "@/lib/storage/scoped-evidence";

export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const dateFrom = searchParams.get("dateFrom");
        const dateTo = searchParams.get("dateTo");
        const search = searchParams.get("search");

        // Build base conditions
        const conditions = [
            eq(workflowTemplates.companyId, session.user.companyId),
            eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`),
            eq(workflowInstanceSteps.instanceId, workflowInstances.id),
        ];

if (dateFrom) {
  conditions.push(gte(workflowInstances.createdAt, new Date(dateFrom)));
}

if (dateTo) {
  conditions.push(lte(workflowInstances.createdAt, new Date(dateTo)));
}

        if (search) {
            conditions.push(
                sql`(${workflowTemplates.name} ILIKE ${`%${search}%`})`
            );
        }

        // Filter out null/undefined conditions
        const validConditions = conditions.filter(c => c != null);

        // Fetch evidence with related data
        const steps = await db.select({
            id: workflowInstanceSteps.id,
            evidenceUrl: workflowInstanceSteps.evidenceUrl,
            workflowName: workflowTemplates.name,
            stepId: workflowInstanceSteps.stepId,
            assigneeName: users.name,
            assigneeId: workflowInstances.assigneeId,
            branchName: branches.name,
            branchId: workflowInstances.branchId,
            createdAt: workflowInstances.createdAt,
            workflowInstanceId: workflowInstances.id,
            aiAnalysis: workflowInstanceSteps.aiAnalysis,
        })
            .from(workflowInstanceSteps)
            .leftJoin(workflowInstances, eq(workflowInstanceSteps.instanceId, workflowInstances.id))
            .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
            .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
            .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
            .where(validConditions.length > 0 ? and(...validConditions) : undefined)
            .orderBy(desc(workflowInstances.createdAt))
            .limit(200);

        // Filter out steps without evidence
        const evidences = steps.filter(s => s.evidenceUrl !== null && s.evidenceUrl !== "");

        // Format evidences with AI verification status.
        // Las evidencias nuevas se guardan como KEY de R2 (modelo privado):
        // aquí se derivan a URL presignada de corta vida; las legacy (http)
        // pasan tal cual sin costo.
        const evidencesWithVerification = await Promise.all(evidences.map(async (evidence) => {
            const aiAnalysis = evidence.aiAnalysis as any;
            const aiVerified = aiAnalysis?.passed === true;
            const url = await resolveEvidenceUrl(evidence.evidenceUrl) || "";

            return {
                id: evidence.id,
                type: "PHOTO" as "PHOTO" | "VIDEO" | "AUDIO" | "TEXT",
                url,
                workflowName: evidence.workflowName,
                stepName: evidence.stepId,
                assigneeName: evidence.assigneeName || "Sin asignar",
                branchName: evidence.branchName || "Sin sucursal",
                createdAt: evidence.createdAt,
                aiVerified: aiVerified,
                aiScore: aiAnalysis?.confidence ? Math.round(aiAnalysis.confidence * 100) : undefined,
                aiReason: aiAnalysis?.reason,
                workflowInstanceId: evidence.workflowInstanceId,
                stepId: evidence.stepId,
            };
        }));

        return NextResponse.json({
            success: true,
            data: evidencesWithVerification,
        });
    } catch (error) {
        console.error("Failed to fetch evidence:", error);
        return NextResponse.json(
            { error: "Failed to fetch evidence" },
            { status: 500 }
        );
    }
}
