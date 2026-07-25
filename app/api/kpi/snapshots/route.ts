import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { kpiSnapshotLogs } from "@/lib/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const snapshotType = searchParams.get("snapshotType");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const branchId = searchParams.get("branchId");

    const conditions = [eq(kpiSnapshotLogs.companyId, session.user.companyId)];

    if (snapshotType && ["DAILY", "WEEKLY", "MONTHLY"].includes(snapshotType)) {
      conditions.push(eq(kpiSnapshotLogs.snapshotType, snapshotType));
    }

    if (from) {
      conditions.push(gte(kpiSnapshotLogs.snapshotDate, new Date(from)));
    }

    if (to) {
      conditions.push(lte(kpiSnapshotLogs.snapshotDate, new Date(to)));
    }

    if (branchId && branchId !== "all") {
      conditions.push(eq(kpiSnapshotLogs.branchId, branchId));
    }

    const snapshots = await db
      .select()
      .from(kpiSnapshotLogs)
      .where(and(...conditions))
      .orderBy(desc(kpiSnapshotLogs.snapshotDate))
      .limit(50);

    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("[KPI Snapshots API] Error:", error);
    return NextResponse.json(
      { error: "Error al obtener snapshots" },
      { status: 500 }
    );
  }
}
