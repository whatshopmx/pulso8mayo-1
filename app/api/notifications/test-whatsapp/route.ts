import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/notifications/test-whatsapp
 * Test notification delivery (WhatsApp-first with fallback to in-app/email)
 */
export async function POST(req: NextRequest) {
try {
const session = await getSession();
if (!session?.user) {
return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

const body = await req.json();
const { type, userId, ...data } = body;

const targetUserId = userId || session.user.id;

const user = await db.query.users.findFirst({
where: eq(users.id, targetUserId)
});

if (!user || user.companyId !== session.user.companyId) {
return NextResponse.json({ error: "User not found or unauthorized" }, { status: 404 });
}

const eventType: "workflow_assignment" | "stock_alert" | "incident" | "shift_reminder" = type;
let title = "";
let message = "";
let metadata: Record<string, unknown> = {};

switch (type) {
case "workflow_assignment":
  title = "Nueva Tarea Asignada";
  message = `Se te ha asignado: ${data.workflowName || "Test Workflow"}`;
  metadata = {
    workflowName: data.workflowName || "Test Workflow",
    dueDate: data.dueDate || new Date().toISOString(),
    userName: user.name || "Test User",
  };
  break;

case "stock_alert":
  title = "Stock Bajo";
  message = `${data.itemName || "Test Item"} - Stock: ${data.currentStock || 5}/${data.minLevel || 10}`;
  metadata = {
    itemName: data.itemName || "Test Item",
    currentStock: data.currentStock || 5,
    minLevel: data.minLevel || 10,
    userName: user.name || "Test User",
  };
  break;

case "incident":
  title = data.incidentTitle || "Test Incident";
  message = `Incidente ${data.severity || "WARNING"}`;
  metadata = {
    incidentTitle: data.incidentTitle || "Test Incident",
    severity: data.severity || "WARNING",
    userName: user.name || "Test User",
  };
  break;

case "shift_reminder":
  title = "Turno Programado";
  message = `${data.shiftDate || "2026-03-21"} a las ${data.shiftTime || "08:00"}`;
  metadata = {
    shiftDate: data.shiftDate || "2026-03-21",
    shiftTime: data.shiftTime || "08:00",
    branchName: data.branchName || "Test Branch",
    userName: user.name || "Test User",
  };
  break;

default:
  return NextResponse.json({ error: "Invalid notification type" }, { status: 400 });
}

await NotificationDispatcher.sendNotification({
userId: targetUserId,
eventType,
title,
message,
type: "info",
metadata,
});

return NextResponse.json({
success: true,
message: "Notification dispatched through enabled channels",
});

} catch (error) {
console.error("[Notifications API] Error:", error);
return NextResponse.json(
{ error: "Internal server error" },
{ status: 500 }
);
}
}

/**
 * GET /api/notifications/test-whatsapp
 * Get notification templates
 */
export async function GET() {
try {
const session = await getSession();
if (!session?.user) {
return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

return NextResponse.json({
templates: [
{
type: "workflow_assignment",
name: "Asignación de Workflow",
description: "Notificación cuando se asigna una nueva tarea"
},
{
type: "stock_alert",
name: "Alerta de Stock",
description: "Notificación cuando el stock está bajo"
},
{
type: "incident",
name: "Incidente de Compliance",
description: "Notificación de incidentes críticos"
},
{
type: "shift_reminder",
name: "Recordatorio de Turno",
description: "Recordatorio antes del turno"
}
]
});

} catch (error) {
console.error("[Notifications API] Error:", error);
return NextResponse.json(
{ error: "Internal server error" },
{ status: 500 }
);
}
}
