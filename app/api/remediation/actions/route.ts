import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { remediationActions, incidents, branchComplianceServices } from "@/lib/db/schema";
import { eq, inArray, desc } from "drizzle-orm";

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") || "PENDING,CONFIRMED";
    const statusList = statusParam.split(",").map(s => s.trim()) as ("PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED")[];

    // Fetch actions
    const actions = await db
      .select({
        id: remediationActions.id,
        incidentId: remediationActions.incidentId,
        serviceConfigId: remediationActions.serviceConfigId,
        branchId: remediationActions.branchId,
        companyId: remediationActions.companyId,
        actionType: remediationActions.actionType,
        serviceType: remediationActions.serviceType,
        workflowTemplateId: remediationActions.workflowTemplateId,
        status: remediationActions.status,
        confirmedBy: remediationActions.confirmedBy,
        confirmedAt: remediationActions.confirmedAt,
        scheduledDate: remediationActions.scheduledDate,
        scheduleId: remediationActions.scheduleId,
        workflowInstanceId: remediationActions.workflowInstanceId,
        completedAt: remediationActions.completedAt,
        result: remediationActions.result,
        createdAt: remediationActions.createdAt,
        incidentTitle: incidents.title,
        incidentDescription: incidents.description,
        incidentSeverity: incidents.severity,
        incidentStatus: incidents.status,
        serviceName: branchComplianceServices.serviceName,
      })
      .from(remediationActions)
      .leftJoin(incidents, eq(remediationActions.incidentId, incidents.id))
      .leftJoin(branchComplianceServices, eq(remediationActions.serviceConfigId, branchComplianceServices.id))
      .where(inArray(remediationActions.status, statusList))
      .orderBy(desc(remediationActions.createdAt));

    return NextResponse.json(actions);
  } catch (error) {
    console.error("Error fetching remediation actions:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
