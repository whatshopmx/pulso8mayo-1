import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { SupplierClaimService } from "@/lib/services/supplier-claim-service";
import { z } from "zod";

const createClaimSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  type: z.enum(['SHORTAGE', 'DAMAGE', 'PRICE_DIFFERENCE', 'QUALITY']),
  description: z.string().optional(),
  totalAmount: z.number().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id || !session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validated = createClaimSchema.parse(body);
    const branchId = enforceBranchScope(
      (session.user.role as Role) ?? "ADMIN",
      session.user.branchId,
      (validated as { branchId?: string }).branchId ?? body.branchId ?? null
    );

    const claim = await SupplierClaimService.createClaim({
      companyId: session.user.companyId,
      branchId: branchId ?? "",
      invoiceId: validated.invoiceId,
      supplierId: validated.supplierId,
      type: validated.type,
      description: validated.description,
      totalAmount: validated.totalAmount,
      notes: validated.notes,
    });

    return NextResponse.json({ success: true, claim });
  } catch (error) {
    console.error("Error creating claim:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create claim" }, { status: 500 });
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
    const status = searchParams.get("status") as any || undefined;

    const claims = await SupplierClaimService.listClaims(session.user.companyId, branchId, status);

    return NextResponse.json({ success: true, claims });
  } catch (error) {
    console.error("Error listing claims:", error);
    return NextResponse.json({ error: "Failed to list claims" }, { status: 500 });
  }
}
