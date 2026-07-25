import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";

const WORKFLOW_EVENT_MAP: Record<string, { event: string; mapArgs: (args: any[]) => any }> = {
  executeWorkflow: {
    event: "workflow/execution.created",
    mapArgs: ([instanceId, userId]: any[]) => ({ instanceId, userId }),
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
    mapArgs: ([userId, branchId, phoneNumber, geolocation]: any[]) => ({ userId, branchId, phoneNumber, geolocation }),
  },
  handleClockOutWorkflow: {
    event: "shift/clock-out.requested",
    mapArgs: ([userId, phoneNumber, geolocation]: any[]) => ({ userId, phoneNumber, geolocation }),
  },
  handleBreakStartWorkflow: {
    event: "shift/break.start.requested",
    mapArgs: ([userId, phoneNumber, geolocation]: any[]) => ({ userId, phoneNumber, geolocation }),
  },
  handleBreakEndWorkflow: {
    event: "shift/break.end.requested",
    mapArgs: ([userId, phoneNumber, geolocation]: any[]) => ({ userId, phoneNumber, geolocation }),
  },
};

export async function POST(req: Request) {
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

    const eventData = mapping.mapArgs(args || []);

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
}
