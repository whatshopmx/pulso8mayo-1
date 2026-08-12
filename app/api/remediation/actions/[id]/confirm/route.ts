import { db } from "@/lib/db";
import { remediationActions, incidents, workflowSchedules, complianceServiceHistory, branchComplianceServices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getWorkflowTemplateForServiceType } from "@/lib/compliance-mapping";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import {
  findRemediationActionForTenant,
  remediationBranchScope,
} from "@/lib/api/remediation-access";

/**
 * Confirmar una visita agenda a un proveedor externo: es una decisión de
 * gerencia con costo asociado, no una acción de piso. De ahí el filtro de rol.
 */
export const POST = withRoleAuth(
  ["SUPER_ADMIN", "ADMIN", "GERENTE"],
  async (req, { params, auth }) => {
    const { id } = await params;
    const body = await req.json();
    const { scheduledDate, providerId, notes } = body;

    if (!scheduledDate) {
      throw ApiError.badRequest("Fecha programada requerida");
    }

    const scheduleDateTime = new Date(scheduledDate);
    if (isNaN(scheduleDateTime.getTime())) {
      throw ApiError.badRequest("Fecha inválida");
    }

    // 1. Fetch action — acotada al tenant de sesión y, para GERENTE, a su
    // sucursal. Una acción ajena da 404, indistinguible de una inexistente.
    const branchScope = remediationBranchScope(auth.user.role, auth.branchId);
    const action = await findRemediationActionForTenant(id, auth.tenantId, branchScope);

    if (!action) {
      throw ApiError.notFound("Acción de remediación no encontrada");
    }

    if (action.status !== "PENDING") {
      throw ApiError.badRequest("La acción ya no está pendiente");
    }

    // Resolve template ID
    const templateId = getWorkflowTemplateForServiceType(
      action.serviceType,
      action.workflowTemplateId || undefined
    );

    // 2. Create workflow schedule ONCE
    const [schedule] = await db
      .insert(workflowSchedules)
      .values({
        templateId,
        branchId: action.branchId,
        frequency: "ONCE",
        startDate: scheduleDateTime,
        nextExecutionAt: scheduleDateTime,
        title: `Remediación Externa: ${action.serviceType}`,
        description: notes || `Visita programada por gerencia para atender incidente`,
        priority: "HIGH",
        assignmentType: "ROLE",
        assignedRole: "EMPLEADO",
        createdBy: auth.user.id,
      })
      .returning();

    // 3. Create complianceServiceHistory if serviceConfigId exists
    if (action.serviceConfigId) {
      const [serviceConfig] = await db
        .select()
        .from(branchComplianceServices)
        .where(eq(branchComplianceServices.id, action.serviceConfigId))
        .limit(1);

      await db.insert(complianceServiceHistory).values({
        serviceConfigId: action.serviceConfigId,
        companyId: action.companyId,
        branchId: action.branchId,
        serviceType: action.serviceType as any,
        serviceName: serviceConfig?.serviceName || action.serviceType,
        scheduledDate: scheduleDateTime,
        result: "PENDING",
        providerId: providerId || undefined,
        description: notes || `Remediación derivada de incidente`,
        createdBy: auth.user.id,
      });
    }

    // 4. Update remediation action to CONFIRMED
    const [updatedAction] = await db
      .update(remediationActions)
      .set({
        status: "CONFIRMED",
        confirmedBy: auth.user.id,
        confirmedAt: new Date(),
        scheduledDate: scheduleDateTime,
        scheduleId: schedule.id,
        updatedAt: new Date(),
      })
      .where(eq(remediationActions.id, id))
      .returning();

    // 5. Update incident status to CONFIRMED
    await db
      .update(incidents)
      .set({
        status: "CONFIRMED",
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, action.incidentId));

    return ApiHandler.success({
      action: updatedAction,
      scheduleId: schedule.id,
    });
  }
);
