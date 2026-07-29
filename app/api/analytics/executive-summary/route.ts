import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getExecutiveSummary, type Period } from "@/lib/services/analytics-service";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = session.user.companyId;
    const userRole = (session.user as any).role;
    const userBranchId = (session.user as any).branchId as string | undefined;

    const searchParams = req.nextUrl.searchParams;
    const period = (searchParams.get("period") as Period | null) ?? "30d";
    const requestedBranchId = searchParams.get("branchId");

    const data = await getExecutiveSummary({
      companyId,
      userRole,
      userBranchId,
      requestedBranchId,
      period,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[Executive Summary API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch executive summary" },
      { status: 500 },
    );
  }
}