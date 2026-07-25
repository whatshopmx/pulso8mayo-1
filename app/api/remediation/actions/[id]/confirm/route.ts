import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { remediationActions, incidents, workflowSchedules, complianceServiceHistory, branchComplianceServices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getWorkflowTemplateForServiceType } from "@/lib/compliance-mapping";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { scheduledDate, providerId, notes } = body;

    if (!scheduledDate) {
      return NextResponse.json({ error: "Fecha programada requerida" }, { status: 400 });
    }

    const scheduleDateTime = new Date(scheduledDate);
    if (isNaN(scheduleDateTime.getTime())) {
      return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
    }

    // 1. Fetch action
    const [action] = await db
      .select()
      .from(remediationActions)
      .where(eq(remediationActions.id, id))
      .limit(1);

    if (!action) {
      return NextResponse.json({ error: "Acción de remediación no encontrada" }, { status: 404 });
    }

    if (action.status !== 'PENDING') {
      return NextResponse.json({ error: "La acción ya no está pendiente" }, { status: 400 });
    }

    // Resolve template ID
    const templateId = getWorkflowTemplateForServiceType(action.serviceType, action.workflowTemplateId || undefined);

    // 2. Create workflow schedule ONCE
    const [schedule] = await db
      .insert(workflowSchedules)
      .values({
        templateId,
        branchId: action.branchId,
        frequency: 'ONCE',
        startDate: scheduleDateTime,
        nextExecutionAt: scheduleDateTime,
        title: `Remediación Externa: ${action.serviceType}`,
        description: notes || `Visita programada por gerencia para atender incidente`,
        priority: 'HIGH',
        assignmentType: 'ROLE',
        assignedRole: 'EMPLEADO',
        createdBy: session.user.id,
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
        result: 'PENDING',
        providerId: providerId || undefined,
        description: notes || `Remediación derivada de incidente`,
        createdBy: session.user.id,
      });
    }

    // 4. Update remediation action to CONFIRMED
    const [updatedAction] = await db
      .update(remediationActions)
      .set({
        status: 'CONFIRMED',
        confirmedBy: session.user.id,
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
        status: 'CONFIRMED',
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, action.incidentId));

    return NextResponse.json({
      success: true,
      action: updatedAction,
      scheduleId: schedule.id,
    });
  } catch (error) {
    console.error("Error confirming remediation action:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
