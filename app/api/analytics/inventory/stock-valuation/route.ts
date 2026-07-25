import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryBatches, branches } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { headers } from "next/headers";
import { enforceBranchScope, getAccessibleBranchIds } from "@/lib/branch-scope";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = session.user.companyId;
    const userRole = (session.user as any).role as string;
    const userBranchId = (session.user as any).branchId as string | undefined;
    const searchParams = req.nextUrl.searchParams;
    const requestedBranchId = searchParams.get("branchId");

    const companyBranches = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const allBranchIds = companyBranches.map((b) => b.id);
    const accessibleBranchIds = getAccessibleBranchIds(userRole as any, userBranchId, allBranchIds);
    const effectiveBranchId = enforceBranchScope(userRole as any, userBranchId, requestedBranchId);
    const targetBranchIds = effectiveBranchId ? [effectiveBranchId] : accessibleBranchIds;

    if (targetBranchIds.length === 0) {
      return NextResponse.json({ totalValue: 0, byBranch: [], byItem: [] });
    }

    const result = await db
      .select({
        totalValue: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity} * ${inventoryBatches.unitCost}), 0)`,
        itemCount: sql<number>`cast(count(*) as integer)`,
      })
      .from(inventoryBatches)
      .where(
        and(
          eq(inventoryBatches.unitCost, sql`${inventoryBatches.unitCost}`),
          sql`${inventoryBatches.unitCost} is not null`
        )
      );

    const byBranch = await db
      .select({
        branchId: inventoryBatches.branchId,
        totalValue: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity} * ${inventoryBatches.unitCost}), 0)`,
        batchCount: sql<number>`cast(count(*) as integer)`,
      })
      .from(inventoryBatches)
      .where(
        and(
          sql`${inventoryBatches.unitCost} is not null`,
          sql`${inventoryBatches.branchId} = any(${targetBranchIds})`
        )
      )
      .groupBy(inventoryBatches.branchId);

    return NextResponse.json({
      totalValue: Number(result[0]?.totalValue || 0),
      itemCount: Number(result[0]?.itemCount || 0),
      byBranch: byBranch.map((b) => ({
        branchId: b.branchId,
        branchName: companyBranches.find((cb) => cb.id === b.branchId)?.name || "Sin nombre",
        totalValue: Number(b.totalValue),
        batchCount: Number(b.batchCount),
      })),
    });
  } catch (error) {
    console.error("[Stock Valuation API] Error:", error);
    return NextResponse.json({ error: "Failed to fetch stock valuation" }, { status: 500 });
  }
}
