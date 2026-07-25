import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { reportTemplates } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

interface ScheduleConfig {
  frequency?: string;
  time?: string;
  dayOfWeek?: string;
  dayOfMonth?: string;
  format?: string;
  timezone?: string;
}

function calculateNextRunDate(schedule: ScheduleConfig, fromDate: Date): Date | null {
  if (!schedule) return null;
  const next = new Date(fromDate);
  const frequency = schedule.frequency || "DAILY";
  switch (frequency) {
    case "DAILY": next.setDate(next.getDate() + 1); break;
    case "WEEKLY": next.setDate(next.getDate() + 7); break;
    case "MONTHLY": next.setMonth(next.getMonth() + 1); break;
    default: return null;
  }
  if (schedule.time) {
    const [hours, minutes] = schedule.time.split(":").map(Number);
    next.setHours(hours || 7, minutes || 0, 0, 0);
  }
  return next;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.id, id),
          eq(reportTemplates.companyId, session.user.companyId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body: Record<string, unknown> = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.dataSource !== undefined) updateData.dataSource = body.dataSource;
    if (body.fields !== undefined) updateData.fields = body.fields;
    if (body.branchId !== undefined) updateData.branchId = body.branchId;
    if (body.deliveryMethod !== undefined) updateData.deliveryMethod = body.deliveryMethod;
    if (body.deliveryEmails !== undefined) updateData.deliveryEmails = body.deliveryEmails;
    if (body.schedule !== undefined) {
      updateData.schedule = body.schedule;
      updateData.nextRunAt = calculateNextRunDate(body.schedule, new Date());
    }

    const [report] = await db
      .update(reportTemplates)
      .set(updateData)
      .where(eq(reportTemplates.id, id))
      .returning();

    return NextResponse.json({ report });
  } catch (error) {
    console.error("[SCHEDULED_REPORTS_PUT]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.id, id),
          eq(reportTemplates.companyId, session.user.companyId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.delete(reportTemplates).where(eq(reportTemplates.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[SCHEDULED_REPORTS_DELETE]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
