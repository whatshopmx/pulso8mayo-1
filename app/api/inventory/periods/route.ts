import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { PeriodService } from "@/lib/services/period-service";
import { z } from "zod";

const createPeriodSchema = z.object({
  branchId: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validated = createPeriodSchema.parse(body);

    const period = await PeriodService.createPeriod({
      companyId: session.user.companyId,
      branchId: validated.branchId,
      periodStart: new Date(validated.periodStart),
      periodEnd: new Date(validated.periodEnd),
      notes: validated.notes,
    });

    return NextResponse.json({ success: true, period });
  } catch (error) {
    console.error("Error creating period:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create period" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;

    const periods = await PeriodService.getPeriods(session.user.companyId, branchId);

    return NextResponse.json({ success: true, periods });
  } catch (error) {
    console.error("Error listing periods:", error);
    return NextResponse.json({ error: "Failed to list periods" }, { status: 500 });
  }
}
