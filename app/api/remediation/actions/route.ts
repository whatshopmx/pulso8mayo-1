import { db } from "@/lib/db";
import { remediationActions, incidents, branchComplianceServices } from "@/lib/db/schema";
import { eq, inArray, and, desc } from "drizzle-orm";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { remediationBranchScope } from "@/lib/api/remediation-access";

type RemediationStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";

const VALID_STATUSES: RemediationStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"];

export const GET = withTenantAuth(async (req, { auth }) => {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status") || "PENDING,CONFIRMED";
  const statusList = statusParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is RemediationStatus => VALID_STATUSES.includes(s as RemediationStatus));

  if (statusList.length === 0) {
    return ApiHandler.success([]);
  }

  // El tenant sale SIEMPRE de la sesión. GERENTE y SUPERVISOR además quedan
  // acotados a su propia sucursal.
  const branchScope = remediationBranchScope(auth.user.role, auth.branchId);

  const conditions = [
    eq(remediationActions.companyId, auth.tenantId),
    inArray(remediationActions.status, statusList),
  ];

  if (branchScope) {
    conditions.push(eq(remediationActions.branchId, branchScope));
  }

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
    .leftJoin(
      branchComplianceServices,
      eq(remediationActions.serviceConfigId, branchComplianceServices.id)
    )
    .where(and(...conditions))
    .orderBy(desc(remediationActions.createdAt));

  return ApiHandler.success(actions);
});
