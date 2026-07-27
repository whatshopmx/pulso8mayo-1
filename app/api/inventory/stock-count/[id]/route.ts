import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { StockCountService } from "@/lib/services/stock-count-service";
import { db } from "@/lib/db";
import { workflowInstances, workflowInstanceSteps, workflowTemplates } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const instance = await db.select({
        id: workflowInstances.id,
        status: workflowInstances.status,
        data: workflowInstances.data,
        createdAt: workflowInstances.createdAt,
        completedAt: workflowInstances.completedAt,
        templateName: workflowTemplates.name,
    })
        .from(workflowInstances)
        .innerJoin(workflowTemplates, sql`${workflowInstances.workflowTemplateId}::text = ${workflowTemplates.id}::text`)
        .where(eq(workflowInstances.id, id))
        .limit(1);

    if (!instance.length) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const steps = await db.select()
        .from(workflowInstanceSteps)
        .where(eq(workflowInstanceSteps.instanceId, id));

    return NextResponse.json({ instance: instance[0], steps });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { id } = await params;
        const body = await request.json();
        const { action, stepId, value, stepMetadata } = body;

        if (action === "complete") {
            const result = await StockCountService.completeStockCount(id, session.user.id);
            return NextResponse.json(result);
        }

        if (action === "applyAdjustments") {
            const result = await StockCountService.applyStockCountAdjustments(id, session.user.id);
            return NextResponse.json(result);
        }

      if (action === "updateStep" && stepId && value !== undefined) {
        const stepData = stepMetadata ? JSON.stringify(stepMetadata) : undefined;

        await db.update(workflowInstanceSteps)
          .set({
            value: stepData ? JSON.stringify({ ...JSON.parse(stepData), inputValue: value }) : value,
            completedAt: new Date(),
            status: "COMPLETED",
          })
          .where(sql`${workflowInstanceSteps.instanceId} = ${id} AND ${workflowInstanceSteps.stepId} = ${stepId}`);

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error: any) {
        console.error("Stock count error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}