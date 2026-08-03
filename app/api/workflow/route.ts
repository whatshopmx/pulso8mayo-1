import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { withTenantAuth } from "@/lib/api/with-auth";

const WORKFLOW_EVENT_MAP: Record<string, { event: string; mapArgs: (args: any[], auth: any) => any }> = {
  executeWorkflow: {
    event: "workflow/execution.created",
    mapArgs: ([instanceId]: any[], auth) => ({ instanceId, userId: auth.user.id }),
  },
  handleIncidentWorkflow: {
    event: "incident/detected",
    mapArgs: ([incidentId]: any[]) => ({ incidentId }),
  },
  incidentEscalationWorkflow: {
    event: "incident/escalation.requested",
    mapArgs: ([incidentId, chain]: any[]) => ({ incidentId, chain }),
  },
  handleClockInWorkflow: {
    event: "shift/clock-in.requested",
    mapArgs: ([branchId, phoneNumber, geolocation]: any[], auth) => ({ userId: auth.user.id, branchId, phoneNumber, geolocation }),
  },
  handleClockOutWorkflow: {
    event: "shift/clock-out.requested",
    mapArgs: ([phoneNumber, geolocation]: any[], auth) => ({ userId: auth.user.id, phoneNumber, geolocation }),
  },
  handleBreakStartWorkflow: {
    event: "shift/break.start.requested",
    mapArgs: ([phoneNumber, geolocation]: any[], auth) => ({ userId: auth.user.id, phoneNumber, geolocation }),
  },
  handleBreakEndWorkflow: {
    event: "shift/break.end.requested",
    mapArgs: ([phoneNumber, geolocation]: any[], auth) => ({ userId: auth.user.id, phoneNumber, geolocation }),
  },
};

export const POST = withTenantAuth(async (req: Request, { auth }) => {
  try {
    const body = await req.json();
    const { workflow, args } = body;

    if (!workflow || typeof workflow !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'workflow' argument" }, { status: 400 });
    }

    const mapping = WORKFLOW_EVENT_MAP[workflow];
    if (!mapping) {
      return NextResponse.json({ error: `Workflow '${workflow}' not found` }, { status: 404 });
    }

    const eventData = mapping.mapArgs(args || [], auth);

    await inngest.send({
      name: mapping.event,
      data: eventData,
    });

    return NextResponse.json({
      success: true,
      message: `Dispatched workflow ${workflow} as event ${mapping.event}`,
    });
  } catch (error) {
    console.error("Error dispatching workflow:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
});
