/**
 * Analytics Predictions API
 *
 * GET /api/analytics/predictions        → all branches for the tenant
 * GET /api/analytics/predictions?branchId=X → single branch
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { PredictiveScoringService } from "@/lib/services/predictive-scoring-service";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const branchId = searchParams.get("branchId");

    if (branchId) {
      // Multi-tenant: verify the branch belongs to this tenant before
      // returning any prediction data for it.
      const [branch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.id, branchId),
            eq(branches.companyId, session.user.companyId),
          ),
        )
        .limit(1);

      if (!branch) {
        return NextResponse.json({ error: "Branch not found" }, { status: 404 });
      }

      const [compliance, merma, rotacion] = await Promise.all([
        PredictiveScoringService.predictComplianceRisk(branchId),
        PredictiveScoringService.predictMermaRisk(branchId),
        PredictiveScoringService.predictRotacionRisk(branchId),
      ]);

      const results = [compliance, merma, rotacion].filter(Boolean);
      return NextResponse.json({ predictions: results });
    }

    // All branches for the tenant
    const predictions = await PredictiveScoringService.predictAll(
      session.user.companyId,
    );

    return NextResponse.json({ predictions });
  } catch (error) {
    console.error("[Predictions API] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate predictions" },
      { status: 500 },
    );
  }
}
