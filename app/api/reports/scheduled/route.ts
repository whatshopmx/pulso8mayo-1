import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { reportTemplates } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

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

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reports = await db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.companyId, session.user.companyId),
          eq(reportTemplates.reportType, "SCHEDULED")
        )
      )
      .orderBy(desc(reportTemplates.createdAt));

    return NextResponse.json({ reports });
  } catch (error) {
    console.error("[SCHEDULED_REPORTS_GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: Record<string, unknown> = await request.json();
    const { name, description, dataSource, fields, schedule, deliveryMethod, deliveryEmails, branchId } = body as { name?: string; description?: string; dataSource?: string; fields?: unknown; schedule?: ScheduleConfig; deliveryMethod?: string; deliveryEmails?: string[]; branchId?: string };

    if (!name || !dataSource || !schedule) {
      return NextResponse.json(
        { error: "Missing required fields: name, dataSource, schedule" },
        { status: 400 }
      );
    }

    const nextRunAt = calculateNextRunDate(schedule, new Date());

    const [report] = await db
      .insert(reportTemplates)
      .values({
        name,
        description: description || null,
        companyId: session.user.companyId,
        branchId: branchId || null,
        reportType: "SCHEDULED",
        dataSource,
        fields: fields || {},
        filters: null,
        schedule,
        nextRunAt,
        deliveryMethod: deliveryMethod || "EMAIL",
        deliveryEmails: deliveryEmails || [],
        createdBy: session.user.id,
        isPublic: false,
      })
      .returning();

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    console.error("[SCHEDULED_REPORTS_POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
